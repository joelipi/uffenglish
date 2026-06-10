import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentStepIndex, validateAnswerPrecheck, processAnswerLogic } from './answers.js';
import swearjar from '../utils/swearjar.js';
import * as api from '../api/api.js';

vi.mock('../api/api.js', () => ({
    evaluateWithAI: vi.fn()
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

        it('should return correct index via store when step matches', () => {
            expect(getCurrentStepIndex({ step: 'Step 2', cue: 'cue2' }, configData, 0)).toBe(1);
        });

        it('should return -1 if config is missing', () => {
            expect(getCurrentStepIndex({}, null, 0)).toBe(-1);
        });

        it('should return -1 if lesson index is out of bounds', () => {
            expect(getCurrentStepIndex({}, configData, 1)).toBe(-1);
        });

        it('should fall back to content lookup if store index mismatches', () => {
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

        it('should discard no-op grammar correction when normalized text matches user response', async () => {
            api.evaluateWithAI.mockResolvedValue({
                labels: ['grammar'],
                corrections: [{ label: 'grammar', correctedText: 'hello there' }],
                grammarCorrectedText: 'hello there',
                finalCorrectedText: 'hello there',
                isCorrect: false,
                isGibberish: false,
                rawOutput: '["GRAMMAR: hello there"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
                userResponse: 'hello there',
                cue: 'hello',
                userData: { native_language: 'en' }
            });

            expect(result.isCorrect).toBe(true);
            expect(result.errorType).toBe('correct');
            expect(result.intentLabels).toEqual([]);
        });

        it('should discard no-op grammar but keep other non-grammar labels', async () => {
            api.evaluateWithAI.mockResolvedValue({
                labels: ['grammar', 'too_informal'],
                corrections: [
                    { label: 'grammar', correctedText: 'hello there' },
                    { label: 'too_informal', correctedText: 'hello there buddy' }
                ],
                grammarCorrectedText: 'hello there',
                finalCorrectedText: 'hello there buddy',
                isCorrect: false,
                isGibberish: false,
                rawOutput: '["GRAMMAR: hello there","TOO_INFORMAL: hello there buddy"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
                userResponse: 'hello there',
                cue: 'hello',
                userData: { native_language: 'en' }
            });

            expect(result.isCorrect).toBe(false);
            expect(result.errorType).toBe('formality_error');
            expect(result.intentLabels).toEqual(['too_informal']);
            expect(result.correction).toBe('hello there buddy');
        });

        it('should handle grammar differences without grammar label', async () => {
            api.evaluateWithAI.mockResolvedValue({
                labels: ['grammar'],
                corrections: [{ label: 'grammar', correctedText: 'hello there' }],
                grammarCorrectedText: 'hello there',
                finalCorrectedText: 'hello there',
                isCorrect: false,
                isGibberish: false,
                rawOutput: '["GRAMMAR: hello there"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
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
                stepData: { responseType: 'unknown', explanation: 'default explain' },
                userResponse: 'hello',
                cue: 'hello'
            });
            expect(result.isCorrect).toBe(false);
            expect(result.explanation).toBe('default explain');
        });

        it('should process openResponse correctly when CORRECT is returned', async () => {
            api.evaluateWithAI.mockResolvedValue({
                labels: ['correct'],
                corrections: [],
                grammarCorrectedText: null,
                finalCorrectedText: null,
                isCorrect: true,
                isGibberish: false,
                rawOutput: '["CORRECT"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
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
            api.evaluateWithAI.mockResolvedValue({
                labels: ['grammar', 'pragmatic_failure', 'too_informal'],
                corrections: [
                    { label: 'grammar', correctedText: 'hello there' },
                    { label: 'too_informal', correctedText: 'hello there sir' }
                ],
                grammarCorrectedText: 'hello there',
                finalCorrectedText: 'hello there sir',
                isCorrect: false,
                isGibberish: false,
                rawOutput: '["GRAMMAR: hello there","PRAGMATIC_FAILURE","TOO_INFORMAL: hello there sir"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
                userResponse: 'hey',
                cue: 'hello',
                userData: { native_language: 'en' }
            });

            expect(result.isCorrect).toBe(false);
            expect(result.errorType).toBe('ungrammatical');
            expect(result.intentLabels).toEqual(['grammar', 'pragmatic_failure', 'too_informal']);
            expect(result.correction).toBe('hello there sir');
            expect(result.explanations).toHaveLength(2); // grammar diff and pragmatics
            expect(result.explanations[0].type).toBe('grammar_diff');
            expect(result.explanations[1].type).toBe('pragmatics');
        });

        it('should handle CORRECT override when other labels exist', async () => {
            api.evaluateWithAI.mockResolvedValue({
                labels: ['correct', 'too_formal'],
                corrections: [{ label: 'too_formal', correctedText: 'hello there' }],
                grammarCorrectedText: null,
                finalCorrectedText: 'hello there',
                isCorrect: false,
                isGibberish: false,
                rawOutput: '["CORRECT", "TOO_FORMAL: hello there"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.intentLabels).toEqual(['too_formal']);
            expect(result.errorType).toBe('formality_error');
        });

        it('should prioritize pragmatic_failure as errorType', async () => {
            api.evaluateWithAI.mockResolvedValue({
                labels: ['pragmatic_failure', 'unnatural'],
                corrections: [{ label: 'unnatural', correctedText: 'hello' }],
                grammarCorrectedText: null,
                finalCorrectedText: 'hello',
                isCorrect: false,
                isGibberish: false,
                rawOutput: '["PRAGMATIC_FAILURE", "UNNATURAL: hello"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
                userResponse: 'hello',
                cue: 'hello'
            });

            expect(result.errorType).toBe('pragmatic_failure');
        });

        it('should return labels for gibberish input', async () => {
            api.evaluateWithAI.mockResolvedValue({
                labels: ['gibberish'],
                corrections: [],
                grammarCorrectedText: null,
                finalCorrectedText: null,
                isCorrect: false,
                isGibberish: true,
                rawOutput: '["GIBBERISH"]'
            });

            const result = await processAnswerLogic({
                stepData: { responseType: 'openResponse' },
                userResponse: 'asdf xyz',
                cue: 'hello'
            });

            expect(result.isCorrect).toBe(false);
            expect(result.errorType).toBe('ungrammatical');
            expect(result.intentLabels).toEqual(['gibberish']);
        });

        it('should handle closedResponse responseType correctly', async () => {
            const result = await processAnswerLogic({
                stepData: { responseType: 'closedResponse', explanation: 'explain' },
                userResponse: 'hello there',
                cue: 'hello there',
                courseLevel: 'B1'
            });
            expect(result.isCorrect).toBe(true);
            expect(result.explanation).toBe('explain');
            expect(result.normalizeduserResponse).toBe('hello there');
        });

        it('should mark incorrect for low similarity closedResponse', async () => {
            const result = await processAnswerLogic({
                stepData: { responseType: 'closedResponse', explanation: 'explain' },
                userResponse: 'hello',
                cue: 'goodbye',
                courseLevel: 'B1'
            });
            expect(result.isCorrect).toBe(false);
        });
    });

    describe('validateAnswerPrecheck', () => {
        const defaultArgs = ['cue', { responseType: 'openResponse' }, 'B1', {}, []];

        it('should return valid if not openResponse', async () => {
            const result = await validateAnswerPrecheck('val', 'cue', { responseType: 'closedResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(true);
        });

        it('should mark invalid if already used', async () => {
            const result = await validateAnswerPrecheck('test answer', 'cue', { responseType: 'openResponse' }, 'B1', {}, ['test answer']);
            expect(result.isValid).toBe(false);
            expect(result.warningMessage).toBeDefined();
        });

        it('should mark invalid if similarity with cue is high', async () => {
            const result = await validateAnswerPrecheck('this is a test cue', 'this is a test cue', { responseType: 'openResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(false);
            expect(result.warningMessage).toBeDefined();
        });

        it('should mark valid if word count meets requirements', async () => {
            const result = await validateAnswerPrecheck('one two three four five', 'different cue', { responseType: 'openResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(true);
        });

        it('should mark invalid if word count is too low for level', async () => {
            const resultA2 = await validateAnswerPrecheck('one two three', 'different cue', { responseType: 'openResponse' }, 'A2', {}, []);
            expect(resultA2.isValid).toBe(false);

            const resultB1 = await validateAnswerPrecheck('one two three four', 'different cue', { responseType: 'openResponse' }, 'B1', {}, []);
            expect(resultB1.isValid).toBe(false);

            const resultB2 = await validateAnswerPrecheck('one two three four five', 'different cue', { responseType: 'openResponse' }, 'B2', {}, []);
            expect(resultB2.isValid).toBe(false);
        });

        it('should mark invalid if profane', async () => {
            const result = await validateAnswerPrecheck('one two three four five shit', 'different cue', { responseType: 'openResponse' }, 'B1', {}, []);
            expect(result.isValid).toBe(false);
            expect(result.warningMessage).toBeDefined();
        });
    });
});
