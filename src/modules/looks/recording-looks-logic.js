// Recording looks: filters, overlay slots, and per-step overlay defaults.
//
// Pure module — no React, no DOM, no browser globals — so every rule here is
// unit-tested and the browser adapter (speech.web.js) stays thin.
//
// Nothing in here tracks a face. "face" and "upper" are fixed anchor ZONES on
// the canvas; the learner frames their own head behind them.
//
// See stories/092-look-controls.

export const OVERLAY_SLOTS = ['face', 'upper', 'lower'];

// Draw order: a lower prop must never paint over a face cover.
export const SLOT_DRAW_ORDER = ['face', 'upper', 'lower'];

/**
 * The "nothing applied" swatch, shared with the overlay pickers' None chip so
 * one visual idiom means "off" everywhere.
 */
export const NONE_SWATCH = 'repeating-linear-gradient(45deg,#333,#333 5px,#444 5px,#444 10px)';

/**
 * Filters are opt-in: the default is `none`, so a learner who picks nothing
 * gets an untouched camera frame and the picker shows nothing selected.
 */
export const DEFAULT_FILTER_ID = 'none';

/**
 * Every filter is a Canvas2D recipe: an optional beauty mode (the 091 levers)
 * plus a list of blend-mode passes. No WebGL, and never `ctx.filter` — that is a
 * silent no-op in iOS WebKit, which is why the grades are blend modes.
 *
 * `swatch` is the CSS used by the picker thumbnail.
 */
export const FILTER_PRESETS = [
    { id: 'none', label: 'None', labelKey: 'look_filter_none', beauty: 'none', ops: [], swatch: NONE_SWATCH },
    { id: 'natural', label: 'Natural', labelKey: 'look_filter_natural', beauty: 'glow', ops: [], swatch: 'linear-gradient(135deg,#ffe9d6,#ffffff)' },
    { id: 'warm', label: 'Warm', labelKey: 'look_filter_warm', beauty: 'warm', ops: [{ op: 'screen', color: 'rgb(255,176,104)', alpha: 0.16 }, { op: 'multiply', color: 'rgb(255,236,214)', alpha: 0.10 }], swatch: 'linear-gradient(135deg,#ffb15c,#ffe9c9)' },
    { id: 'cool', label: 'Cool', labelKey: 'look_filter_cool', beauty: 'none', ops: [{ op: 'screen', color: 'rgb(120,170,255)', alpha: 0.14 }, { op: 'multiply', color: 'rgb(236,244,255)', alpha: 0.10 }], swatch: 'linear-gradient(135deg,#7aa8ff,#dbe9ff)' },
    { id: 'soft', label: 'Soft', labelKey: 'look_filter_soft', beauty: 'soft', ops: [{ op: 'screen', color: 'rgb(255,244,240)', alpha: 0.08 }], swatch: 'linear-gradient(135deg,#ffd8d8,#fff6f2)' },
    { id: 'mono', label: 'Mono', labelKey: 'look_filter_mono', beauty: 'none', ops: [{ op: 'saturation', color: 'rgb(128,128,128)', alpha: 1 }], swatch: 'linear-gradient(135deg,#3a3a3a,#e8e8e8)' },
    { id: 'vintage', label: 'Vintage', labelKey: 'look_filter_vintage', beauty: 'soft', ops: [{ op: 'multiply', color: 'rgb(238,206,170)', alpha: 0.30 }, { op: 'screen', color: 'rgb(255,224,180)', alpha: 0.10 }], swatch: 'linear-gradient(135deg,#b98f5f,#f0dcbb)' },
    { id: 'vivid', label: 'Vivid', labelKey: 'look_filter_vivid', beauty: 'none', ops: [{ op: 'saturation', color: 'rgb(255,64,64)', alpha: 0.45 }, { op: 'overlay', color: 'rgb(128,128,128)', alpha: 0.12 }], swatch: 'linear-gradient(135deg,#ff4d4d,#ffe14d)' },
];

export const FILTER_IDS = FILTER_PRESETS.map((p) => p.id);

