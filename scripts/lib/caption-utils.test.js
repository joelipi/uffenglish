// scripts/lib/caption-utils.test.js
// Unit tests for the pure caption pipeline (stories/009-auto-caption-simple-videos).
import { describe, it, expect, vi } from 'vitest';
import { SimpleVideoStateController } from '../../src/modules/video/simple-video-controller.js';
import {
    WHISPER_MODEL,
    DEEPSEEK_MODEL,
    isUsableBaseSha,
    findNewSimpleVideoTargets,
    secondsToSrtTimestamp,
    chunksToSrt,
    parseSrt,
    validateTranslatedSrt,
    applyCaptionsToText,
    buildCaptionEdits,
} from './caption-utils.js';

describe('module constants', () => {
    it('pins the Whisper and DeepSeek models', () => {
        expect(WHISPER_MODEL).toBe('onnx-community/whisper-base.en');
        expect(DEEPSEEK_MODEL).toBe('deepseek-v4-flash');
    });
});

describe('isUsableBaseSha', () => {
    it('rejects all-zeros, non-hex, and short strings', () => {
        expect(isUsableBaseSha('0'.repeat(40))).toBe(false);
        expect(isUsableBaseSha('not-a-sha')).toBe(false);
        expect(isUsableBaseSha('abc')).toBe(false);
    });

    it('accepts a valid 40-hex commit id', () => {
        expect(isUsableBaseSha('a'.repeat(40))).toBe(true);
        expect(isUsableBaseSha('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    });
});

describe('findNewSimpleVideoTargets', () => {
    it('returns one target for a newly added simpleVideoUrl step', () => {
        const before = { lessons: [{ steps: [{ simpleVideoUrl: 'old' }] }] };
        const after = { lessons: [{ steps: [{ simpleVideoUrl: 'old' }, { simpleVideoUrl: 'new' }] }] };
        expect(findNewSimpleVideoTargets(before, after)).toEqual([
            { slug: 'new', lessonIndex: 0, stepKey: 'steps', stepIndex: 1 },
        ]);
    });

    it('never captions a slug that already existed (even uncaptioned)', () => {
        const before = { lessons: [{ steps: [{ simpleVideoUrl: 'shared' }] }] };
        const after = { lessons: [{ steps: [{ simpleVideoUrl: 'shared' }, { simpleVideoUrl: 'shared' }] }] };
        expect(findNewSimpleVideoTargets(before, after)).toEqual([]);
    });

    it('skips a new step that already has a subtitles object', () => {
        const before = { lessons: [{ steps: [] }] };
        const after = { lessons: [{ steps: [{ simpleVideoUrl: 'new', subtitles: { en: 'x' } }] }] };
        expect(findNewSimpleVideoTargets(before, after)).toEqual([]);
    });

    it('ignores interactiveVideoUrl and introBackgroundVideoUrl steps', () => {
        const before = { lessons: [{ steps: [] }] };
        const after = {
            lessons: [{ steps: [{ interactiveVideoUrl: 'a' }, { introBackgroundVideoUrl: 'b' }] }],
        };
        expect(findNewSimpleVideoTargets(before, after)).toEqual([]);
    });

    it('targets legacy questions arrays with stepKey questions', () => {
        const before = { lessons: [{ questions: [] }] };
        const after = { lessons: [{ questions: [{ simpleVideoUrl: 'new' }] }] };
        expect(findNewSimpleVideoTargets(before, after)).toEqual([
            { slug: 'new', lessonIndex: 0, stepKey: 'questions', stepIndex: 0 },
        ]);
    });

    it('returns two targets when two added steps share one new slug', () => {
        const before = { lessons: [{ steps: [] }] };
        const after = { lessons: [{ steps: [{ simpleVideoUrl: 'new' }, { simpleVideoUrl: 'new' }] }] };
        expect(findNewSimpleVideoTargets(before, after)).toEqual([
            { slug: 'new', lessonIndex: 0, stepKey: 'steps', stepIndex: 0 },
            { slug: 'new', lessonIndex: 0, stepKey: 'steps', stepIndex: 1 },
        ]);
    });

    it('treats a null before config (new file) as having no existing slugs', () => {
        const after = {
            lessons: [
                { steps: [{ simpleVideoUrl: 'a' }, { simpleVideoUrl: 'b', subtitles: {} }] },
                { questions: [{ simpleVideoUrl: 'c' }] },
            ],
        };
        expect(findNewSimpleVideoTargets(null, after)).toEqual([
            { slug: 'a', lessonIndex: 0, stepKey: 'steps', stepIndex: 0 },
            { slug: 'c', lessonIndex: 1, stepKey: 'questions', stepIndex: 0 },
        ]);
    });
});

describe('secondsToSrtTimestamp', () => {
    it('formats seconds as HH:MM:SS,mmm', () => {
        expect(secondsToSrtTimestamp(0)).toBe('00:00:00,000');
        expect(secondsToSrtTimestamp(3.5)).toBe('00:00:03,500');
        expect(secondsToSrtTimestamp(3661.007)).toBe('01:01:01,007');
    });
});

describe('chunksToSrt', () => {
    it('emits 1-based cues with trimmed text', () => {
        const srt = chunksToSrt([
            { timestamp: [0.5, 3], text: ' Hello' },
            { timestamp: [3.5, 6], text: 'World' },
        ]);
        expect(srt).toBe(
            '1\n00:00:00,500 --> 00:00:03,000\nHello\n\n2\n00:00:03,500 --> 00:00:06,000\nWorld',
        );
    });

    it('returns empty string for no chunks', () => {
        expect(chunksToSrt([])).toBe('');
    });

    it('skips chunks with empty/whitespace text', () => {
        const srt = chunksToSrt([
            { timestamp: [0, 1], text: '   ' },
            { timestamp: [1, 2], text: 'Real' },
        ]);
        expect(srt).toBe('1\n00:00:01,000 --> 00:00:02,000\nReal');
    });

    it('uses start as end when Whisper reports a null end', () => {
        const srt = chunksToSrt([{ timestamp: [2, null], text: 'Hi' }]);
        expect(srt).toBe('1\n00:00:02,000 --> 00:00:02,000\nHi');
    });
});

describe('parseSrt round-trip', () => {
    it('recovers cue count, timings, and text from chunksToSrt output', () => {
        const chunks = [
            { timestamp: [0.5, 3], text: 'Hello' },
            { timestamp: [3.5, 6], text: 'World' },
        ];
        const cues = parseSrt(chunksToSrt(chunks));
        expect(cues.length).toBe(2);
        expect(cues[0].start).toBeCloseTo(0.5, 3);
        expect(cues[0].end).toBeCloseTo(3, 3);
        expect(cues[0].text).toBe('Hello');
        expect(cues[1].start).toBeCloseTo(3.5, 3);
        expect(cues[1].end).toBeCloseTo(6, 3);
        expect(cues[1].text).toBe('World');
    });
});

describe('player compatibility', () => {
    it('SimpleVideoStateController parses generated SRT as timed subtitles', () => {
        const srt = chunksToSrt([
            { timestamp: [0.5, 3], text: 'Hello' },
            { timestamp: [3.5, 6], text: 'World' },
        ]);
        const controller = new SimpleVideoStateController({});
        controller.initSubtitles(srt);
        expect(controller.state.isTimedSubtitles).toBe(true);
        expect(controller.state.timedSubtitles.length).toBe(2);
        expect(controller.state.timedSubtitles[0]).toEqual({ start: 0.5, end: 3, text: 'Hello' });
    });
});

describe('validateTranslatedSrt', () => {
    const enSrt = chunksToSrt([
        { timestamp: [0.5, 3], text: 'Hello' },
        { timestamp: [3.5, 6], text: 'World' },
    ]);

    it('accepts a translation that preserves cues and timestamps', () => {
        const translated = enSrt.replace('Hello', 'Hola').replace('World', 'Mundo');
        expect(validateTranslatedSrt(enSrt, translated)).toEqual({ ok: true });
    });

    it('rejects a translation with a different cue count', () => {
        const translated = '1\n00:00:00,500 --> 00:00:03,000\nHola';
        const result = validateTranslatedSrt(enSrt, translated);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/cue count mismatch/);
    });

    it('rejects a translation with a shifted timestamp', () => {
        const translated = enSrt.replace('00:00:00,500', '00:00:01,500');
        const result = validateTranslatedSrt(enSrt, translated);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/start mismatch/);
    });
});

describe('applyCaptionsToText', () => {
    const text = `{
  "lessons": [
    {
      "steps": [
        {
          "cue": {
            "en": "Hello",
            "es": "Hola"
          },
          "simpleVideoUrl": "new_video"
        },
        {
          "cue": {
            "en": "Bye"
          },
          "simpleVideoUrl": "other"
        }
      ]
    }
  ]
}`;

    const captionsBySlug = {
        new_video: {
            en: '1\n00:00:00,500 --> 00:00:03,000\nHello',
            es: '1\n00:00:00,500 --> 00:00:03,000\nHola',
            pt: '1\n00:00:00,500 --> 00:00:03,000\nOlá',
            fr: '1\n00:00:00,500 --> 00:00:03,000\nBonjour',
            hi: '1\n00:00:00,500 --> 00:00:03,000\nनमस्ते',
            bn: '1\n00:00:00,500 --> 00:00:03,000\nহ্যালো',
        },
    };

    const targets = [{ slug: 'new_video', lessonIndex: 0, stepKey: 'steps', stepIndex: 0 }];

    it('injects subtitles with exactly the six language keys', () => {
        const out = applyCaptionsToText(text, targets, captionsBySlug);
        const parsed = JSON.parse(out);
        const subtitles = parsed.lessons[0].steps[0].subtitles;
        expect(Object.keys(subtitles)).toEqual(['en', 'es', 'pt', 'fr', 'hi', 'bn']);
        expect(subtitles.en).toBe(captionsBySlug.new_video.en);
        expect(subtitles.hi).toBe(captionsBySlug.new_video.hi);
        expect(subtitles.bn).toBe(captionsBySlug.new_video.bn);
    });

    it('leaves an unrelated inline cue line byte-identical', () => {
        const originalLine = text.split('\n').find((line) => line.includes('"Bye"'));
        const out = applyCaptionsToText(text, targets, captionsBySlug);
        const cueLine = out.split('\n').find((line) => line.includes('"Bye"'));
        expect(cueLine).toBe(originalLine);
    });

    it('round-trips through JSON.parse without data loss', () => {
        const out = applyCaptionsToText(text, targets, captionsBySlug);
        const parsed = JSON.parse(out);
        expect(parsed.lessons[0].steps[1].cue.en).toBe('Bye');
        expect(parsed.lessons[0].steps[0].cue.es).toBe('Hola');
        expect(parsed.lessons[0].steps[0].simpleVideoUrl).toBe('new_video');
    });

    it('returns text unchanged when the target step already has subtitles', () => {
        const withSubtitles = `{
  "lessons": [
    {
      "steps": [
        {
          "simpleVideoUrl": "new_video",
          "subtitles": { "en": "existing" }
        }
      ]
    }
  ]
}`;
        const out = applyCaptionsToText(withSubtitles, targets, captionsBySlug);
        expect(out).toBe(withSubtitles);
    });

    it('is idempotent across repeated calls', () => {
        const first = applyCaptionsToText(text, targets, captionsBySlug);
        const second = applyCaptionsToText(text, targets, captionsBySlug);
        expect(second).toBe(first);
    });

    it('throws an Error naming the slug when captions are missing', () => {
        expect(() => applyCaptionsToText(text, targets, {})).toThrow(/new_video/);
    });
});

describe('buildCaptionEdits', () => {
    const beforeText = JSON.stringify({ lessons: [{ steps: [] }] });
    const afterText = JSON.stringify(
        { lessons: [{ steps: [{ simpleVideoUrl: 'new_video' }] }] },
        null,
        2,
    );
    const languages = ['en', 'es', 'pt', 'fr', 'hi', 'bn'];

    it('transcribes once per unique slug and translates once per non-English language', async () => {
        const transcribe = vi.fn(async () => [{ timestamp: [0.5, 3], text: 'Hello' }]);
        const translate = vi.fn(async (enSrt, lang) => enSrt.replace('Hello', `Hola-${lang}`));

        const { text, generated } = await buildCaptionEdits({
            beforeText,
            afterText,
            transcribe,
            translate,
            languages,
        });

        expect(transcribe).toHaveBeenCalledTimes(1);
        expect(transcribe).toHaveBeenCalledWith('new_video');
        expect(translate).toHaveBeenCalledTimes(5);
        expect(generated).toEqual(['new_video']);

        const parsed = JSON.parse(text);
        const subtitles = parsed.lessons[0].steps[0].subtitles;
        expect(subtitles.en).toBe(chunksToSrt([{ timestamp: [0.5, 3], text: 'Hello' }]));
        expect(subtitles.es).toBe(chunksToSrt([{ timestamp: [0.5, 3], text: 'Hola-es' }]));
    });

    it('rejects when a translation is shape-mismatched and writes nothing', async () => {
        const transcribe = vi.fn(async () => [{ timestamp: [0.5, 3], text: 'Hello' }]);
        const translate = vi.fn(async () => '1\n00:00:00,000 --> 00:00:01,000\nWrong');

        await expect(
            buildCaptionEdits({ beforeText, afterText, transcribe, translate, languages }),
        ).rejects.toThrow(/Translation validation failed/);
    });
});