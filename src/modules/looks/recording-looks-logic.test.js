import { describe, it, expect, vi } from 'vitest';
import {
    resolveFilterId,
    resolveFilterPreset,
    resolveLensId,
    resolveLensPreset,
    resolveScreenId,
    resolveScreenPreset,
    CLOSE_UP_HOLE,
    resolveCloseUpHole,
    resolveRaindrop,
    resolveSnowflake,
    resolvePollenMote,
    resolveDriftParticle,
    resolveShootingStar,
    resolveGust,
    resolveWindLeaf,
    paintSunny,
    paintWindy,
    paintScreenOverlay,
    RAINDROP_COUNT,
    SNOWFLAKE_COUNT,
    SUN_RAY_COUNT,
    POLLEN_COUNT,
    GUST_COUNT,
    WIND_LEAF_COUNT,
    VHS_LINE_COUNT,
    GRAIN_SPECKS,
    GRAIN_BUCKET_MS,
    SUN_POSITION,
    toggleFilterId,
    toggleLensId,
    toggleScreenId,
    isLookActive,
    paintLooks,
    isPreviewGateStep,
    parseStepOverlays,
    applyStepOverlays,
    sanitizeSelection,
    sanitizeTuning,
    resolveSlotAnchor,
    resolveSlotDrawRect,
    isSlugValidForSlot,
    overlaySlugsForSlot,
    emptySelection,
    emptyTuning,
    toggleLookDrawer,
    computeDragOffset,
    DEFAULT_FILTER_ID,
    DEFAULT_LENS_ID,
    DEFAULT_SCREEN_ID,
    SCREEN_IDS,
    SCREEN_PRESETS,
    FILTER_IDS,
    FILTER_PRESETS,
    LENS_PRESETS,
    SLOT_ANCHORS,
} from './recording-looks-logic.js';

describe('resolveFilterId', () => {
    it('empty / unknown → the no-filter default', () => {
        expect(DEFAULT_FILTER_ID).toBe('none');
        expect(resolveFilterId('')).toBe(DEFAULT_FILTER_ID);
        expect(resolveFilterId('neon')).toBe(DEFAULT_FILTER_ID);
        expect(resolveFilterId(undefined)).toBe(DEFAULT_FILTER_ID);
    });
    it('known ids survive', () => {
        for (const id of FILTER_IDS) expect(resolveFilterId(id)).toBe(id);
        expect(resolveFilterId('mono')).toBe('mono');
    });
    it('every preset resolves to a preset with ops + swatch', () => {
        for (const id of FILTER_IDS) {
            const preset = resolveFilterPreset(id);
            expect(preset.id).toBe(id);
            expect(Array.isArray(preset.ops)).toBe(true);
            expect(typeof preset.swatch).toBe('string');
        }
    });
});

describe('isPreviewGateStep', () => {
    it('true only for friendClosedResponse', () => {
        expect(isPreviewGateStep({ responseType: 'friendClosedResponse' })).toBe(true);
        expect(isPreviewGateStep({ responseType: 'openResponse' })).toBe(false);
        expect(isPreviewGateStep({ responseType: 'closedResponse' })).toBe(false);
        expect(isPreviewGateStep(null)).toBe(false);
    });
});

describe('overlay library', () => {
    it('each slot lists only its own assets', () => {
        expect(overlaySlugsForSlot('face')).toContain('smiley');
        expect(overlaySlugsForSlot('face')).not.toContain('cauldron');
        expect(overlaySlugsForSlot('upper')).toContain('witchhat');
        expect(overlaySlugsForSlot('lower')).toContain('cauldron');
    });
    it('a slug cannot be used in the wrong slot', () => {
        expect(isSlugValidForSlot('cauldron', 'face')).toBe(false);
        expect(isSlugValidForSlot('cauldron', 'lower')).toBe(true);
        expect(isSlugValidForSlot(null, 'face')).toBe(true);
    });
});

describe('sanitizeSelection', () => {
    it('unknown filter + unknown slugs fall back safely', () => {
        const safe = sanitizeSelection({ filterId: 'neon', slots: { face: 'nope', upper: 'witchhat', lower: 'cauldron' } });
        expect(safe.filterId).toBe(DEFAULT_FILTER_ID);
        expect(safe.slots.face).toBeNull();
        expect(safe.slots.upper).toBe('witchhat');
    });
    it('a prop in the face slot is dropped', () => {
        const safe = sanitizeSelection({ filterId: 'mono', slots: { face: 'cauldron' } });
        expect(safe.slots.face).toBeNull();
    });
    it('null / undefined never throws', () => {
        expect(sanitizeSelection(null)).toEqual(emptySelection());
        expect(sanitizeSelection(undefined)).toEqual(emptySelection());
    });
});