/**
 * Lens effects: a category of its own, independent of the filter and of the
 * prop slots — you can have a filter AND one of these (stories/092). A lens
 * effect is the whole-frame optical treatment (soft focus, chiaroscuro), not a
 * prop placed in the frame and not a colour tint, so it gets its own rail box
 * and its own selection key. Painted after the grade and under the props.
 *
 * Nothing here tracks a face. Both are single canvas-wide passes centred on the
 * assumed face zone (`SLOT_ANCHORS.face`), which is exact enough because the
 * composite canvas is always the same 9:16 frame.
 *
 * `beautyMode` names a preset in `portrait-capture-logic.js`'s `BEAUTY_PRESETS`,
 * so the existing downscale soft-focus + radial light + vignette painters are
 * reused rather than duplicated (and none of them uses `ctx.filter`, which is a
 * no-op on iOS).
 */
export const LENS_PRESETS = [
    { id: 'none', label: 'None', labelKey: 'look_lens_none', beautyMode: null, swatch: NONE_SWATCH },
    { id: 'softfocus', label: 'Soft focus', labelKey: 'look_lens_soft_focus', beautyMode: 'lensSoftFocus', swatch: 'radial-gradient(circle at 50% 42%, #ffffff 0%, #ffe9d8 45%, rgba(255,233,216,0.12) 100%)' },
    { id: 'chiaroscuro', label: 'Chiaroscuro', labelKey: 'look_lens_chiaroscuro', beautyMode: 'lensChiaroscuro', swatch: 'radial-gradient(circle at 50% 42%, #ffd9a0 0%, #6b4a2a 35%, #0b0b0b 88%)' },
    // Close-up: the frame is blurred except a large oval over the head and
    // neck. `hole` tells the painter to cut that ellipse out of the blur, so
    // the subject stays sharp while everything around them goes soft.
    { id: 'closeup', label: 'Close-up', labelKey: 'look_lens_close_up', beautyMode: 'lensCloseUp', hole: true, swatch: 'radial-gradient(ellipse 34% 30% at 50% 38%, #ffffff 0%, #f2f6ff 62%, #8b95a8 74%, #232936 100%)' },
];

/**
 * The close-up lens' sharp oval, as fractions of the frame: wide enough for a
 * head plus neck, but SQUAT and low — its top edge stays below the top band
 * (0–15% of the frame, where the header blur and the logo are), so the sharp
 * area never eats into that strip.
 */
export const CLOSE_UP_HOLE = { cx: 0.5, cy: 0.4, rx: 0.37, ry: 0.24 };

/** The same oval in canvas pixels (the frame is always the same 9:16 shape). */
export function resolveCloseUpHole(canvasWidth, canvasHeight) {
    return {
        cx: CLOSE_UP_HOLE.cx * canvasWidth,
        cy: CLOSE_UP_HOLE.cy * canvasHeight,
        rx: CLOSE_UP_HOLE.rx * canvasWidth,
        ry: CLOSE_UP_HOLE.ry * canvasHeight,
    };
}

export const LENS_IDS = LENS_PRESETS.map((p) => p.id);

/** Lens effects are opt-in too: the default is no effect at all. */
export const DEFAULT_LENS_ID = 'none';

/**
 * Screen overlays: artwork that lies over the WHOLE frame, in front of the
 * learner and in front of the props (rain in the air, confetti, grain). Its own
 * category and its own rail box, because it is neither a colour grade, nor a
 * lens treatment, nor something placed at one spot in the frame.
 *
 * Painted procedurally so it can move with the take: a still image would look
 * like a photo pasted on a video. Deterministic per drop and per time, so a
 * frame can be reproduced exactly (and a test can assert movement).
 */
export const SCREEN_PRESETS = [
    { id: 'none', label: 'None', labelKey: 'look_screen_none', swatch: NONE_SWATCH },
    { id: 'raindrops', label: 'Raindrops', labelKey: 'look_screen_raindrops', swatch: 'linear-gradient(150deg, #0f1722 0%, #24384d 100%), radial-gradient(circle at 30% 30%, #bfe3ff 0 6%, transparent 7%)' },
];

export const SCREEN_IDS = SCREEN_PRESETS.map((p) => p.id);

