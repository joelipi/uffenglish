import { describe, it, expect } from 'vitest';
import {
    resolveFilterId,
    resolveFilterPreset,
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
    toggleLookDrawer,
    computeDragOffset,
    DEFAULT_FILTER_ID,
    FILTER_IDS,
    SLOT_ANCHORS,
} from './recording-looks-logic.js';

describe('resolveFilterId', () => {
    it('empty / unknown → natural', () => {
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
        expect(safe.filterId).toBe('natural');
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
