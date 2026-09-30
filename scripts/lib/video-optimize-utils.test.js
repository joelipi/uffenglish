// scripts/lib/video-optimize-utils.test.js
// Story 032: pure planning for the R2 lesson-video optimizer.
import { describe, it, expect } from 'vitest';
import {
    collectVideoTargets,
    scanTopLevelBoxes,
    isFaststart,
    planVideoOptimize,
    remuxArgs,
    reencodeArgs,
    videoFilename,
    videoR2Key,
    videoSourceUrl,
    MAX_VIDEO_WIDTH,
    MAX_TOTAL_BITRATE_BPS,
} from './video-optimize-utils.js';

function box(type, payload = Buffer.alloc(0)) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, payload]);
}

function largeBox(type, payload = Buffer.alloc(0)) {
    const header = Buffer.alloc(16);
    header.writeUInt32BE(1, 0);
    header.write(type, 4, 'latin1');
    header.writeBigUInt64BE(BigInt(16 + payload.length), 8);
    return Buffer.concat([header, payload]);
}

function eofBox(type, payload = Buffer.alloc(0)) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, payload]);
}

describe('collectVideoTargets', () => {
    it('collects interactive/simple/intro slugs once in first-seen order', () => {
        const configs = [
            {
                lessons: [
                    {
                        steps: [
                            { interactiveVideoUrl: 'i' },
                            { simpleVideoUrl: 's' },
                            { introBackgroundVideoUrl: 'b' },
                            { simpleVideoUrl: 's' },
                        ],
                    },
                ],
            },
            { lessons: [{ steps: [{ simpleVideoUrl: 'i' }, { simpleVideoUrl: 'z' }] }] },
        ];
        expect(collectVideoTargets(configs)).toEqual([
            { slug: 'i' },
            { slug: 's' },
            { slug: 'b' },
            { slug: 'z' },
        ]);
    });

    it('prefers interactive over simple over intro for one step', () => {
        const configs = [
            { lessons: [{ steps: [{ interactiveVideoUrl: 'i', simpleVideoUrl: 's', introBackgroundVideoUrl: 'b' }] }] },
        ];
        expect(collectVideoTargets(configs)).toEqual([{ slug: 'i' }]);
    });

    it('skips {friendCode} templates and ignores questions lists', () => {
        const configs = [
            {
                lessons: [
                    {
                        steps: [
                            { simpleVideoUrl: '{friendCode}model-w-response-01' },
                            { simpleVideoUrl: 'real' },
                        ],
                        questions: [{ simpleVideoUrl: 'ignored' }],
                    },
                ],
            },
        ];
        expect(collectVideoTargets(configs)).toEqual([{ slug: 'real' }]);
    });

    it('returns [] for null/empty input', () => {
        expect(collectVideoTargets(null)).toEqual([]);
        expect(collectVideoTargets([])).toEqual([]);
        expect(collectVideoTargets([{}])).toEqual([]);
    });
});

