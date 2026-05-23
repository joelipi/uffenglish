import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentStepIndex, validateAnswerPrecheck, processAnswerLogic } from './answers.js';
import swearjar from './swearjar.js';
import * as api from './api.js';

vi.mock('./api.js', () => ({
    checkGrammarWithAI: vi.fn(),
    evaluateIntentWithAI: vi.fn()
}));

describe('Answers Module', () => {
    describe('getCurrentStepIndex', () => {
        const configData = {
            lessons: [{
                steps: [
                    { step: 'Step 1', cue: 'cue1' },
                    { step: 'Step 2', cue: 'cue2' }
                ]
            }]
        };

        it('should return correct index if step exists', () => {
            expect(getCurrentStepIndex({ step: 'Step 2', cue: 'cue2' }, configData, 0)).toBe(1);
        });

        it('should return -1 if config is missing', () => {
            expect(getCurrentStepIndex({}, null, 0)).toBe(-1);
        });

        it('should return -1 if lesson index is out of bounds', () => {
            expect(getCurrentStepIndex({}, configData, 1)).toBe(-1);
        });

        it('should return -1 if step is not found', () => {
            expect(getCurrentStepIndex({ step: 'Unknown', cue: 'unk' }, configData, 0)).toBe(-1);
        });
    });


    describe('processAnswerLogic', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should handle missing stepData gracefully', async () => {
            const result = await processAnswerLogic({
                stepData: {},
                userResponse: 'hello',
                cue: 'hello'
            });
            expect(result.isCorrect).toBe(false);
            expect(result.explanation).toBeUndefined();
        });

        it('should handle grammar differences without ungrammatical label', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: false, correctedText: 'hello there' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '["correct"]' });

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hey',
                cue: 'hello',
                userData: { native_language: 'en' }
            });

            expect(result.isCorrect).toBe(false);
            expect(result.errorType).toBe('ungrammatical');
            expect(result.explanations).toHaveLength(1);
            expect(result.explanations[0].type).toBe('grammar_diff');
        });

        it('should return default fallback evaluation if not open/closed response', async () => {
            const result = await processAnswerLogic({
                stepData: { stepType: 'unknown', explanation: 'default explain' },
                userResponse: 'hello',
                cue: 'hello'
            });
            expect(result.isCorrect).toBe(false);
            expect(result.explanation).toBe('default explain');
        });

        it('should process openResponse correctly when valid JSON is returned by AI', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '["correct"]' });

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello',
                userData: { native_language: 'es' }
            });

            expect(result.isCorrect).toBe(true);
            expect(result.errorType).toBe('correct');
            expect(result.intentLabels).toEqual(['correct']);
            expect(result.correction).toBe('hello');
        });

        it('should process openResponse correctly with feedback chunks when incorrect', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: false, correctedText: 'hello there' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '["pragmatic failure", "too informal", "hello there sir"]' });

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hey',
                cue: 'hello',
                userData: { native_language: 'en' }
            });

            expect(result.isCorrect).toBe(false);
            expect(result.errorType).toBe('ungrammatical');
            expect(result.intentLabels).toEqual(['pragmatic failure', 'too informal']);
            expect(result.correction).toBe('hello there sir');
            expect(result.explanations).toHaveLength(2); // grammar diff and pragmatics
            expect(result.explanations[0].type).toBe('grammar_diff');
            expect(result.explanations[1].type).toBe('pragmatics');
        });

        it('should handle unquoted JSON array recovery', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '[too formal, unidiomatic]' }); // missing quotes

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.intentLabels).toEqual(['too formal', 'unidiomatic']);
        });

        it('should handle single label unquoted JSON array recovery', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '[too formal]' }); // missing quotes

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.intentLabels).toEqual(['too formal']);
        });

        it('should fallback to manual split if JSON fails entirely', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            // The JSON.parse inside the second try block attempts to parse `["{"foo":"bar"}","]` which should fail
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '{foo: "bar"}' });

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.intentLabels).toEqual([]);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should fallback to manual split for single correct string', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: 'correct' }); // totally invalid JSON

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.intentLabels).toEqual(['correct']);
        });

        it('should handle valid JSON array but not an array type', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '{"correct": true}' }); // not an array

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.intentLabels).toEqual([]);
        });

        it('should handle correct override when other valid labels exist', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '["correct", "too formal"]' });

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.intentLabels).toEqual(['too formal']); // correct should be removed
            expect(result.errorType).toBe('formality_error');
        });

        it('should prioritize pragmatic_failure as errorType', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '["pragmatic failure", "unidiomatic"]' });

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.errorType).toBe('pragmatic_failure');
        });

        it('should mark ungrammatical and return false if grammar differences exist despite valid grammar flag', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello sir' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '["correct"]' });

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello', // difference triggers grammar check failure
                cue: 'hello'
            });

            expect(result.isCorrect).toBe(false);
            expect(result.errorType).toBe('ungrammatical');
        });

        it('should parse appended correction', async () => {
            api.checkGrammarWithAI.mockResolvedValue({ isGrammarCorrect: true, correctedText: 'hello' });
            api.evaluateIntentWithAI.mockResolvedValue({ rawIntentText: '["rude"] Please say hello' }); // appended

            const result = await processAnswerLogic({
                stepData: { stepType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.correction).toBe('Please say hello');
        });

        it('should handle closedResponse stepType correctly', async () => {
            const result = await processAnswerLogic({
                stepData: { stepType: 'closedResponse', explanation: 'explain' },
                userResponse: 'hello there',
                cue: 'hello there',
                englishLevel: 'B1'
            });
            expect(result.isCorrect).toBe(true);
            expect(result.explanation).toBe('explain');
            expect(result.normalizeduserResponse).toBe('hello there');
        });

        it('should mark incorrect for low similarity closedResponse', async () => {
            const result = await processAnswerLogic({
                stepData: { stepType: 'closedResponse', explanation: 'explain' },
                userResponse: 'hello',
                cue: 'goodbye',
                englishLevel: 'B1'
            });
            expect(result.isCorrect).toBe(false);
        });
    });

    describe('validateAnswerPrecheck', () => {
        const defaultArgs = ['cue', { stepType: 'openResponse' }, 'B1', {}, []];

        it('should return valid if not openResponse', async () => {
            const result = await validateAnswerPrecheck('val', 'cue', { stepType: 'closedResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(true);
        });

        it('should mark invalid if already used', async () => {
            const result = await validateAnswerPrecheck('test answer', 'cue', { stepType: 'openResponse' }, 'B1', {}, ['test answer']);
            expect(result.isValid).toBe(false);
            expect(result.warningMessage).toBeDefined();
        });

        it('should mark invalid if similarity with cue is high', async () => {
            const result = await validateAnswerPrecheck('this is a test cue', 'this is a test cue', { stepType: 'openResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(false);
            expect(result.warningMessage).toBeDefined();
        });

        it('should mark valid if word count meets requirements', async () => {
            const result = await validateAnswerPrecheck('one two three four five', 'different cue', { stepType: 'openResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(true);
        });

        it('should mark invalid if word count is too low for level', async () => {
            const resultA2 = await validateAnswerPrecheck('one two three', 'different cue', { stepType: 'openResponse' }, 'A2', {}, []);
            expect(resultA2.isValid).toBe(false);

            const resultB1 = await validateAnswerPrecheck('one two three four', 'different cue', { stepType: 'openResponse' }, 'B1', {}, []);
            expect(resultB1.isValid).toBe(false);

            const resultB2 = await validateAnswerPrecheck('one two three four five', 'different cue', { stepType: 'openResponse' }, 'B2', {}, []);
            expect(resultB2.isValid).toBe(false);
        });

        it('should mark invalid if profane', async () => {
            const result = await validateAnswerPrecheck('one two three four five shit', 'different cue', { stepType: 'openResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(false);
            expect(result.warningMessage).toBeDefined();
        });
    });
});