describe('filters are opt-in — None is a real, selectable choice', () => {
    it('the picker starts on None, with no look applied', () => {
        expect(FILTER_PRESETS[0].id).toBe('none');
        expect(emptySelection().filterId).toBe('none');
        expect(isLookActive(emptySelection())).toBe(false);
    });

    it('None applies no beauty pass and no colour grade', () => {
        const paintBeauty = vi.fn();
        const result = paintLooks({
            ctx: {},
            source: {},
            scratch: {},
            canvasWidth: 720,
            canvasHeight: 1280,
            selection: emptySelection(),
            tuning: emptyTuning(),
            images: {},
            paintBeauty,
        });
        expect(result).toEqual({ filter: 'none', lens: 'none', screen: 'none', slots: [] });
        expect(paintBeauty).not.toHaveBeenCalled();
    });

    it('a chosen filter paints its grade and makes the look active', () => {
        const paintBeauty = vi.fn();
        const painted = [];
        const ctx = {
            save() {}, restore() {},
            fillRect: (...args) => painted.push(args.length),
            globalCompositeOperation: 'source-over',
            globalAlpha: 1,
            fillStyle: '',
        };
        const result = paintLooks({
            ctx,
            source: {},
            scratch: {},
            canvasWidth: 720,
            canvasHeight: 1280,
            selection: { filterId: 'warm', slots: { face: null, upper: null, lower: null } },
            tuning: emptyTuning(),
            images: {},
            paintBeauty,
        });
        expect(result.filter).toBe('warm');
        expect(paintBeauty).toHaveBeenCalledTimes(1);
        expect(paintBeauty.mock.calls[0][0].mode).toBe('warm');
        // warm has two blend-mode passes over the frame
        expect(painted.length).toBe(2);
        expect(isLookActive({ filterId: 'warm', slots: {} })).toBe(true);
        expect(isLookActive({ filterId: 'natural', slots: {} })).toBe(true);
        expect(isLookActive({ filterId: 'none', slots: { face: 'smiley' } })).toBe(true);
    });
});

describe('toggleFilterId', () => {
    it('keeps exactly one filter applied', () => {
        expect(toggleFilterId('none', 'warm')).toBe('warm');
        expect(toggleFilterId('warm', 'mono')).toBe('mono');
    });

    it('tapping the applied filter removes it — the unselect path', () => {
        expect(toggleFilterId('warm', 'warm')).toBe('none');
        expect(toggleFilterId('natural', 'natural')).toBe('none');
    });

    it('None always clears, and an unknown id never applies anything', () => {
        expect(toggleFilterId('warm', 'none')).toBe('none');
        expect(toggleFilterId('none', 'none')).toBe('none');
        expect(toggleFilterId('warm', 'neon')).toBe('none');
    });
});

describe('lens effects — a category of their own, independent of the filter', () => {
    it('offers None, Soft focus and Chiaroscuro, and starts on None', () => {
        expect(LENS_PRESETS.map((p) => p.id)).toEqual(['none', 'softfocus', 'chiaroscuro', 'closeup']);
        expect(DEFAULT_LENS_ID).toBe('none');
        expect(emptySelection().lensId).toBe('none');
        expect(resolveLensId('bogus')).toBe('none');
        expect(resolveLensPreset('chiaroscuro').beautyMode).toBe('lensChiaroscuro');
        expect(resolveLensPreset('none').beautyMode).toBeNull();
    });

    it('sanitises lensId, and a light alone counts as a look', () => {
        expect(sanitizeSelection({ lensId: 'neon' }).lensId).toBe('none');
        expect(sanitizeSelection({ lensId: 'softfocus' }).lensId).toBe('softfocus');
        expect(isLookActive({ filterId: 'none', lensId: 'softfocus', slots: {} })).toBe(true);
        expect(isLookActive({ filterId: 'none', lensId: 'chiaroscuro', slots: {} })).toBe(true);
        expect(isLookActive(emptySelection())).toBe(false);
    });

    it('toggleLensId behaves like the filter picker: one at a time, tap again to clear', () => {
        expect(toggleLensId('none', 'softfocus')).toBe('softfocus');
        expect(toggleLensId('softfocus', 'chiaroscuro')).toBe('chiaroscuro');
        expect(toggleLensId('softfocus', 'softfocus')).toBe('none');
        expect(toggleLensId('none', 'none')).toBe('none');
        expect(toggleLensId('softfocus', 'bogus')).toBe('none');
    });

    it('paints the light after the grade, on top of any filter', () => {
        const modes = [];
        const paintBeauty = vi.fn(({ mode }) => { modes.push(mode); return mode; });
        const ctx = {
            save() {}, restore() {},
            fillRect() {},
            createRadialGradient: () => ({ addColorStop() {} }),
            globalCompositeOperation: 'source-over',
            globalAlpha: 1,
            fillStyle: '',
        };
        const result = paintLooks({
            ctx,
            source: {},
            scratch: {},
            canvasWidth: 720,
            canvasHeight: 1280,
            selection: { filterId: 'vintage', lensId: 'chiaroscuro', slots: { face: null, upper: null, lower: null } },
            tuning: emptyTuning(),
            images: {},
            paintBeauty,
        });
        // vintage's own beauty pass, then the independent lens effect
        expect(modes).toEqual(['soft', 'lensChiaroscuro']);
        expect(result.filter).toBe('vintage');
        expect(result.lens).toBe('chiaroscuro');
    });

    it('a light alone paints nothing but the light', () => {
        const modes = [];
        const paintBeauty = vi.fn(({ mode }) => { modes.push(mode); return mode; });
        const result = paintLooks({
            ctx: {},
            source: {},
            scratch: {},
            canvasWidth: 720,
            canvasHeight: 1280,
            selection: { filterId: 'none', lensId: 'softfocus', slots: { face: null, upper: null, lower: null } },
            tuning: emptyTuning(),
            images: {},
            paintBeauty,
        });
        expect(modes).toEqual(['lensSoftFocus']);
        expect(result).toEqual({ filter: 'none', lens: 'softfocus', screen: 'none', slots: [] });
    });
});