/** Screen overlays are opt-in: the default leaves the frame untouched. */
export const DEFAULT_SCREEN_ID = 'none';

/**
 * Asset registry: a config names a SLUG, never a path, so art can be swapped by
 * filename without touching a lesson config. `slot` is where it belongs in the
 * picker; `anchor` is its default position.
 */
export const OVERLAY_LIBRARY = {
    // Face covers — opaque enough to hide the face if the learner wants that.
    smiley: { slot: 'face', file: '/overlays/face/smiley.png', anchor: 'face', label: 'Smiley', labelKey: 'look_overlay_smiley' },
    blank: { slot: 'face', file: '/overlays/face/blank.png', anchor: 'face', label: 'Blank', labelKey: 'look_overlay_blank' },
    pixel: { slot: 'face', file: '/overlays/face/pixel.png', anchor: 'face', label: 'Pixel', labelKey: 'look_overlay_pixel' },
    // Above-the-face props.
    witchhat: { slot: 'upper', file: '/overlays/props/witchhat.png', anchor: 'upper', label: 'Witch hat', labelKey: 'look_overlay_witchhat' },
    crown: { slot: 'upper', file: '/overlays/props/crown.png', anchor: 'upper', label: 'Crown', labelKey: 'look_overlay_crown' },
    // Lower / scene props.
    cauldron: { slot: 'lower', file: '/overlays/props/cauldron.png', anchor: 'lower', label: 'Cauldron', labelKey: 'look_overlay_cauldron' },
    desk: { slot: 'lower', file: '/overlays/props/desk.png', anchor: 'lower', label: 'Desk', labelKey: 'look_overlay_desk' },
    frame: { slot: 'lower', file: '/overlays/props/frame.png', anchor: 'lower', label: 'Frame', labelKey: 'look_overlay_frame' },
};

export const OVERLAY_SLUGS = Object.keys(OVERLAY_LIBRARY);

/**
 * Anchor defaults as fractions of the canvas (centre of the asset).
 * Chosen to stay clear of the top header blur (~0–15% of frame height) and the
 * bottom microphone control band (~88–100% of frame height).
 */
export const SLOT_ANCHORS = {
    face: { cx: 0.5, cy: 0.42 },
    upper: { cx: 0.5, cy: 0.22 },
    lower: { cx: 0.5, cy: 0.74 },
};

export const LOOK_DRAWERS = ['filter', 'lens', 'screen', 'upper', 'face', 'lower'];

/** Toggle a left-rail fold-out drawer: tapping the open drawer folds it back in. */
export function toggleLookDrawer(currentDrawer, clickedDrawer) {
    if (!LOOK_DRAWERS.includes(clickedDrawer)) return null;
    return currentDrawer === clickedDrawer ? null : clickedDrawer;
}

/**
 * Compute updated `{ dx, dy }` tuning from a pointer drag on the preview.
 * `#webcam-preview` is CSS-mirrored (`transform: scaleX(-1)`), so moving the
 * pointer right on screen corresponds to negative `dx` in un-mirrored canvas
 * coordinates.
 */
export function computeDragOffset({
    startTuning,
    startX,
    startY,
    clientX,
    clientY,
    width,
    height,
    mirrored = true,
}) {
    if (!startTuning || !(width > 0) || !(height > 0)) return null;
    const rawDx = (clientX - startX) / width;
    const rawDy = (clientY - startY) / height;
    const signedDx = mirrored ? -rawDx : rawDx;
    return {
        dx: clamp((Number(startTuning.dx) || 0) + signedDx, -1, 1),
        dy: clamp((Number(startTuning.dy) || 0) + rawDy, -1, 1),
    };
}

/** Base width of a slot's asset as a fraction of the canvas width. */
export const SLOT_BASE_WIDTH = {
    face: 0.62,
    upper: 0.5,
    lower: 0.9,
};

export const DEFAULT_TUNING = { dx: 0, dy: 0, scale: 1 };
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 2.2;

export function resolveFilterId(id) {
    return FILTER_IDS.includes(id) ? id : DEFAULT_FILTER_ID;
}

export function resolveFilterPreset(id) {
    const resolved = resolveFilterId(id);
    return FILTER_PRESETS.find((p) => p.id === resolved);
}

