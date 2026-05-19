import { describe, it, expect } from 'vitest';
import { isAvailable, getAvailableChannels, handleGrammarChannel } from './composerMenu.js';

describe('composerMenu', () => {
    it('isAvailable should return true for @support in all contexts', () => {
        expect(isAvailable('@support', { screen: 'home', lessonState: null, chatMode: 'chat' })).toBe(true);
        expect(isAvailable('@support', { screen: 'lesson', lessonState: 'question_active', chatMode: 'answer' })).toBe(true);
    });

    it('isAvailable should return false for everything else if chatMode is answer', () => {
        expect(isAvailable('@grammar', { screen: 'lesson', lessonState: 'question_active', chatMode: 'answer' })).toBe(false);
        expect(isAvailable('@vocabulary', { screen: 'lesson', lessonState: 'question_active', chatMode: 'answer' })).toBe(false);
    });

    it('handleGrammarChannel should return null if askWorker is not a function', async () => {
        const result = await handleGrammarChannel('test', null);
        expect(result).toBeNull();
    });
});