describe('close-up lens — sharp oval, blurred everywhere else', () => {
    it('is one of the lens options and asks for a hole', () => {
        expect(resolveLensPreset('closeup').beautyMode).toBe('lensCloseUp');
        expect(resolveLensPreset('closeup').hole).toBe(true);
        // the other lenses treat the whole frame
        expect(resolveLensPreset('softfocus').hole).toBeUndefined();
    });

    it('places a squat head-and-neck oval that stays clear of the top band', () => {
        const hole = resolveCloseUpHole(1080, 1920);
        expect(hole.cx).toBeCloseTo(CLOSE_UP_HOLE.cx * 1080, 5);
        expect(hole.cy).toBeCloseTo(CLOSE_UP_HOLE.cy * 1920, 5);
        expect(hole.rx).toBeCloseTo(CLOSE_UP_HOLE.rx * 1080, 5);
        expect(hole.ry).toBeCloseTo(CLOSE_UP_HOLE.ry * 1920, 5);
        // wide enough for a head plus neck, not a porthole
        expect(hole.rx / 1080).toBeGreaterThan(0.3);
        // …but SQUAT: it must not reach up into the top band (0–15% of the
        // frame is the header blur and the logo)
        expect(hole.cy - hole.ry).toBeGreaterThanOrEqual(0.15 * 1920);
        expect(hole.ry / 1920).toBeLessThan(0.3);
        expect(hole.cy + hole.ry).toBeLessThan(0.7 * 1920);
    });

    it('passes the oval and the mask canvas to the painter only for the close-up lens', () => {
        const calls = [];
        const paintBeauty = vi.fn(({ mode, hole, maskCanvas }) => { calls.push({ mode, hole, maskCanvas }); return mode; });
        const maskCanvas = { width: 0, height: 0 };
        const paint = (lensId) => paintLooks({
            ctx: {},
            source: {},
            scratch: {},
            canvasWidth: 1080,
            canvasHeight: 1920,
            selection: { filterId: 'none', lensId, screenId: 'none', slots: { face: null, upper: null, lower: null } },
            tuning: emptyTuning(),
            images: {},
            paintBeauty,
            maskCanvas,
        });
        paint('closeup');
        expect(calls[0].mode).toBe('lensCloseUp');
        expect(calls[0].hole).toEqual(resolveCloseUpHole(1080, 1920));
        expect(calls[0].maskCanvas).toBe(maskCanvas);
        calls.length = 0;
        paint('softfocus');
        expect(calls[0].mode).toBe('lensSoftFocus');
        expect(calls[0].hole).toBeNull();
        expect(calls[0].maskCanvas).toBeNull();
    });
});

