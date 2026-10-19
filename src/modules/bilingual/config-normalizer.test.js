import { describe, it, expect } from 'vitest';
import { normalizeConfig, resolveConfigLanguage, isConfigLanguageSettled, getAppLanguage, getAppLanguageFor } from './config-normalizer.js';
import { appStore } from '../store/store.js';

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
        // Lesson titles are curriculum labels, normalized to English regardless
        // of the user's language.
        expect(configData.lessons[0].title).toBe('Title');
        // mission/setting/roleOther/roleUser kept as objects for bilingual display
        expect(configData.lessons[0].mission).toEqual({ en: 'Mission', es: 'Mision' });
        expect(configData.lessons[0].setting).toEqual({ en: 'Setting', es: 'Config' });
        expect(configData.lessons[0].roleOther).toEqual({ en: 'Other', es: 'Otro' });
        expect(configData.lessons[0].roleUser).toEqual({ en: 'User', es: 'Usuario' });
    });

    it('resolves an object lesson title to English even for a non-English user', () => {
        const configData = { lessons: [{ title: { en: 'A', es: 'B' } }] };
        normalizeConfig(configData, 'es');
        expect(configData.lessons[0].title).toBe('A');
    });

    it('leaves a plain-string lesson title unchanged', () => {
        const configData = { lessons: [{ title: 'Make 3 questions…' }] };
        normalizeConfig(configData, 'es');
        expect(configData.lessons[0].title).toBe('Make 3 questions…');
    });

    it('normalizes step fields and applies default speech step', () => {
        const configData = {
            lessons: [{
                steps: [{
                    responseType: 'speech',
                    step: { en: 'Step', es: 'Step_es'},
                    explanation: { en: 'Exp', es: 'Exp_es' },
                    subtitles: { en: 'Sub', es: 'Sub_es' },
                    cue: { en: 'Cue', es: 'Cue_es' }, // Kept as object for bilingual display
                    incues: [{ en: 'Incue1', es: 'Incue1_es' }, { en: 'Incue2', es: 'Incue2_es' }]
                }]
            }]
        };
        normalizeConfig(configData, 'es');
        const step = configData.lessons[0].steps[0];
        expect(step.step).toBe('Step_es'); // Since default is retrieved via Strings.get
        expect(step.explanation).toBe('Exp_es');
        expect(step.subtitles).toBe('Sub_es');
        expect(step.cue).toEqual({ en: 'Cue', es: 'Cue_es' }); // Kept as object for bilingual display
        expect(step.incues).toEqual(['Incue1_es', 'Incue2_es']);
    });

    it('normalizes step fields and handles legacy fields', () => {
        const configData = {
            lessons: [{
                questions: [{
                    inputType: 'speech',
                    question: { en: 'Question', es: 'Pregunta' },
                    explanation: { en: 'Exp', es: 'Exp_es' },
                    subtitles: { en: 'Sub', es: 'Sub_es' },
                    cue: { en: 'Cue', es: 'Cue_es' }, // Kept as object for bilingual display
                    incues: [{ en: 'Incue1', es: 'Incue1_es' }, { en: 'Incue2', es: 'Incue2_es' }]
                }]
            }]
        };
        normalizeConfig(configData, 'es');
        const step = configData.lessons[0].steps[0];
        expect(step.step).toBe('Pregunta');
        expect(step.responseType).toBe('speech');
        expect(step.explanation).toBe('Exp_es');
        expect(step.subtitles).toBe('Sub_es');
        expect(step.cue).toEqual({ en: 'Cue', es: 'Cue_es' }); // Kept as object for bilingual display
        expect(step.incues).toEqual(['Incue1_es', 'Incue2_es']);
    });

    it('should normalize step fields correctly, cue kept as object for bilingual display', () => {
        const configData = {
            lessons: [{
                steps: [{
                    responseType: 'speech',
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

    it('substitutes {friendCode} wildcards in video URLs (friend-concat answers lesson)', () => {
        appStore.getState().setFriendCode('alice42');
        const configData = {
            lessons: [{
                steps: [
                    { responseType: 'friendClosedResponse', interactiveVideoUrl: '{friendCode}model-w-response-01' },
                    { responseType: 'friendClosedResponse', interactiveVideoUrl: '{friendCode}model-w-response-02' },
                    { responseType: 'viewAndContinue', simpleVideoUrl: 'testvideo05' },
                ]
            }]
        };
        normalizeConfig(configData, 'en');
        expect(configData.lessons[0].steps[0].interactiveVideoUrl).toBe('alice42-model-w-response-01');
        expect(configData.lessons[0].steps[1].interactiveVideoUrl).toBe('alice42-model-w-response-02');
        // Non-friend steps untouched
        expect(configData.lessons[0].steps[2].simpleVideoUrl).toBe('testvideo05');
        appStore.getState().setFriendCode(null);
    });

    it('strips {friendCode} wildcard when no friendCode set', () => {
        appStore.getState().setFriendCode(null);
        const configData = {
            lessons: [{
                steps: [{ responseType: 'friendClosedResponse', interactiveVideoUrl: '{friendCode}model-w-response-01' }]
            }]
        };
        normalizeConfig(configData, 'en');
        expect(configData.lessons[0].steps[0].interactiveVideoUrl).toBe('model-w-response-01');
    });
});

describe('resolveConfigLanguage', () => {
    // Guest language must win over the profile language: a friend lesson adopts
    // the browser language silently (useGuestModalGuard) and can write it after
    // the config fetch resolves. Without guest-first precedence, subtitles get
    // flattened to English for a Spanish guest.
    it('prefers the guest language over the profile language', () => {
        expect(resolveConfigLanguage('ES', 'EN')).toBe('ES');
    });

    it('falls back to the profile language when there is no guest language', () => {
        expect(resolveConfigLanguage(null, 'ES')).toBe('ES');
        expect(resolveConfigLanguage(undefined, 'PT')).toBe('PT');
        expect(resolveConfigLanguage('', 'BN')).toBe('BN');
    });

    it('defaults to en when neither is set', () => {
        expect(resolveConfigLanguage(null, null)).toBe('en');
        expect(resolveConfigLanguage(undefined, undefined)).toBe('en');
        expect(resolveConfigLanguage('', '')).toBe('en');
    });
});

describe('getAppLanguage / getAppLanguageFor', () => {
    // The single source of truth for non-component language reads: the store's
    // guest choice wins over the mirrored profile language, defaulting to 'en'.
    // A French guest whose async bootstrap wrote profile 'EN' still gets 'FR'.
    const withStore = (guestNativeLanguage, userData, fn) => {
        const prev = appStore.getState();
        appStore.setState({ guestNativeLanguage, userData });
        try {
            fn();
        } finally {
            appStore.setState({ guestNativeLanguage: prev.guestNativeLanguage, userData: prev.userData });
        }
    };

    it('prefers the store guest language over the profile language', () => {
        expect(getAppLanguage({ guestNativeLanguage: 'FR', userData: { native_language: 'EN' } })).toBe('FR');
        withStore('FR', { native_language: 'EN' }, () => {
            expect(getAppLanguage()).toBe('FR');
            expect(getAppLanguageFor({ native_language: 'EN' })).toBe('FR');
        });
    });

    it('falls back to the profile language and then to en', () => {
        expect(getAppLanguage({ guestNativeLanguage: null, userData: { native_language: 'ES' } })).toBe('ES');
        expect(getAppLanguage({ guestNativeLanguage: null, userData: null })).toBe('en');
        withStore(null, { native_language: 'ES' }, () => {
            expect(getAppLanguage()).toBe('ES');
            expect(getAppLanguageFor({ native_language: 'ES' })).toBe('ES');
        });
        withStore(null, null, () => {
            expect(getAppLanguage()).toBe('en');
            expect(getAppLanguageFor(null)).toBe('en');
        });
    });
});

describe('isConfigLanguageSettled', () => {
    // The guest modal opens AFTER the config fetch resolves, so the config must
    // not be normalized until the language is settled — otherwise subtitles are
    // flattened to English before the guest picks a language.
    it('is settled for a logged-in user (profile language is authoritative)', () => {
        expect(isConfigLanguageSettled({ isLoggedIn: true, guestLang: null })).toBe(true);
        expect(isConfigLanguageSettled({ isLoggedIn: true, guestLang: 'ES' })).toBe(true);
    });

    it('is settled for a guest once a language is chosen', () => {
        expect(isConfigLanguageSettled({ isLoggedIn: false, guestLang: 'ES' })).toBe(true);
        expect(isConfigLanguageSettled({ isLoggedIn: false, guestLang: 'EN' })).toBe(true);
    });

    it('is NOT settled for a guest with no language yet', () => {
        expect(isConfigLanguageSettled({ isLoggedIn: false, guestLang: null })).toBe(false);
        expect(isConfigLanguageSettled({ isLoggedIn: false, guestLang: undefined })).toBe(false);
        expect(isConfigLanguageSettled({ isLoggedIn: false, guestLang: '' })).toBe(false);
    });

    it('is NOT settled when called with no arguments', () => {
        expect(isConfigLanguageSettled()).toBe(false);
        expect(isConfigLanguageSettled({})).toBe(false);
    });
});

describe('normalizeConfig localizes subtitles to the resolved language', () => {
    it('flattens subtitles to the guest language, not the profile language', () => {
        const configData = {
            lessons: [{
                steps: [{
                    responseType: 'viewAndContinue',
                    simpleVideoUrl: 'testvideointro',
                    subtitles: { en: 'English sub', es: 'Subtítulo español', pt: 'Legenda', bn: 'বাংলা' },
                }]
            }]
        };
        normalizeConfig(configData, resolveConfigLanguage('ES', 'EN'));
        expect(configData.lessons[0].steps[0].subtitles).toBe('Subtítulo español');
    });

    it('flattens subtitles to French for an uppercase FR guest', () => {
        // The reported regression: the store holds uppercase guest codes, and
        // the lesson carried no fr — UI French, subtitles English. With fr
        // content present, an 'FR' guest must get the French track, not English.
        const configData = {
            lessons: [{
                steps: [{
                    responseType: 'viewAndContinue',
                    simpleVideoUrl: 'testvideointro',
                    subtitles: { en: 'English sub', es: 'Subtítulo español', fr: 'Sous-titre français' },
                }]
            }]
        };
        normalizeConfig(configData, getAppLanguage({ guestNativeLanguage: 'FR', userData: { native_language: 'EN' } }));
        expect(configData.lessons[0].steps[0].subtitles).toBe('Sous-titre français');
    });

    it('falls back to English when the resolved language has no translation', () => {
        const configData = {
            lessons: [{
                steps: [{
                    responseType: 'viewAndContinue',
                    simpleVideoUrl: 'testvideointro',
                    subtitles: { en: 'English sub', es: 'Subtítulo español' },
                }]
            }]
        };
        normalizeConfig(configData, resolveConfigLanguage('FR', 'EN'));
        expect(configData.lessons[0].steps[0].subtitles).toBe('English sub');
    });

    it('re-localizes from a pristine clone after the language changes', () => {
        // Reproduces the real flow: the config is fetched and normalized to
        // English BEFORE the guest picks Spanish in the modal. normalizeConfig
        // mutates in place and getLocalizedTranslation returns flattened strings
        // as-is, so re-normalizing the SAME object stays English. AppLayout keeps
        // a pristine copy and re-normalizes a clone; this locks that contract.
        const raw = {
            lessons: [{
                steps: [{
                    responseType: 'viewAndContinue',
                    simpleVideoUrl: 'testvideointro',
                    subtitles: { en: 'English sub', es: 'Subtítulo español' },
                }]
            }]
        };

        // First pass: English (guest language not yet chosen).
        const first = structuredClone(raw);
        normalizeConfig(first, resolveConfigLanguage(null, 'EN'));
        expect(first.lessons[0].steps[0].subtitles).toBe('English sub');

        // Re-normalizing the already-flattened object is a no-op (the bug).
        normalizeConfig(first, 'ES');
        expect(first.lessons[0].steps[0].subtitles).toBe('English sub');

        // Second pass from the pristine clone: Spanish.
        const second = structuredClone(raw);
        normalizeConfig(second, resolveConfigLanguage('ES', 'EN'));
        expect(second.lessons[0].steps[0].subtitles).toBe('Subtítulo español');
    });

    it('localizes config content for region-tagged codes (bn-BD → bn)', () => {
        // A profile/browser language of 'bn-BD' localizes the UI via
        // Strings.get (which strips the region) and must localize config
        // content the same way; otherwise Bengali shows a Bengali UI but
        // English lesson subtitles.
        const configData = {
            lessons: [{
                steps: [{
                    responseType: 'viewAndContinue',
                    simpleVideoUrl: 'testvideointro',
                    subtitles: { en: 'English sub', bn: 'বাংলা সাবটাইটেল', es: 'Subtítulo español' },
                }]
            }]
        };
        normalizeConfig(configData, 'bn-BD');
        expect(configData.lessons[0].steps[0].subtitles).toBe('বাংলা সাবটাইটেল');
    });
});

describe('normalizer/builder UGC contract', () => {
    // The normalized friend slug must equal the key buildUgcSegmentKey writes
    // for the same logical clip — WHEN the session codes are the recorder and
    // the inviter. Any other viewer/code combination addresses a different pair
    // and must not be expected to match (see the addressing decision).
    it('resolves to the builder key when session codes are recorder+inviter', async () => {
        const { resolveShareCodes } = await import('./config-normalizer.js');
        const { buildUgcSegmentKey } = await import('../video/video-processor-logic.js');
        const ref = '{friendCode}{selfCode}-wouldyourather-a-01';
        const resolved = resolveShareCodes(ref, { friendCode: 'hu7ni', selfCode: 'mncb1' });
        const key = buildUgcSegmentKey({ shareCode: 'hu7ni', inviterCode: 'mncb1', courseId: 'wouldyourather', lessonId: 'a', index: 1 });
        expect(`videos/${resolved}.mp4`).toBe(key);
    });

    it('resolves {selfCode} from the viewer code', async () => {
        const { resolveShareCodes } = await import('./config-normalizer.js');
        expect(resolveShareCodes('{friendCode}{selfCode}-c-l-01', { friendCode: 'aa11', selfCode: 'bb22' }))
            .toBe('aa11-bb22-c-l-01');
        expect(resolveShareCodes('{friendCode}{selfCode}-c-l-01', { friendCode: 'aa11', selfCode: null }))
            .toBe('aa11-c-l-01');
    });
});
