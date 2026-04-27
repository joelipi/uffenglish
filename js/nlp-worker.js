// nlp-worker.js

import { pipeline, cos_sim, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';
import Tokenizer from 'https://cdn.skypack.dev/wink-tokenizer';

env.allowLocalModels = false; 
env.useBrowserCache = true;   
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.simd = false;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0-dev.20241016-2b8fc5529b/dist/';

const tokenizer = new Tokenizer();
let zeroShotClassifier = null;
let localGrammarEditor = null;
let id2label = null;
let verbFormVocab = null;

// GECToR Config & Constants
const CONFIG = {
    maxLen: 100,
    minLen: 1,        
    minErrorProbability: 0.1, 
    deleteConfidence: 0,    
    iterations: 3, 
    minKeepConfidence: 0.5 // NEW: Threshold for catching unintelligible STT output
};

const START_TOKEN = '$START';
const PAD_TOKEN = '@@PADDING@@';
const UNK_TOKEN = '@@UNKNOWN@@';
const EMDASH_PLACEHOLDER = 'EMDASHMARK';

// Updated to the Base Model
const GECTOR_MODEL = 'Meyssa/gector-base-2020';
// Use official source for the missing verb vocab file
const VERB_VOCAB_URL = 'https://raw.githubusercontent.com/grammarly/gector/master/data/verb-form-vocab.txt';

self.addEventListener('message', async (event) => {
    const { action, payload, id } = event.data;

    try {
        if (action === 'LOAD_MODELS') {
            console.log("👷‍♂️ Worker: Beginning Zero-Shot Classifier Download...");
            // Far less than ideal model:
            //zeroShotClassifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', {
            // This model was not so glorious in testing but quite a ram user (estimated 350 MB) so putting aside for now:
            //zeroShotClassifier = await pipeline('zero-shot-classification', 'Xenova/nli-deberta-v3-small', {
            zeroShotClassifier = await pipeline('zero-shot-classification', 'Xenova/nli-deberta-v3-xsmall', {
                device: 'wasm',
                dtype: 'q8',
                session_options: {
                    executionMode: 'sequential',
                    intraOpNumThreads: 1,
                    interOpNumThreads: 1
                }
            });

            console.log(`👷‍♂️ Worker: Beginning GECToR RoBERTa Download (${GECTOR_MODEL})...`);
            localGrammarEditor = await pipeline('token-classification', GECTOR_MODEL, { 
                device: 'wasm', 
                dtype: 'q8',
                session_options: {
                    executionMode: 'sequential', 
                    intraOpNumThreads: 1,
                    interOpNumThreads: 1
                },
                progress_callback: (x) => {
                    if (x.status === 'progress') console.log(`📥 GECToR: ${Math.round((x.loaded / x.total) * 100)}%`);
                }
            });

            console.log("👷‍♂️ Worker: Fetching GECToR Vocabularies...");
            const [idResponse, verbResponse] = await Promise.all([
                fetch(`https://huggingface.co/${GECTOR_MODEL}/resolve/main/id2label.json`),
                fetch(VERB_VOCAB_URL) 
            ]);
            
            if (!idResponse.ok || !verbResponse.ok) {
                throw new Error(`Failed to fetch vocabs. ID: ${idResponse.status}, Verb: ${verbResponse.status}`);
            }

            id2label = await idResponse.json();
            verbFormVocab = parseVerbFormVocab(await verbResponse.text());
            
            console.log("👷‍♂️ Worker: ALL MODELS AND VOCABS LOADED.");
            self.postMessage({ id, status: 'success', data: 'MODELS_READY' });
        }

        else if (action === 'CHECK_GRAMMAR') {
            if (!localGrammarEditor || !verbFormVocab) throw new Error("Models/Vocab not loaded");
            
            const { userInput } = payload;
            const cleanedInput = userInput.replace(/\b(um|umm|uh|uhm|ah)\b/gi, '').replace(/\s+/g, ' ').trim();
            
            if (cleanedInput.split(/\s+/).length < 3) {
                return self.postMessage({ id, status: 'success', data: { isValid: true, correction: null, cleanedInput } });
            }

            const { correctedText, isUnintelligible } = await runGector(cleanedInput, localGrammarEditor);

            // NEW: Word Salad Failsafe Catch
            if (isUnintelligible) {
                return self.postMessage({ 
                    id, 
                    status: 'success', 
                    data: { 
                        isValid: false, 
                        correction: "Sentence structure unintelligible.", 
                        errorType: "word_salad", 
                        cleanedInput 
                    } 
                });
            }

            if (!correctedText || correctedText.length < 2 || correctedText.toLowerCase() === cleanedInput.toLowerCase()) {
                return self.postMessage({ id, status: 'success', data: { isValid: true, correction: null, cleanedInput } });
            }

            self.postMessage({ id, status: 'success', data: { isValid: false, correction: correctedText, cleanedInput } });
        }

        else if (action === 'EVALUATE_INTENT') {
            if (!zeroShotClassifier) throw new Error("Models not loaded");
            const { userInput, targetIntents, badIntents } = payload;
            // trying it without distractors
            //const distractorLabel = "I hate the English language";
            const safeBadIntents = Array.isArray(badIntents) ? badIntents : [];
            const safeTargetIntents = Array.isArray(targetIntents) ? targetIntents : [];

//            const candidateLabels = [...safeTargetIntents, ...safeBadIntents, distractorLabel];
            const candidateLabels = [...safeTargetIntents, ...safeBadIntents];

            console.log("👷‍♂️ Worker: Running Multi-Label Zero-Shot Classification...");
            // Remove multi_label so the scores are forced to sum to 100%. In tests, the best way to get an answer.
            // const result = await zeroShotClassifier(userInput, candidateLabels, { multi_label: true });
            const result = await zeroShotClassifier(userInput, candidateLabels);

            const winningLabel = result.labels[0];
            const winningScore = result.scores[0];

            // FIX 2: Restored Category Logic
            let category = 'distractor';
            if (safeTargetIntents.includes(winningLabel)) {
                category = 'target';
            } else if (safeBadIntents.includes(winningLabel)) {
                category = 'bad';
            }

            // FIX 3: Map all scores for your benchmark logging
            const allScores = result.labels.map((label, index) => ({
                label: label,
                score: (result.scores[index] * 100).toFixed(1) + '%'
            }));
            console.log("📊 Full Intent Breakdown:", allScores);

            self.postMessage({ 
                id, status: 'success', 
                data: {
                    winningLabel,
                    winningScore,
                    allScores,
                    category,
                    isCorrect: category === 'target' && winningScore > 0.5
                }
            });
        }
    } catch (error) {
        console.error("👷‍♂️ Worker Error:", error.message);
        self.postMessage({ id, status: 'error', error: error.message });
    }
});

// --- GECToR ENGINE ---

function parseVerbFormVocab(text) {
    const dict = {};
    for (const line of text.trim().split('\n')) {
        const [words, tags] = line.split(':');
        if (!words || !tags) continue;
        const [source, target] = words.split('_');
        const [fromTag, toTag] = tags.split('_');
        if (source && target && fromTag && toTag) {
            dict[`${source}_${fromTag}_${toTag}`] = target;
        }
    }
    return dict;
}

async function runGector(text, pipeline, maxIterations = CONFIG.iterations) {
    let processingText = text.replace(/\b(did|do|does|was|were|is|are|have|has|had|wo|would|could|should|ca)(nt)\b/gi, (_, base, _nt) => `${base} n't`);
    let isUnintelligible = false;
    
    for (let iter = 0; iter < maxIterations; iter++) {
        const { text: newText, isSalad } = await processOnce(processingText, pipeline);
        
        // If it's the first pass and the structure is unintelligible, flag it and break
        if (iter === 0 && isSalad) {
            isUnintelligible = true;
            break;
        }
        
        if (newText === processingText) break;
        processingText = newText;
    }
    return { correctedText: processingText, isUnintelligible };
}

async function processOnce(text, pipeline) {
    const rawWords = tokenizer.tokenize(text.replace(/—/g, ` ${EMDASH_PLACEHOLDER} `)).filter(t => t.tag !== 'space').map(t => t.value);
    if (rawWords.length < CONFIG.minLen) return { text, isSalad: false };

    const inputWords = [START_TOKEN, ...rawWords];
    let predictions;
    try {
        predictions = await pipeline(inputWords.join(' '), { aggregation_strategy: 'first' });
    } catch {
        predictions = await pipeline(inputWords.join(' '));
    }

    const wordPredictions = alignPredictionsToWords(inputWords, predictions);
    const { edits, isSalad } = extractEdits(inputWords, wordPredictions);
    const resultWords = applyEdits(inputWords, edits);
    const finalWords = resultWords[0] === START_TOKEN ? resultWords.slice(1) : resultWords;
    
    return {
        text: rejoinText(finalWords).replace(new RegExp(`\\s*${EMDASH_PLACEHOLDER}\\s*`, 'g'), ' — '),
        isSalad
    };
}

function alignPredictionsToWords(words, predictions) {
    const filteredPreds = predictions.filter(p => !['<s>', '</s>', '<pad>', '<unk>', '[CLS]', '[SEP]', '[PAD]'].includes(p.word));
    const wordPredictions = [];
    let predIndex = 0;

    for (const word of words) {
        const wordLower = word.toLowerCase();
        let assembledWord = '';
        let firstPrediction = null;

        while (predIndex < filteredPreds.length) {
            const pred = filteredPreds[predIndex];
            let subword = pred.word || '';
            if (subword.startsWith('Ġ') || subword.startsWith(' ')) subword = subword.slice(1);
            
            if (!firstPrediction) firstPrediction = pred;
            assembledWord += subword;
            predIndex++;

            if (assembledWord.toLowerCase() === wordLower || assembledWord.toLowerCase().length >= wordLower.length) break;
        }

        let entity = firstPrediction ? firstPrediction.entity : '$KEEP';
        if (id2label && entity?.startsWith('LABEL_')) entity = id2label[entity.replace('LABEL_', '')] || entity;
        wordPredictions.push({ word, entity, score: firstPrediction?.score || 1.0 });
    }
    return wordPredictions;
}

function extractEdits(words, wordPredictions) {
    const edits = [];
    let keepCount = 0;
    let keepScoreSum = 0;

    for (let i = 0; i < wordPredictions.length; i++) {
        const { entity: label, score: prob } = wordPredictions[i];
        const word = words[i];
        
        // Track $KEEP probabilities for word salad detection
        if (label === '$KEEP' && word !== START_TOKEN) {
            keepCount++;
            keepScoreSum += prob;
        }
        
        if (word === EMDASH_PLACEHOLDER || prob < CONFIG.minErrorProbability || label === '$KEEP' || label === PAD_TOKEN || label === UNK_TOKEN || label === 'O') continue;
        
        if (label === '$DELETE') edits.push({ start: i, end: i + 1, label: '', prob });
        else if (label.startsWith('$REPLACE_')) edits.push({ start: i, end: i + 1, label: label.slice(9), prob });
        else if (label.startsWith('$APPEND_')) edits.push({ start: i + 1, end: i + 1, label: label.slice(8), prob });
        else if (label.startsWith('$MERGE_')) edits.push({ start: i + 1, end: i + 1, label, prob });
        else if (label.startsWith('$TRANSFORM_')) {
            const transformed = applyTransformation(word, label);
            if (transformed && transformed !== word) edits.push({ start: i, end: i + 1, label: transformed, prob });
        }
    }

    // Evaluate if the sentence is structural nonsense
    const avgKeepScore = keepCount > 0 ? (keepScoreSum / keepCount) : 1.0;
    
    // 🧪 DEBUG THE THRESHOLD
    console.log(`📊 UFF NLP Debug -> Input: "${words.slice(1).join(' ')}" | Avg $KEEP Confidence: ${avgKeepScore.toFixed(4)}`);

    const isSalad = avgKeepScore < CONFIG.minKeepConfidence;

    return { edits, isSalad };
}

function applyEdits(sourceWords, edits) {
    const targetWords = [...sourceWords];
    let shiftIdx = 0;
    
    for (const { start, end, label } of edits) {
        const targetPos = start + shiftIdx;
        if (targetPos < 0 || targetPos > targetWords.length) continue;
        
        if (label.startsWith('$MERGE_')) {
            if (label === '$MERGE_SPACE') continue;
            if (targetPos + 1 < targetWords.length) {
                targetWords[targetPos] = label === '$MERGE_HYPHEN' ? `${targetWords[targetPos]}-${targetWords[targetPos + 1]}` : targetWords[targetPos] + targetWords[targetPos + 1];
                targetWords.splice(targetPos + 1, 1);
                shiftIdx -= 1;
            }
        } else if (label === '') {
            if (targetPos < targetWords.length) { targetWords.splice(targetPos, 1); shiftIdx -= 1; }
        } else if (start === end) {
            targetWords.splice(targetPos, 0, label); shiftIdx += 1;
        } else if (targetPos < targetWords.length) {
            targetWords[targetPos] = label;
        }
    }
    return targetWords;
}

function applyTransformation(word, label) {
    if (label.startsWith('$TRANSFORM_CASE_')) {
        if (label.endsWith('LOWER')) return word.toLowerCase();
        if (label.endsWith('UPPER')) return word.toUpperCase();
        if (label.endsWith('CAPITAL')) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    if (label.startsWith('$TRANSFORM_VERB_')) {
        const key = `${word.toLowerCase()}_${label.slice(16)}`;
        if (verbFormVocab?.[key]) {
            const res = verbFormVocab[key];
            return word[0] === word[0].toUpperCase() ? res[0].toUpperCase() + res.slice(1) : res;
        }
    }
    if (label.startsWith('$TRANSFORM_AGREEMENT_')) {
        if (label.endsWith('PLURAL')) return word + 's';
        if (label.endsWith('SINGULAR')) return word.slice(0, -1);
    }
    return word;
}

function rejoinText(words) {
    if (!words.length) return '';
    let text = '';
    let prevType = null;

    const getTokenType = (t) => /^[.,!?;:%]+$/.test(t) ? 'attach' : /^[)\]}]+$/.test(t) ? 'close' : /^[([{]+$/.test(t) ? 'open' : /^["']$/.test(t) ? 'quote' : 'word';

    for (const token of words) {
        const type = getTokenType(token);
        let spaceBefore = text.length > 0;

        if (type === 'attach' || type === 'close' || token.startsWith("'")) spaceBefore = false;
        if (prevType === 'open') spaceBefore = false;

        if (spaceBefore) text += ' ';
        text += token;
        prevType = type;
    }
    return text.trim();
}