describe('screen overlays — a category painted over the whole frame', () => {
    it('offers every overlay, with None first', () => {
        expect(SCREEN_PRESETS.map((p) => p.id)).toEqual([
            'none', 'raindrops', 'snowfall', 'sunny', 'windy',
            'confetti', 'leaves', 'petals', 'bubbles', 'embers', 'fireflies',
            'hearts', 'stars', 'shootingstar', 'vhs', 'grain', 'bokeh',
        ]);
        expect(DEFAULT_SCREEN_ID).toBe('none');
        expect(emptySelection().screenId).toBe('none');
        expect(resolveScreenId('bogus')).toBe('none');
        expect(resolveScreenPreset('raindrops').id).toBe('raindrops');
    });

    it('sanitises screenId and counts a screen overlay as a look on its own', () => {
        expect(sanitizeSelection({ screenId: 'neon' }).screenId).toBe('none');
        expect(sanitizeSelection({ screenId: 'raindrops' }).screenId).toBe('raindrops');
        expect(isLookActive({ filterId: 'none', lensId: 'none', screenId: 'raindrops', slots: {} })).toBe(true);
        expect(isLookActive(emptySelection())).toBe(false);
    });

    it('toggleScreenId is a radio group with an off', () => {
        expect(toggleScreenId('none', 'raindrops')).toBe('raindrops');
        expect(toggleScreenId('raindrops', 'raindrops')).toBe('none');
        expect(toggleScreenId('none', 'none')).toBe('none');
        expect(toggleScreenId('raindrops', 'bogus')).toBe('none');
    });

    it('raindrops are deterministic per frame and move with time', () => {
        const args = { index: 3, canvasWidth: 1080, canvasHeight: 1920 };
        const a = resolveRaindrop({ ...args, timeMs: 0 });
        const b = resolveRaindrop({ ...args, timeMs: 0 });
        const later = resolveRaindrop({ ...args, timeMs: 700 });
        expect(a).toEqual(b);
        expect(later.y).not.toBeCloseTo(a.y, 3);
        expect(later.x).not.toBeCloseTo(a.x, 3);
        // falling down and to the left (the field arrives from the top right)
        const evenLater = resolveRaindrop({ ...args, timeMs: 1400 });
        expect(evenLater.y).not.toBeCloseTo(later.y, 3);
    });

    it('paints two shapes per drop, and nothing at all for None', () => {
        const makeCtx = () => {
            const calls = { fills: 0, begins: 0, ellipses: 0 };
            return {
                calls,
                save() {}, restore() {},
                beginPath() { calls.begins += 1; },
                moveTo() {}, lineTo() {}, closePath() {},
                ellipse() { calls.ellipses += 1; },
                fill() { calls.fills += 1; },
                fillStyle: '', globalAlpha: 1,
            };
        };
        const ctx = makeCtx();
        expect(paintScreenOverlay({ ctx, canvasWidth: 1080, canvasHeight: 1920, screenId: 'raindrops', timeMs: 250 })).toBe('raindrops');
        expect(ctx.calls.fills).toBe(RAINDROP_COUNT * 2);
        expect(ctx.calls.ellipses).toBe(RAINDROP_COUNT);

        const noneCtx = makeCtx();
        expect(paintScreenOverlay({ ctx: noneCtx, canvasWidth: 1080, canvasHeight: 1920, screenId: 'none', timeMs: 250 })).toBe('none');
        expect(noneCtx.calls.fills).toBe(0);
    });

    it('paintLooks paints it last and reports it', () => {
        const order = [];
        const ctx = {
            save() { order.push('save'); }, restore() { order.push('restore'); },
            beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, ellipse() {},
            fill() { order.push('rain'); },
            fillRect() { order.push('fillRect'); },
            createRadialGradient: () => ({ addColorStop() {} }),
            globalAlpha: 1, fillStyle: '', globalCompositeOperation: 'source-over',
        };
        const paintBeauty = vi.fn(({ mode }) => { order.push(`beauty:${mode}`); return mode; });
        const result = paintLooks({
            ctx,
            source: {},
            scratch: {},
            canvasWidth: 1080,
            canvasHeight: 1920,
            selection: { filterId: 'warm', lensId: 'softfocus', screenId: 'raindrops', slots: { face: null, upper: null, lower: null } },
            tuning: emptyTuning(),
            images: {},
            paintBeauty,
            timeMs: 500,
        });
        expect(result.screen).toBe('raindrops');
        // filter beauty → grade → lens → rain last of all
        expect(order.indexOf('beauty:warm')).toBeLessThan(order.indexOf('fillRect'));
        expect(order.indexOf('fillRect')).toBeLessThan(order.indexOf('beauty:lensSoftFocus'));
        expect(order.filter((x) => x !== 'save' && x !== 'restore').slice(-1)[0]).toBe('rain');
    });
});