export function resolveLensId(id) {
    return LENS_IDS.includes(id) ? id : DEFAULT_LENS_ID;
}

export function resolveLensPreset(id) {
    const resolved = resolveLensId(id);
    return LENS_PRESETS.find((p) => p.id === resolved);
}

export function resolveScreenId(id) {
    return SCREEN_IDS.includes(id) ? id : DEFAULT_SCREEN_ID;
}

export function resolveScreenPreset(id) {
    const resolved = resolveScreenId(id);
    return SCREEN_PRESETS.find((p) => p.id === resolved);
}

/**
 * Both pickers (filters and lens effects) behave the same way: a radio
 * group with an explicit "None", where tapping the applied option removes it.
 * Filters and lens effects are independent, so this is shared, never
 * cross-checked.
 */
export function toggleChoiceId(ids, defaultId, currentId, clickedId) {
    const clicked = ids.includes(clickedId) ? clickedId : defaultId;
    if (clicked === defaultId) return defaultId;
    const current = ids.includes(currentId) ? currentId : defaultId;
    return clicked === current ? defaultId : clicked;
}

/**
 * Filter chips behave like a radio group with an explicit "None": exactly one
 * filter is applied at a time, tapping the applied filter removes it, and
 * tapping None always clears it. Without the toggle-off, a learner could never
 * get back to an untouched camera frame (stories/092 review).
 */
export function toggleFilterId(currentId, clickedId) {
    const clicked = resolveFilterId(clickedId);
    if (clicked === DEFAULT_FILTER_ID) return DEFAULT_FILTER_ID;
    return clicked === resolveFilterId(currentId) ? DEFAULT_FILTER_ID : clicked;
}

/** Same rule for the lens effect, independently of the filter. */
export function toggleLensId(currentId, clickedId) {
    return toggleChoiceId(LENS_IDS, DEFAULT_LENS_ID, resolveLensId(currentId), clickedId);
}

/** Same rule for the screen overlay, independently of both of the above. */
export function toggleScreenId(currentId, clickedId) {
    return toggleChoiceId(SCREEN_IDS, DEFAULT_SCREEN_ID, resolveScreenId(currentId), clickedId);
}

/** Only the friend-closed-response step gets the preview gate + look controls. */
export function isPreviewGateStep(step) {
    return !!step && step.responseType === 'friendClosedResponse';
}

export function overlaySlugsForSlot(slot) {
    return OVERLAY_SLUGS.filter((slug) => OVERLAY_LIBRARY[slug].slot === slot);
}

/** A slug is usable only in its own slot — `cauldron` can never become a face cover. */
export function isSlugValidForSlot(slug, slot) {
    if (slug === null || slug === undefined) return true;
    const entry = OVERLAY_LIBRARY[slug];
    return !!entry && entry.slot === slot;
}

export function emptySelection() {
    return { filterId: DEFAULT_FILTER_ID, lensId: DEFAULT_LENS_ID, screenId: DEFAULT_SCREEN_ID, slots: { face: null, upper: null, lower: null } };
}

export function emptyTuning() {
    return { face: { ...DEFAULT_TUNING }, upper: { ...DEFAULT_TUNING }, lower: { ...DEFAULT_TUNING } };
}

/** True when the learner's look differs from a plain camera frame. */
export function isLookActive(selection) {
    const safe = sanitizeSelection(selection);
    if (safe.filterId !== DEFAULT_FILTER_ID) return true;
    if (safe.lensId !== DEFAULT_LENS_ID) return true;
    if (safe.screenId !== DEFAULT_SCREEN_ID) return true;
    return OVERLAY_SLOTS.some((slot) => !!safe.slots[slot]);
}

/**
 * Apply a step's config overlays exactly once, the first time that step's preview
 * opens. A re-record of the same step must NOT re-apply them (it would undo the
 * learner's own choices and dragging); a different step is its own key.
 */
let appliedStepKey = null;

