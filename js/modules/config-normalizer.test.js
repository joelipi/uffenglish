import { describe, it, expect } from 'vitest';
import { normalizeConfig } from './config-normalizer.js';

describe('normalizeConfig', () => {
    it('returns immediately if configData is null or undefined or missing lessons', () => {
        const configData1 = null;
        normalizeConfig(configData1, 'es');
        expect(configData1).toBeNull();

        const configData2 = {};
        normalizeConfig(configData2, 'es');
        expect(configData2).toEqual({});
    });

    it('normalizes lesson fields', () => {
        const configData = {
            lessons: [{
                title: { en: 'Title', es: 'Titulo' },
                mission: { en: 'Mission', es: 'Mision' },
                setting: { en: 'Setting', es: 'Config' },
                roleOther: { en: 'Other', es: 'Otro' },
                roleUser: { en: 'User', es: 'Usuario' },
            }]
        };
        normalizeConfig(configData, 'es');
        expect(configData.lessons[0].title).toBe('Titulo');
        expect(configData.lessons[0].mission).toBe('Mision');
        expect(configData.lessons[0].setting).toBe('Config');
        expect(configData.lessons[0].roleOther).toBe('Otro');
        expect(configData.lessons[0].roleUser).toBe('Usuario');
    });

    it('normalizes step fields and applies default speech step', () => {
        const configData = {
            lessons: [{
                steps: [{
                    stepType: 'speech',
                    explanation: { en: 'Exp', es: 'Exp_es' },
                    translation: { en: 'Trans', es: 'Trans_es' },
                    subtitles: { en: 'Sub', es: 'Sub_es' },
                    cue: { en: 'Cue', es: 'Cue_es' }, // Should use en
                    incues: [{ en: 'Incue1', es: 'Incue1_es' }, { en: 'Incue2', es: 'Incue2_es' }]
                }]
            }]
        };
        normalizeConfig(configData, 'es');
        const step = configData.lessons[0].steps[0];
        expect(step.step).toBeDefined(); // Since default is retrieved via Strings.get
        expect(step.explanation).toBe('Exp_es');
        expect(step.translation).toBe('Trans_es');
        expect(step.subtitles).toBe('Sub_es');
        expect(step.cue).toBe('Cue'); // Always english
        expect(step.incues).toEqual(['Incue1_es', 'Incue2_es']);
    });

    it('normalizes step field if it already exists', () => {
        const configData = {
            lessons: [{
                steps: [{
                    stepType: 'speech',
                    step: { en: 'Custom Step', es: 'Paso Personalizado' }
                }]
            }]
        };
        normalizeConfig(configData, 'es');
        expect(configData.lessons[0].steps[0].step).toBe('Paso Personalizado');
    });

    it('uses en as default lang if lang is null or undefined', () => {
        const configData = {
            lessons: [{
                title: { en: 'Title', es: 'Titulo' },
            }]
        };
        normalizeConfig(configData, null);
        expect(configData.lessons[0].title).toBe('Title');
    });
});