describe('snowfall — small white dots falling straight down with a wobble', () => {
    const base = { canvasWidth: 1080, canvasHeight: 1920 };

    it('falls down over time rather than staying put', () => {
        const a = resolveSnowflake({ index: 2, ...base, timeMs: 0 });
        const b = resolveSnowflake({ index: 2, ...base, timeMs: 900 });
        const same = resolveSnowflake({ index: 2, ...base, timeMs: 0 });
        expect(a).toEqual(same);
        // y wraps, so compare against a short step well inside one fall
        expect(resolveSnowflake({ index: 2, ...base, timeMs: 200 }).y).toBeGreaterThan(a.y - 1);
        expect(b.y).not.toBe(a.y);
    });

    it('sways side to side around its column instead of running diagonally', () => {
        const xs = [0, 250, 500, 750, 1000, 1250, 1500].map((timeMs) => resolveSnowflake({ index: 5, ...base, timeMs }).x);
        const min = Math.min(...xs);
        const max = Math.max(...xs);
        // real wobble…
        expect(max - min).toBeGreaterThan(base.canvasWidth * 0.01);
        // …but it never drifts away down-range like the diagonal rain does
        expect(max - min).toBeLessThan(base.canvasWidth * 0.12);
        // and it stays on screen
        for (const x of xs) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(base.canvasWidth);
        }
    });

    it('draws small, translucent flakes', () => {
        for (let i = 0; i < 8; i++) {
            const flake = resolveSnowflake({ index: i, ...base, timeMs: 300 });
            expect(flake.radius).toBeGreaterThan(0);
            expect(flake.radius).toBeLessThan(base.canvasWidth * 0.012);
            expect(flake.alpha).toBeGreaterThan(0.25);
            expect(flake.alpha).toBeLessThan(0.8);
        }
    });

    it('paints one circle per flake and nothing for None or Raindrops', () => {
        const makeCtx = () => {
            const calls = { arcs: 0, fills: 0 };
            return {
                calls,
                save() {}, restore() {},
                beginPath() {},
                arc() { calls.arcs += 1; },
                fill() { calls.fills += 1; },
                ellipse() { throw new Error('snow should not draw ellipses'); },
                fillStyle: '', globalAlpha: 1,
            };
        };
        const ctx = makeCtx();
        expect(paintScreenOverlay({ ctx, canvasWidth: 1080, canvasHeight: 1920, screenId: 'snowfall', timeMs: 400 })).toBe('snowfall');
        expect(ctx.calls.arcs).toBe(SNOWFLAKE_COUNT);
        expect(ctx.calls.fills).toBe(SNOWFLAKE_COUNT);

        const none = makeCtx();
        expect(paintScreenOverlay({ ctx: none, canvasWidth: 1080, canvasHeight: 1920, screenId: 'none', timeMs: 400 })).toBe('none');
        expect(none.calls.fills).toBe(0);
    });

    it('is an independent third screen choice', () => {
        expect(toggleScreenId('none', 'snowfall')).toBe('snowfall');
        expect(toggleScreenId('raindrops', 'snowfall')).toBe('snowfall');
        expect(toggleScreenId('snowfall', 'snowfall')).toBe('none');
        expect(isLookActive({ filterId: 'none', lensId: 'none', screenId: 'snowfall', slots: {} })).toBe(true);
    });
});


describe('sunny day — warm glow, slow rays, pollen', () => {
    const base = { canvasWidth: 1080, canvasHeight: 1920 };
    function makeCtx() {
        const calls = { gradients: 0, rects: 0, arcs: 0, fills: 0, composite: [] };
        return {
            calls,
            _op: 'source-over',
            get globalCompositeOperation() { return this._op; },
            set globalCompositeOperation(v) { calls.composite.push(v); this._op = v; },
            save() {}, restore() {},
            beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
            createRadialGradient() { calls.gradients += 1; return { addColorStop() {} }; },
            fillRect() { calls.rects += 1; },
            arc() { calls.arcs += 1; },
            fill() { calls.fills += 1; },
            fillStyle: '', globalAlpha: 1,
        };
    }

    it('puts the sun high and to the right, clear of the face zone and the rail', () => {
        expect(SUN_POSITION.cy).toBeLessThan(0.2);
        expect(SUN_POSITION.cx).toBeGreaterThan(0.65);
    });

    it('pollen motes drift up and twinkle, deterministically', () => {
        const a = resolvePollenMote({ index: 1, ...base, timeMs: 0 });
        const again = resolvePollenMote({ index: 1, ...base, timeMs: 0 });
        const later = resolvePollenMote({ index: 1, ...base, timeMs: 4000 });
        expect(a).toEqual(again);
        // upward drift (y shrinks) — compare positions inside one pass
        expect(later.y).toBeLessThan(a.y + 1);
        expect(later.alpha).not.toBe(a.alpha);
        expect(a.alpha).toBeGreaterThan(0);
        expect(a.alpha).toBeLessThanOrEqual(0.6);
    });

    it('paints a screened glow, the rays, then the pollen', () => {
        const ctx = makeCtx();
        expect(paintSunny({ ctx, ...base, timeMs: 500 })).toBe(true);
        // the bloom around the sun + its bright core
        expect(ctx.calls.gradients).toBe(2);
        expect(ctx.calls.rects).toBe(2);
        expect(ctx.calls.composite[0]).toBe('screen');
        // ray triangles + pollen dots
        expect(ctx.calls.fills).toBe(SUN_RAY_COUNT + POLLEN_COUNT);
        expect(ctx.calls.arcs).toBe(POLLEN_COUNT);
    });

    it('is dispatched from the screen painter', () => {
        const ctx = makeCtx();
        expect(paintScreenOverlay({ ctx, ...base, screenId: 'sunny', timeMs: 500 })).toBe('sunny');
    });
});