export function applyStepLookOverlaysOnce({ stepKey, stepOverlays, store }) {
    if (!store || !stepKey) return false;
    if (appliedStepKey === stepKey) return false;
    appliedStepKey = stepKey;
    const declared = parseStepOverlays(stepOverlays);
    const hasAny = OVERLAY_SLOTS.some((slot) => !!declared[slot]);
    if (hasAny) store.getState().applyStepLookOverlays(declared);
    return hasAny;
}

export function resetAppliedStepOverlays() {
    appliedStepKey = null;
}

function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * Coerce anything (store state, a stale config, undefined) into a usable
 * selection: an unknown filter becomes `natural`, an invalid slug is dropped,
 * and the slot map always has all three keys.
 */
export function sanitizeSelection(selection) {
    const safe = emptySelection();
    if (!selection || typeof selection !== 'object') return safe;
    safe.filterId = resolveFilterId(selection.filterId);
    safe.lensId = resolveLensId(selection.lensId);
    safe.screenId = resolveScreenId(selection.screenId);
    const slots = selection.slots;
    if (slots && typeof slots === 'object') {
        for (const slot of OVERLAY_SLOTS) {
            const slug = slots[slot];
            safe.slots[slot] = isSlugValidForSlot(slug, slot) && slug ? slug : null;
        }
    }
    return safe;
}

export function sanitizeTuning(tuning) {
    const safe = emptyTuning();
    if (!tuning || typeof tuning !== 'object') return safe;
    for (const slot of OVERLAY_SLOTS) {
        const entry = tuning[slot];
        if (!entry || typeof entry !== 'object') continue;
        safe[slot] = {
            dx: clamp(Number(entry.dx), -1, 1),
            dy: clamp(Number(entry.dy), -1, 1),
            scale: clamp(Number(entry.scale), MIN_SCALE, MAX_SCALE),
        };
    }
    return safe;
}

/**
 * Read a step's `overlays` config. Accepts the documented object shape
 * (`{ face: { asset: 'smiley' }, upper: {...}, lower: {...} }`) and tolerates a
 * bare slug string per slot. Unknown slugs are dropped, never carried forward.
 */
export function parseStepOverlays(stepOverlays) {
    const result = { face: null, upper: null, lower: null };
    if (!stepOverlays || typeof stepOverlays !== 'object') return result;
    for (const slot of OVERLAY_SLOTS) {
        const raw = stepOverlays[slot];
        const slug = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.asset : null;
        if (slug && isSlugValidForSlot(slug, slot)) result[slot] = slug;
    }
    return result;
}

/**
 * Apply a step's config overlays ONCE, on that step: declared slots are filled,
 * every other slot keeps whatever the learner already chose. Config values are
 * never returned for a later step (the caller only passes the current step).
 */
export function applyStepOverlays(selection, stepOverlays) {
    const safe = sanitizeSelection(selection);
    const declared = parseStepOverlays(stepOverlays);
    for (const slot of OVERLAY_SLOTS) {
        if (declared[slot]) safe.slots[slot] = declared[slot];
    }
    return safe;
}

/** Centre point of a slot's default position, in canvas pixels. */
export function resolveSlotAnchor(slot, canvasWidth, canvasHeight) {
    const anchor = SLOT_ANCHORS[slot] || SLOT_ANCHORS.face;
    return { cx: anchor.cx * canvasWidth, cy: anchor.cy * canvasHeight };
}

/**
 * Where a slot's asset is drawn: anchored, tuned by the learner (dx/dy are
 * fractions of the canvas), aspect preserved, and clamped inside the canvas so a
 * prop can never be dragged off-frame into nothing.
 */