describe('scanTopLevelBoxes / isFaststart', () => {
    it('detects moov before mdat as faststart', () => {
        const buf = Buffer.concat([box('ftyp'), box('moov'), box('mdat', Buffer.alloc(16))]);
        expect(isFaststart(buf)).toBe(true);
        expect(scanTopLevelBoxes(buf).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    });

    it('detects mdat before moov as not faststart', () => {
        const buf = Buffer.concat([box('ftyp'), box('mdat', Buffer.alloc(16)), box('moov')]);
        expect(isFaststart(buf)).toBe(false);
    });

    it('handles size=0 (runs to EOF)', () => {
        const buf = Buffer.concat([box('ftyp'), eofBox('mdat', Buffer.alloc(16))]);
        expect(isFaststart(buf)).toBe(false);
    });

    it('handles 64-bit largesize boxes', () => {
        const buf = Buffer.concat([box('ftyp'), largeBox('mdat', Buffer.alloc(16)), box('moov')]);
        expect(isFaststart(buf)).toBe(false);
    });

    it('returns null when inconclusive', () => {
        expect(isFaststart(Buffer.alloc(0))).toBeNull();
        expect(isFaststart(box('ftyp'))).toBeNull();
    });
});

describe('planVideoOptimize', () => {
    it('skips an in-budget faststart probe', () => {
        expect(
            planVideoOptimize({
                probes: [{ slug: 'a', faststart: true, width: 720, totalBitrateBps: 1_000_000 }],
            })
        ).toEqual([{ slug: 'a', action: 'skip' }]);
    });

    it('remuxes a non-faststart probe even when in budget', () => {
        expect(
            planVideoOptimize({
                probes: [{ slug: 'a', faststart: false, width: 720, totalBitrateBps: 1_000_000 }],
            })
        ).toEqual([{ slug: 'a', action: 'remux' }]);
    });

    it('remuxes when faststart is inconclusive (null)', () => {
        expect(
            planVideoOptimize({
                probes: [{ slug: 'a', faststart: null, width: 720, totalBitrateBps: 1_000_000 }],
            })
        ).toEqual([{ slug: 'a', action: 'remux' }]);
    });

    it('re-encodes when width exceeds the cap', () => {
        expect(
            planVideoOptimize({
                probes: [{ slug: 'a', faststart: true, width: MAX_VIDEO_WIDTH + 1, totalBitrateBps: 1_000_000 }],
            })
        ).toEqual([{ slug: 'a', action: 'reencode' }]);
    });

    it('re-encodes when the bitrate exceeds the budget', () => {
        expect(
            planVideoOptimize({
                probes: [{ slug: 'a', faststart: true, width: 720, totalBitrateBps: MAX_TOTAL_BITRATE_BPS + 1 }],
            })
        ).toEqual([{ slug: 'a', action: 'reencode' }]);
    });

    it('never re-encodes on unknown width/bitrate', () => {
        expect(
            planVideoOptimize({
                probes: [{ slug: 'a', faststart: true, width: null, totalBitrateBps: null }],
            })
        ).toEqual([{ slug: 'a', action: 'skip' }]);
        expect(
            planVideoOptimize({
                probes: [{ slug: 'a', faststart: false, width: null, totalBitrateBps: null }],
            })
        ).toEqual([{ slug: 'a', action: 'remux' }]);
    });

    it('force upgrades skip to remux but never downgrades reencode', () => {
        expect(
            planVideoOptimize({
                force: true,
                probes: [
                    { slug: 'a', faststart: true, width: 720, totalBitrateBps: 1_000_000 },
                    { slug: 'b', faststart: true, width: 1080, totalBitrateBps: 1_000_000 },
                ],
            })
        ).toEqual([
            { slug: 'a', action: 'remux' },
            { slug: 'b', action: 'reencode' },
        ]);
    });

    it('returns [] for no probes', () => {
        expect(planVideoOptimize({})).toEqual([]);
    });
});

describe('ffmpeg argv builders', () => {
    it('remuxArgs copies streams and adds faststart', () => {
        const args = remuxArgs({ src: 'in.mp4', out: 'out.mp4' });
        expect(args).toContain('-c');
        expect(args).toContain('copy');
        expect(args).toContain('+faststart');
        expect(args[args.length - 1]).toBe('out.mp4');
    });

    it('reencodeArgs caps width, encodes h264/aac, and adds faststart', () => {
        const args = reencodeArgs({ src: 'in.mp4', out: 'out.mp4' });
        expect(args).toContain('libx264');
        expect(args).toContain('aac');
        expect(args).toContain('+faststart');
        expect(args).toContain('scale=min(iw\\,720):-2');
    });
});

describe('naming helpers', () => {
    it('builds filename, r2 key, and source url', () => {
        expect(videoFilename('testvideointro')).toBe('testvideointro.mp4');
        expect(videoR2Key('testvideointro')).toBe('assets/videos/testvideointro.mp4');
        expect(videoSourceUrl('testvideointro')).toBe(
            'https://r2.ultrafastfluency.com/assets/videos/testvideointro.mp4'
        );
        expect(videoSourceUrl('x', 'https://example.test/v/')).toBe('https://example.test/v/x.mp4');
    });
});