describe('windy day — gusts and tumbling leaves', () => {
    const base = { canvasWidth: 1080, canvasHeight: 1920 };
    function makeCtx() {
        const calls = { strokes: 0, fills: 0, ellipses: 0, transforms: 0 };
        return {
            calls,
            save() {}, restore() {},
            beginPath() {}, moveTo() {}, quadraticCurveTo() {}, closePath() {},
            stroke() { calls.strokes += 1; },
            fill() { calls.fills += 1; },
            translate() { calls.transforms += 1; },
            rotate() {},
            ellipse() { calls.ellipses += 1; },
            strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: 'butt', globalAlpha: 1,
        };
    }

    it('gusts sweep left to right, deterministically', () => {
        const a = resolveGust({ index: 2, ...base, timeMs: 0 });
        expect(a).toEqual(resolveGust({ index: 2, ...base, timeMs: 0 }));
        const later = resolveGust({ index: 2, ...base, timeMs: 600 });
        // same pass (no wrap): x grows with time
        expect(later.x).toBeGreaterThan(a.x);
        expect(a.length).toBeGreaterThan(0);
        expect(a.width).toBeGreaterThan(0);
    });

    it('leaves tumble: they move right and rotate as time passes', () => {
        const a = resolveWindLeaf({ index: 3, ...base, timeMs: 0 });
        expect(a).toEqual(resolveWindLeaf({ index: 3, ...base, timeMs: 0 }));
        const later = resolveWindLeaf({ index: 3, ...base, timeMs: 300 });
        expect(later.x).toBeGreaterThan(a.x);
        expect(later.rotation).not.toBe(a.rotation);
        expect(a.rx).toBeGreaterThan(a.ry);
    });

    it('paints one stroke per gust and one ellipse per leaf', () => {
        const ctx = makeCtx();
        expect(paintWindy({ ctx, ...base, timeMs: 700 })).toBe(true);
        expect(ctx.calls.strokes).toBe(GUST_COUNT);
        expect(ctx.calls.ellipses).toBe(WIND_LEAF_COUNT);
        expect(ctx.calls.fills).toBe(WIND_LEAF_COUNT);
    });

    it('is dispatched from the screen painter', () => {
        const ctx = makeCtx();
        expect(paintScreenOverlay({ ctx, ...base, screenId: 'windy', timeMs: 700 })).toBe('windy');
    });
});