export function resolveSlotDrawRect({ slot, imageWidth, imageHeight, canvasWidth, canvasHeight, tuning }) {
    if (!Number.isFinite(imageWidth) || imageWidth <= 0) return null;
    if (!Number.isFinite(imageHeight) || imageHeight <= 0) return null;
    if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return null;
    if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) return null;
    const t = tuning && typeof tuning === 'object' ? tuning : DEFAULT_TUNING;
    const scale = clamp(Number(t.scale), MIN_SCALE, MAX_SCALE) || 1;
    const baseWidth = (SLOT_BASE_WIDTH[slot] || 0.6) * canvasWidth;
    const dw = baseWidth * scale;
    const dh = dw * (imageHeight / imageWidth);
    const anchor = resolveSlotAnchor(slot, canvasWidth, canvasHeight);
    const dxToCentre = clamp(Number(t.dx), -1, 1) * canvasWidth;
    const dyToCentre = clamp(Number(t.dy), -1, 1) * canvasHeight;
    const cx = anchor.cx + dxToCentre;
    const cy = anchor.cy + dyToCentre;
    // Keep at least a third of the asset on screen on each axis.
    const minX = -dw * 0.66;
    const maxX = canvasWidth - dw * 0.33;
    const minY = -dh * 0.66;
    const maxY = canvasHeight - dh * 0.33;
    return {
        dx: Math.round(clamp(cx - dw / 2, minX, maxX)),
        dy: Math.round(clamp(cy - dh / 2, minY, maxY)),
        dw: Math.round(dw),
        dh: Math.round(dh),
    };
}

/** Human-facing file name for a slug (used by pickers and logs). */
export function assetFileForSlug(slug) {
    const entry = OVERLAY_LIBRARY[slug];
    return entry ? entry.file : null;
}

// ---------------------------------------------------------------------------
// Painting. Still pure: the caller hands in the 2d context, a scratch canvas and
// an already-decoded image per slug. No DOM, no globals.
// ---------------------------------------------------------------------------

/** The colour grade for a preset: a sequence of blend-mode fills. */
export function paintFilterGrade({ ctx, canvasWidth, canvasHeight, presetId }) {
    if (!ctx) return 'none';
    const preset = resolveFilterPreset(presetId);
    if (!preset || preset.ops.length === 0) return 'none';
    try {
        for (const pass of preset.ops) {
            ctx.save();
            ctx.globalCompositeOperation = pass.op;
            ctx.globalAlpha = Math.min(1, Math.max(0, pass.alpha));
            ctx.fillStyle = pass.color;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            ctx.restore();
        }
        return preset.id;
    } catch (e) {
        return 'none';
    }
}

function isImageReady(image) {
    return !!image && image.complete !== false && Number(image.naturalWidth) > 0;
}

