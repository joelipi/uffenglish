import { describe, it, expect, vi } from 'vitest';
import { normalizeConfig } from './config-normalizer.js';

vi.mock('../data/strings.js', () => ({
    default: {
        get: (key, lang) => `${key}_${lang}` // Mock Strings.get
    }
}));

describe('normalizeConfig', () => {
    it('should mutate configData and apply defaults', () => {
        const configData = {
            lessons: [
                {
                    title: { en: 'Hello', es: 'Hola' },
                    steps: [
                        { stepType: 'speech' }
                    ]
                }
            ]
        };

        normalizeConfig(configData, 'es');

        expect(configData.lessons[0].title).toBe('Hola');
        // Because "step" is missing and stepType is speech, it gets the default
        expect(configData.lessons[0].steps[0].step).toBe('default_q_speech_es');
    });

    it('should handle undefined or missing config data gracefully', () => {
        const configData = null;
        normalizeConfig(configData, 'en'); // should not throw
    });

    it('should default language to en if not provided', () => {
         const configData = {
            lessons: [
                {
                    title: { en: 'Hello', es: 'Hola' }
                }
            ]
        };
        normalizeConfig(configData); // lang defaults to 'en'
        expect(configData.lessons[0].title).toBe('Hello');
    });

    it('should normalize step fields correctly, always using en for cue', () => {
        const configData = {
            lessons: [
                {
                    steps: [
                        {
                            cue: { en: 'cue_en', es: 'cue_es' },
                            subtitles: { en: 'sub_en', es: 'sub_es' },
                            incues: [ { en: 'incue_en', es: 'incue_es' } ]
                        }
                    ]
                }
            ]
        };
        normalizeConfig(configData, 'es');

        expect(configData.lessons[0].steps[0].cue).toBe('cue_en'); // Force EN for cue
        expect(configData.lessons[0].steps[0].subtitles).toBe('sub_es');
        expect(configData.lessons[0].steps[0].incues[0]).toBe('incue_es');
    });
});