describe('the rest of the screen overlays', () => {
    const base = { canvasWidth: 1080, canvasHeight: 1920 };
    // Permissive context: enough for every painter, so a missing canvas method
    // shows up as a failing dispatch rather than a silent 'none'.
    function makeCtx() {
        const gradient = { addColorStop() {} };
        return {
            save() {}, restore() {}, beginPath() {}, closePath() {},
            moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
            arc() {}, ellipse() {}, rect() {},
            fill() {}, stroke() {}, fillRect() {}, translate() {}, rotate() {},
            createRadialGradient: () => gradient,
            createLinearGradient: () => gradient,
            fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
            globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
        };
    }

    it('every preset has a painter that reports its own id', () => {
        for (const id of SCREEN_IDS) {
            if (id === 'none') continue;
            const result = paintScreenOverlay({ ctx: makeCtx(), ...base, screenId: id, timeMs: 900 });
            expect(result).toBe(id);
        }
    });

    it('particles drift in the direction their overlay implies', () => {
        const downA = resolveDriftParticle({ index: 4, ...base, timeMs: 0, motion: 'down' });
        const downB = resolveDriftParticle({ index: 4, ...base, timeMs: 400, motion: 'down' });
        expect(downB.y).toBeGreaterThan(downA.y);
        const upA = resolveDriftParticle({ index: 4, ...base, timeMs: 0, motion: 'up' });
        const upB = resolveDriftParticle({ index: 4, ...base, timeMs: 400, motion: 'up' });
        expect(upB.y).toBeLessThan(upA.y);
        const acrossA = resolveDriftParticle({ index: 4, ...base, timeMs: 0, motion: 'across' });
        const acrossB = resolveDriftParticle({ index: 4, ...base, timeMs: 400, motion: 'across' });
        expect(acrossB.x).toBeGreaterThan(acrossA.x);
        // deterministic
        expect(resolveDriftParticle({ index: 4, ...base, timeMs: 400, motion: 'across' })).toEqual(acrossB);
    });

    it('the shooting star only exists for part of its cycle', () => {
        const early = resolveShootingStar({ ...base, timeMs: 100 });
        const mid = resolveShootingStar({ ...base, timeMs: 1500 });
        const late = resolveShootingStar({ ...base, timeMs: 2900 });
        expect(mid.headX).toBeGreaterThan(early.headX);
        expect(mid.alpha).toBe(1);
        // fade in/out at the edges of the pass; nothing at all through the gap
        expect(early.alpha).toBeLessThan(1);
        expect(resolveShootingStar({ ...base, timeMs: 4000 }).alpha).toBe(0);
        expect(late.alpha).toBeLessThan(1);
    });

    it('VHS draws its scanlines and a rolling band', () => {
        const calls = { rects: 0, gradients: 0 };
        const gradient = { addColorStop() {} };
        const ctx = {
            save() {}, restore() {},
            fillRect() { calls.rects += 1; },
            createLinearGradient() { calls.gradients += 1; return gradient; },
            fillStyle: '', globalAlpha: 1,
        };
        expect(paintScreenOverlay({ ctx, ...base, screenId: 'vhs', timeMs: 300 })).toBe('vhs');
        expect(calls.rects).toBe(VHS_LINE_COUNT + 1);
        expect(calls.gradients).toBe(1);
    });

    it('grain re-seeds on its time bucket, so the specks boil', () => {
        const positions = (timeMs) => {
            const rows = [];
            const ctx = {
                save() {}, restore() {},
                fillRect(x, y) { rows.push([Math.round(x), Math.round(y)]); },
                fillStyle: '', globalAlpha: 1,
            };
            paintScreenOverlay({ ctx, ...base, screenId: 'grain', timeMs });
            return rows;
        };
        // buckets are 45 ms wide: 1000 and 1020 share one, 1040 is the next
        const a = positions(1000);
        const sameBucket = positions(1020);
        const nextBucket = positions(1060);
        expect(a.length).toBe(GRAIN_SPECKS);
        expect(sameBucket).toEqual(a);
        expect(nextBucket).not.toEqual(a);
    });
});

describe('sanitizeTuning', () => {
    it('clamps scale and offsets', () => {
        const t = sanitizeTuning({ face: { dx: 5, dy: -5, scale: 99 } });
        expect(t.face.dx).toBe(1);
        expect(t.face.dy).toBe(-1);
        expect(t.face.scale).toBeLessThanOrEqual(2.2);
        expect(t.upper).toEqual({ dx: 0, dy: 0, scale: 1 });
    });
});

describe('parseStepOverlays', () => {
    it('reads the documented object shape', () => {
        expect(parseStepOverlays({
            face: { asset: 'smiley' },
            upper: { asset: 'witchhat' },
            lower: { asset: 'cauldron' },
        })).toEqual({ face: 'smiley', upper: 'witchhat', lower: 'cauldron' });
    });
    it('accepts a bare slug string per slot', () => {
        expect(parseStepOverlays({ upper: 'crown' }).upper).toBe('crown');
    });
    it('drops an unknown slug and an asset in the wrong slot', () => {
        expect(parseStepOverlays({ face: { asset: 'nope' }, upper: { asset: 'cauldron' } }))
            .toEqual({ face: null, upper: null, lower: null });
    });
    it('missing / non-object → all null', () => {
        expect(parseStepOverlays(null)).toEqual({ face: null, upper: null, lower: null });
        expect(parseStepOverlays('smiley')).toEqual({ face: null, upper: null, lower: null });
    });
});