/** One slot's asset, positioned by the anchor + the learner's tuning. */
export function paintSlotOverlay({ ctx, image, slot, canvasWidth, canvasHeight, tuning }) {
    if (!ctx || !isImageReady(image)) return false;
    const rect = resolveSlotDrawRect({
        slot,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        canvasWidth,
        canvasHeight,
        tuning,
    });
    if (!rect) return false;
    try {
        ctx.drawImage(image, rect.dx, rect.dy, rect.dw, rect.dh);
        return true;
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Screen overlays. Deterministic: a drop's position is a pure function of its
// index and the frame time, so the take animates without any per-frame state
// and a test can assert that time moves the drops.
// ---------------------------------------------------------------------------

export const RAINDROP_COUNT = 26;

/** A stable 0..1 number per seed (no Math.random: frames must be reproducible). */
function hash01(seed) {
    let x = (seed * 2654435761) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 2246822519) >>> 0;
    return x / 4294967296;
}

/** One drop's live geometry at a given time, in canvas pixels. */
export function resolveRaindrop({ index, timeMs = 0, canvasWidth, canvasHeight }) {
    const size = hash01(index * 3 + 3);
    const travel = ((hash01(index * 3 + 2) + (timeMs / 1000) * (0.35 + size * 0.35)) % 1.2) - 0.1;
    return {
        // Falling down-and-left, so the field reads as arriving from the top
        // right: the horizontal offset grows with the fall.
        x: (hash01(index * 3 + 1) - travel * 0.16) * canvasWidth,
        y: travel * canvasHeight,
        radius: canvasWidth * (0.006 + size * 0.008),
        tail: canvasHeight * (0.03 + size * 0.03),
        alpha: 0.18 + size * 0.22,
    };
}

/**
 * Paint the chosen screen overlay over the whole frame. Returns the id painted
 * ('none' when there is nothing to draw or the painter threw), so the adapter
 * can log it.
 */
export function paintScreenOverlay({ ctx, canvasWidth, canvasHeight, screenId, timeMs = 0 }) {
    const id = resolveScreenId(screenId);
    if (!ctx || id === 'none') return 'none';
    if (!(canvasWidth > 0) || !(canvasHeight > 0)) return 'none';
    if (id !== 'raindrops') return 'none';
    try {
        ctx.save();
        ctx.fillStyle = 'rgb(178, 220, 255)';
        for (let i = 0; i < RAINDROP_COUNT; i++) {
            const drop = resolveRaindrop({ index: i, timeMs, canvasWidth, canvasHeight });
            ctx.globalAlpha = drop.alpha;
            // The tear: a round head with a tapered tail pointing back up the
            // direction of travel.
            ctx.beginPath();
            ctx.ellipse(drop.x, drop.y, drop.radius, drop.radius * 1.25, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(drop.x - drop.radius * 0.7, drop.y - drop.radius * 0.6);
            ctx.lineTo(drop.x + drop.radius * 0.7, drop.y - drop.radius * 0.6);
            ctx.lineTo(drop.x + drop.radius * 1.6, drop.y - drop.radius * 0.6 - drop.tail);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        return id;
    } catch (e) {
        return 'none';
    }
}

/**
 * The whole look for one frame, in the fixed order that matters:
 *   1. beauty (soft-focus + light) under the colour grade,
 *   2. colour grade,
 *   3. the lens effect (soft focus / chiaroscuro) over the grade, under the
 *      props — it is the room's lighting and optics, not a tint on the face,
 *   4. overlays face → upper → lower (a lower prop never covers a face cover),
 *   5. the screen overlay (rain/atmosphere) over everything, animated from
 *      `timeMs` so the take moves.
 *
 * `images` maps slug → decoded image; a slug whose image is still loading is
 * simply skipped for that frame.
 */
export function paintLooks({
    ctx,
    source,
    scratch,
    canvasWidth,
    canvasHeight,
    selection,
    tuning,
    images,
    paintBeauty,
    timeMs = 0,
}) {
    if (!ctx) return { filter: 'none', lens: 'none', screen: 'none', slots: [] };
    const safe = sanitizeSelection(selection);
    const safeTuning = sanitizeTuning(tuning);
    const preset = resolveFilterPreset(safe.filterId);

    let filterPainted = 'none';
    if (preset && preset.beauty && preset.beauty !== 'none' && typeof paintBeauty === 'function') {
        paintBeauty({
            ctx,
            source,
            scratch,
            canvasWidth,
            canvasHeight,
            mode: preset.beauty,
        });
    }
    if (preset && preset.ops.length > 0) {
        filterPainted = paintFilterGrade({ ctx, canvasWidth, canvasHeight, presetId: preset.id });
    } else if (preset) {
        filterPainted = preset.id;
    }

    // The lens effect is independent of the filter: both can be on at once.
    let lensPainted = 'none';
    const lensPreset = resolveLensPreset(safe.lensId);
    if (lensPreset && lensPreset.beautyMode && typeof paintBeauty === 'function') {
        const painted = paintBeauty({
            ctx,
            source,
            scratch,
            canvasWidth,
            canvasHeight,
            mode: lensPreset.beautyMode,
            // Close-up cuts its sharp oval out of the blur; every other lens
            // treats the whole frame.
            hole: lensPreset.hole ? resolveCloseUpHole(canvasWidth, canvasHeight) : null,
        });
        lensPainted = painted === 'none' ? 'none' : lensPreset.id;
    }

    const paintedSlots = [];
    for (const slot of SLOT_DRAW_ORDER) {
        const slug = safe.slots[slot];
        if (!slug) continue;
        const image = images ? images[slug] : null;
        if (paintSlotOverlay({ ctx, image, slot, canvasWidth, canvasHeight, tuning: safeTuning[slot] })) {
            paintedSlots.push(slot);
        }
    }
    // Screen overlays go on last: rain is in the air, in front of the learner
    // and in front of the props.
    const screenPainted = paintScreenOverlay({
        ctx,
        canvasWidth,
        canvasHeight,
        screenId: safe.screenId,
        timeMs,
    });

    return { filter: filterPainted, lens: lensPainted, screen: screenPainted, slots: paintedSlots };
}

