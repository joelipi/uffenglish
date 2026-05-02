// --- modules/FORFUTUREUSEnlp-coordinator.js ---

/*
const workerResponse = await fetch('js/nlp-worker.js');
const workerBlob = await workerResponse.blob();
const workerObjectUrl = URL.createObjectURL(workerBlob);
const aiWorker = new Worker(workerObjectUrl, { type: 'module' });
let messageIdCounter = 0;
*/

/*
// Crash/parse errors on the worker surface here instead of dying silently
aiWorker.onerror = (e) => {
    console.error("❌ NLP Worker crashed or failed to load:", {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error
    });
};

aiWorker.addEventListener('messageerror', (e) => {
    console.error("❌ Worker message error:", e);
});

// Helper function to send messages to the worker and wait for the response
function askWorker(action, payload = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const id = ++messageIdCounter;

        const timer = setTimeout(() => {
            aiWorker.removeEventListener('message', handleMessage);
            reject(new Error(`NLP Worker timeout waiting for action: ${action}`));
        }, timeoutMs);

        const handleMessage = (event) => {
            if (event.data.id === id) {
                clearTimeout(timer);
                aiWorker.removeEventListener('message', handleMessage);
                if (event.data.status === 'error') reject(new Error(event.data.error));
                else resolve(event.data.data);
            }
        };

        aiWorker.addEventListener('message', handleMessage);
        aiWorker.postMessage({ id, action, payload });
    });
}

// REMOVE IN PRODUCTION
window.askWorker = askWorker;
*/

// 🤖🤖🤖🤖🤖🤖🤖🤖 LOCAL NLP HELPERS 🤖🤖🤖🤖🤖🤖🤖🤖

// =================================================================================================
// IMPORTANT: DO NOT DELETE. THIS CODE WILL BE REINSTATED SHORTLY.
// IT IS TEMPORARILY DISABLED TO SAVE SYSTEM RESOURCES DURING INTENSE DEVELOPMENT.
// =================================================================================================
/*
async function checkGrammarLocally(userInput) {
    console.groupCollapsed(`📝 [Grammar Check] Analyzing: "${userInput}"`);

    if (!nlpModelsReady) {
        console.warn("⚠️ Aborted: Local NLP models are not fully loaded yet.");
        console.groupEnd();
        return null;
    }

    if (!userInput) {
        console.log("ℹ️ Aborted: Empty input.");
        console.groupEnd();
        return null;
    }

    try {
        const result = await askWorker('CHECK_GRAMMAR', { userInput });
        console.log("🔍 Raw worker result:", JSON.stringify(result));

        if (result.escalated) {
            console.log("ℹ️ Escalated: Trivial correction (punctuation/case only). Skipping to Tier 2.");
            console.groupEnd();
            return null;
        }

        if (result.isValid) {
            console.log("✅ Passed: Model made zero changes or input too short.");
            console.groupEnd();
            return { isValid: true, correction: null };
        }

        // Valid correction found
        console.log(`✨ Valid Correction Triggered! Building diff UI...`);
        const { userHTML, corrHTML } = buildGrammarDiff(result.cleanedInput, result.correction);
        console.groupEnd();

        return {
            isValid: false,
            correction: result.correction,
            explanation: `
                <div class="diff-del-bubble">${userHTML}</div>
                <div style="margin-top:6px">${corrHTML}</div>`
        };

    } catch (error) {
        console.error("❌ Fatal Error in Local Grammar Check:", error);
        console.groupEnd();
        return null;
    }
}
*/

// REMOVE IN PRODUCTION. Add this line right after the checkGrammarLocally function closes
// window.testGrammar = checkGrammarLocally;

// IMPORTANT: DO NOT DELETE. Reinstating soon.
/*
async function evaluateIntentLocally(userInput, targetIntents, badIntents = []) {
    if (!nlpModelsReady || !targetIntents || targetIntents.length === 0) return null;

    try {
        console.log("⏳ Running zero-shot classification check...");

        const result = await askWorker('EVALUATE_INTENT', { userInput, targetIntents, badIntents });

        if (result.isCorrect) {
            console.log(`🎯 Local Target Match! Label: "${result.winningLabel}" (Score: ${result.winningScore.toFixed(2)})`);
            return {
                isCorrect: true,
                category: result.category,
                winningLabel: result.winningLabel,
                normalizeduserResponse: userInput,
                englishLevel: State.englishLevel,
                englishLevelDeduction: 0,
                explanation: null,
                normalizedcue: result.winningLabel
            };
        }

        console.log(`❌ Local Target Check Failed. Label: "${result.winningLabel}" (Category: ${result.category}, Score: ${result.winningScore.toFixed(2)})`);
        return {
            isCorrect: false,
            category: result.category,
            winningLabel: result.winningLabel,
            normalizeduserResponse: userInput,
            normalizedcue: result.winningLabel,
            englishLevel: State.englishLevel,
            englishLevelDeduction: 0,
            explanation: null
        };

    } catch (error) {
        console.error("Local intent evaluation error:", error);
        return null;
    }
}
*/

// REMOVE IN PRODUCTION. To be able to test it in browser console
// window.testIntent = evaluateIntentLocally;

/* --- NLP WORKER TEMPORARILY DISABLED ---
    try {
        console.log("⏳ Telling background worker to skip model boot...");
        await askWorker('LOAD_MODELS', {}, 3 * 60 * 1000); // 3 min timeout
        nlpModelsReady = true;
        console.log("✅ Worker reports local NLP models are disabled. Using Server API flow.");
    } catch (err) {
        // Even if we timed out, the worker may still finish loading.
        // Poll until it responds or we give up after 5 more minutes.
        console.warn("⚠️ Model load timed out — polling for late readiness...", err);
        const giveUpAt = Date.now() + 5 * 60 * 1000;
        while (Date.now() < giveUpAt) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
                await askWorker('CHECK_GRAMMAR', { userInput: 'test ping' }, 10000);
                nlpModelsReady = true;
                console.log("✅ Worker became ready after delayed load!");
                break;
            } catch {
                console.log("⏳ Worker not ready yet, still waiting...");
            }
        }
        if (!nlpModelsReady) {
            console.error("❌ Worker never became ready. Falling back to Server API permanently.");
        }
    }
    */