describe('applyStepOverlays', () => {
    it('fills only the declared slots and keeps the learner’s others', () => {
        const selection = { filterId: 'mono', slots: { face: 'blank', upper: null, lower: null } };
        const merged = applyStepOverlays(selection, { lower: { asset: 'cauldron' } });
        expect(merged.slots.face).toBe('blank');
        expect(merged.slots.upper).toBeNull();
        expect(merged.slots.lower).toBe('cauldron');
        expect(merged.filterId).toBe('mono');
    });
    it('a later step with no overlays changes nothing', () => {
        const selection = { filterId: 'warm', slots: { face: 'smiley', upper: null, lower: null } };
        expect(applyStepOverlays(selection, null).slots.face).toBe('smiley');
    });
});

describe('resolveSlotAnchor', () => {
    it('returns the documented default centre per slot', () => {
        expect(resolveSlotAnchor('face', 1000, 2000)).toEqual({ cx: 500, cy: 840 });
        expect(resolveSlotAnchor('upper', 1000, 2000)).toEqual({ cx: 500, cy: 440 });
        expect(resolveSlotAnchor('lower', 1000, 2000)).toEqual({ cx: 500, cy: 1480 });
        // documented fractions, not magic numbers
        expect(SLOT_ANCHORS.face.cy).toBe(0.42);
    });
});

describe('resolveSlotDrawRect', () => {
    const base = { imageWidth: 720, imageHeight: 420, canvasWidth: 720, canvasHeight: 1280 };

    it('no tuning → anchored default at scale 1, aspect preserved', () => {
        const rect = resolveSlotDrawRect({ slot: 'upper', ...base });
        expect(rect.dw / rect.dh).toBeCloseTo(720 / 420, 2);
        // centred on the upper anchor
        expect(rect.dx + rect.dw / 2).toBeCloseTo(360, 0);
        expect(rect.dy + rect.dh / 2).toBeCloseTo(0.22 * 1280, 0);
    });

    it('scale grows the asset and keeps the aspect ratio', () => {
        const one = resolveSlotDrawRect({ slot: 'face', ...base });
        const two = resolveSlotDrawRect({ slot: 'face', ...base, tuning: { dx: 0, dy: 0, scale: 1.5 } });
        expect(two.dw).toBeGreaterThan(one.dw);
        expect(two.dw / two.dh).toBeCloseTo(one.dw / one.dh, 2);
    });

    it('dx/dy move the asset by a fraction of the canvas', () => {
        const centred = resolveSlotDrawRect({ slot: 'face', ...base });
        const shifted = resolveSlotDrawRect({ slot: 'face', ...base, tuning: { dx: 0.1, dy: 0.05, scale: 1 } });
        expect(shifted.dx - centred.dx).toBeCloseTo(72, 0);
        expect(shifted.dy - centred.dy).toBeCloseTo(64, 0);
    });

    it('cannot be dragged entirely off the canvas', () => {
        const rect = resolveSlotDrawRect({ slot: 'face', ...base, tuning: { dx: 1, dy: 1, scale: 1 } });
        expect(rect.dx).toBeLessThan(base.canvasWidth);
        expect(rect.dy).toBeLessThan(base.canvasHeight);
        expect(rect.dx + rect.dw).toBeGreaterThan(0);
        expect(rect.dy + rect.dh).toBeGreaterThan(0);
    });

    it('missing dimensions → null', () => {
        expect(resolveSlotDrawRect({ slot: 'face', imageWidth: 0, imageHeight: 420, canvasWidth: 720, canvasHeight: 1280 })).toBeNull();
        expect(resolveSlotDrawRect({ slot: 'face', imageWidth: 720, imageHeight: 420, canvasWidth: 0, canvasHeight: 1280 })).toBeNull();
    });
});

describe('toggleLookDrawer', () => {
    it('opens a closed drawer and folds an open drawer back in when tapped again', () => {
        expect(toggleLookDrawer(null, 'filter')).toBe('filter');
        expect(toggleLookDrawer('filter', 'filter')).toBeNull();
        expect(toggleLookDrawer('filter', 'face')).toBe('face');
        expect(toggleLookDrawer('face', 'unknown')).toBeNull();
    });
});

describe('computeDragOffset', () => {
    it('inverts horizontal delta when the preview video is CSS-mirrored', () => {
        const res = computeDragOffset({
            startTuning: { dx: 0, dy: 0, scale: 1 },
            startX: 100,
            startY: 200,
            clientX: 150,
            clientY: 250,
            width: 500,
            height: 1000,
            mirrored: true,
        });
        expect(res.dx).toBeCloseTo(-0.1, 5);
        expect(res.dy).toBeCloseTo(0.05, 5);
    });
});
