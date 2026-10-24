// modules/lesson/step-celebration.web.js
// Web binding for the end-of-step celebration: picks a variant, resolves the
// custom shapes and fires the bursts. Everything decision-shaped lives in
// step-celebration-logic.js; this file only talks to the canvas-confetti API.
//
// The library is imported dynamically so it stays a lazy chunk, and every
// dependency (loader, RNG, scheduler) is injectable so the jsdom tests never
// touch a real canvas (jsdom has no canvas, Path2D or DOMMatrix).

import {
    CELEBRATION_PATHS,
    buildCelebrationPlan,
    pickCelebrationVariant,
} from './step-celebration-logic.js';

// Monotonic guard: React.StrictMode runs a mount effect twice, and a step
// transition renders the effect again with the same trigger value.
let _handledTrigger = 0;
let _lastVariantIndex = -1;
// shapeFromPath builds a Path2D per call, so resolved shapes are reused for the
// life of the page (they are immutable descriptors the library only reads).
let _shapeCache = new Map();
let _customShapesWarned = false;

/** Test seam: forget the handled trigger, the last variant and the shape cache. */
export function resetStepCelebrationState() {
    _handledTrigger = 0;
    _lastVariantIndex = -1;
    _shapeCache = new Map();
    _customShapesWarned = false;
}

function loadCanvasConfetti() {
    return import('canvas-confetti');
}

function warnCustomShapesOnce(detail) {
    if (_customShapesWarned) return;
    _customShapesWarned = true;
    console.warn('[StepCelebration] custom shapes unavailable, using built-ins:', detail);
}

function resolveCustomShape(key, api) {
    if (_shapeCache.has(key)) return _shapeCache.get(key);
    const definition = CELEBRATION_PATHS[key];
    if (!definition) return null;
    const shape = api.shapeFromPath(definition);
    _shapeCache.set(key, shape);
    return shape;
}

/**
 * Merge a burst's built-in shapes with its resolved custom ones. A missing or
 * throwing `shapeFromPath` (older browser without Path2D/DOMMatrix) is not
 * fatal: the burst still fires with the built-in shapes only.
 */
function resolveShapes(burst, api) {
    const builtin = Array.isArray(burst.options.shapes) ? burst.options.shapes : [];
    const keys = Array.isArray(burst.customShapes) ? burst.customShapes : [];
    if (keys.length === 0) return builtin;
    if (typeof api.shapeFromPath !== 'function') {
        warnCustomShapesOnce('shapeFromPath is not available');
        return builtin;
    }
    try {
        const custom = keys
            .map((key) => resolveCustomShape(key, api))
            .filter((shape) => shape !== null && shape !== undefined);
        return [...builtin, ...custom];
    } catch (error) {
        warnCustomShapesOnce(error && error.message ? error.message : error);
        return builtin;
    }
}

/**
 * Fire the celebration for a step advance, at most once per trigger value.
 *
 * @param {object} [options]
 * @param {number} [options.trigger] the store's stepCelebrationTrigger value
 * @param {() => Promise<any>} [options.loadConfetti] injected library loader
 * @param {() => number} [options.random] injected RNG
 * @param {(fn: () => void, ms: number) => any} [options.schedule] injected scheduler
 * @returns {Promise<{ variantId: string, plan: object[] }|null>}
 */
export async function runStepCelebration({
    trigger,
    loadConfetti = loadCanvasConfetti,
    random = Math.random,
    schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
    if (!Number.isFinite(trigger) || trigger <= 0) return null;
    if (trigger === _handledTrigger) return null;
    _handledTrigger = trigger;

    const { index, variant } = pickCelebrationVariant(_lastVariantIndex, random);
    _lastVariantIndex = index;
    const plan = buildCelebrationPlan(index, random);

    const loaded = await loadConfetti();
    // The module build only exports `default`/`create`; shapeFromPath and
    // shapeFromText hang off the default export function.
    const mod = loaded;
    const api = (mod && mod.default) || mod;
    if (typeof api !== 'function') {
        console.warn('[StepCelebration] confetti library unavailable; skipping celebration');
        return null;
    }

    for (const burst of plan) {
        // A throw inside the scheduled callback would otherwise be an uncaught
        // error and could stop the remaining bursts.
        const options = { ...burst.options, shapes: resolveShapes(burst, api) };
        schedule(() => {
            try {
                api(options);
            } catch (error) {
                console.warn(
                    '[StepCelebration] burst failed:',
                    error && error.message ? error.message : error
                );
            }
        }, burst.delayMs);
    }

    console.log(`[StepCelebration] variant=${variant.id} bursts=${plan.length}`);
    return { variantId: variant.id, plan };
}
