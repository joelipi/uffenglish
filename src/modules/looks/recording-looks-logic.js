// Recording looks: filters, overlay slots, and per-step overlay defaults.
//
// Pure module — no React, no DOM, no browser globals — so every rule here is
// unit-tested and the browser adapter (speech.web.js) stays thin.
//
// Nothing in here tracks a face. "face" and "upper" are fixed anchor ZONES on
// the canvas; the learner frames their own head behind them.
//
// See stories/092-look-controls.

import { isTwemojiSlug, twemojiAssetUrl, twemojiCodeFromSlug } from './twemoji-collection.js';

export const OVERLAY_SLOTS = ['face', 'upper', 'lower', 'emoji'];

// Draw order: a lower prop must never paint over a face cover; the free-floating
// emoji is an object in the scene, so it paints after the slot props.
export const SLOT_DRAW_ORDER = ['face', 'upper', 'lower', 'emoji'];

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
    { id: 'snowfall', label: 'Snowfall', labelKey: 'look_screen_snowfall', swatch: 'radial-gradient(circle at 28% 22%, #ffffff 0 5%, transparent 6%), radial-gradient(circle at 64% 44%, #ffffff 0 4%, transparent 5%), radial-gradient(circle at 42% 72%, #ffffff 0 4%, transparent 5%), linear-gradient(165deg, #1d2430 0%, #46536a 100%)' },
    { id: 'sunny', label: 'Sunny', labelKey: 'look_screen_sunny', swatch: 'radial-gradient(circle at 78% 10%, #fff7d6 0%, #ffd98a 16%, rgba(255,196,110,0.35) 38%, transparent 62%), linear-gradient(160deg, #1d2430 0%, #3b4a63 100%)' },
    { id: 'windy', label: 'Windy', labelKey: 'look_screen_windy', swatch: 'repeating-linear-gradient(8deg, transparent 0 6px, rgba(255,255,255,0.55) 7px, transparent 8px 14px), linear-gradient(160deg, #22303e 0%, #4a5c70 100%)' },
    { id: 'confetti', label: 'Confetti', labelKey: 'look_screen_confetti', swatch: 'radial-gradient(circle at 25% 25%, #ff5656 0 8%, transparent 9%), radial-gradient(circle at 60% 40%, #ffc440 0 7%, transparent 8%), radial-gradient(circle at 40% 70%, #56c8ff 0 7%, transparent 8%), radial-gradient(circle at 80% 65%, #7ee07a 0 6%, transparent 7%), linear-gradient(150deg, #1d2430 0%, #3a4657 100%)' },
    { id: 'leaves', label: 'Leaves', labelKey: 'look_screen_leaves', swatch: 'radial-gradient(circle at 35% 30%, #d6a84c 0 12%, transparent 13%), radial-gradient(circle at 65% 60%, #c46c34 0 11%, transparent 12%), radial-gradient(circle at 45% 80%, #7e9e4a 0 10%, transparent 11%), linear-gradient(150deg, #243024 0%, #4a5a3a 100%)' },
    { id: 'petals', label: 'Petals', labelKey: 'look_screen_petals', swatch: 'radial-gradient(circle at 30% 30%, #ffb7d2 0 10%, transparent 11%), radial-gradient(circle at 62% 52%, #ff94b8 0 9%, transparent 10%), radial-gradient(circle at 42% 76%, #ffd2e2 0 8%, transparent 9%), linear-gradient(150deg, #2a1f28 0%, #5a3a4a 100%)' },
    { id: 'bubbles', label: 'Bubbles', labelKey: 'look_screen_bubbles', swatch: 'radial-gradient(circle at 50% 58%, transparent 0 40%, rgba(220,245,255,0.9) 41% 47%, transparent 48%), radial-gradient(circle at 32% 30%, transparent 0 20%, rgba(220,245,255,0.6) 21% 25%, transparent 26%), linear-gradient(160deg, #132430 0%, #2f5568 100%)' },
    { id: 'embers', label: 'Embers', labelKey: 'look_screen_embers', swatch: 'radial-gradient(circle at 30% 70%, #ffa848 0 7%, transparent 8%), radial-gradient(circle at 62% 45%, #ff7830 0 6%, transparent 7%), radial-gradient(circle at 45% 25%, #ffcc6e 0 5%, transparent 6%), linear-gradient(165deg, #1a1008 0%, #5a2a10 100%)' },
    { id: 'fireflies', label: 'Fireflies', labelKey: 'look_screen_fireflies', swatch: 'radial-gradient(circle at 35% 40%, #ffec96 0 9%, transparent 10%), radial-gradient(circle at 65% 65%, #ffec96 0 7%, transparent 8%), linear-gradient(160deg, #0e1a12 0%, #1f3a26 100%)' },
    { id: 'hearts', label: 'Hearts', labelKey: 'look_screen_hearts', swatch: 'radial-gradient(circle at 50% 38%, #ff608c 0 16%, transparent 17%), radial-gradient(circle at 50% 68%, #ff8caa 0 12%, transparent 13%), linear-gradient(160deg, #2a1420 0%, #5a2a3c 100%)' },
    { id: 'stars', label: 'Starfield', labelKey: 'look_screen_stars', swatch: 'radial-gradient(circle at 20% 25%, #ffffff 0 5%, transparent 6%), radial-gradient(circle at 60% 35%, #ffffff 0 4%, transparent 5%), radial-gradient(circle at 40% 70%, #ffffff 0 4%, transparent 5%), radial-gradient(circle at 78% 62%, #ffffff 0 3%, transparent 4%), linear-gradient(170deg, #080b18 0%, #1b2440 100%)' },
    { id: 'shootingstar', label: 'Shooting star', labelKey: 'look_screen_shooting_star', swatch: 'linear-gradient(20deg, transparent 0 55%, rgba(255,250,232,0.95) 58%, rgba(255,250,232,0.2) 62%, transparent 66%), linear-gradient(170deg, #080b18 0%, #1b2440 100%)' },
    { id: 'vhs', label: 'VHS', labelKey: 'look_screen_vhs', swatch: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.55) 0 2px, rgba(255,255,255,0.08) 2px 4px), linear-gradient(170deg, #101820 0%, #2a3a4a 100%)' },
    { id: 'grain', label: 'Film grain', labelKey: 'look_screen_grain', swatch: 'radial-gradient(circle at 20% 30%, #ffffff 0 1.5%, transparent 2%), radial-gradient(circle at 55% 60%, #ffffff 0 1.5%, transparent 2%), radial-gradient(circle at 80% 25%, #ffffff 0 1.5%, transparent 2%), linear-gradient(160deg, #2a2a2a 0%, #3d3d3d 100%)' },
    { id: 'bokeh', label: 'Bokeh', labelKey: 'look_screen_bokeh', swatch: 'radial-gradient(circle at 35% 38%, rgba(255,244,214,0.9) 0 14%, transparent 30%), radial-gradient(circle at 68% 62%, rgba(255,236,196,0.7) 0 10%, transparent 26%), linear-gradient(160deg, #141820 0%, #2a3444 100%)' },
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
    // Original art from scripts/generate-overlay-art.py: the carnival mask has
    // genuinely transparent eye openings, and the sunglasses' lenses are a
    // 59% tint so the learner's eyes still read through them.
    carnival: { slot: 'face', file: '/overlays/face/carnival.png', anchor: 'face', label: 'Carnival mask', labelKey: 'look_overlay_carnival' },
    shades: { slot: 'face', file: '/overlays/face/sunglasses.png', anchor: 'face', label: 'Sunglasses', labelKey: 'look_overlay_shades' },
    // Twemoji-derived (CC-BY 4.0, see public/overlays/TWEMOJI-ATTRIBUTION.md),
    // generated by scripts/generate-twemoji-overlays.mjs: same slots, but the
    // eye areas are genuinely transparent so the learner's eyes show through.
    'carnival-twemoji': { slot: 'face', file: '/overlays/face/carnival-twemoji.png', anchor: 'face', label: 'Carnival mask (emoji)', labelKey: 'look_overlay_carnival_twemoji' },
    'shades-twemoji': { slot: 'face', file: '/overlays/face/shades-twemoji.png', anchor: 'face', label: 'Sunglasses (emoji)', labelKey: 'look_overlay_shades_twemoji' },
    'alien-twemoji': { slot: 'face', file: '/overlays/face/alien-twemoji.png', anchor: 'face', label: 'Alien', labelKey: 'look_overlay_alien_twemoji' },
    'clown-twemoji': { slot: 'face', file: '/overlays/face/clown-twemoji.png', anchor: 'face', label: 'Clown face', labelKey: 'look_overlay_clown_twemoji' },
    'grinning-cat-twemoji': { slot: 'face', file: '/overlays/face/grinning-cat-twemoji.png', anchor: 'face', label: 'Grinning cat', labelKey: 'look_overlay_grinning_cat_twemoji' },
    'monkey-twemoji': { slot: 'face', file: '/overlays/face/monkey-twemoji.png', anchor: 'face', label: 'Monkey face', labelKey: 'look_overlay_monkey_twemoji' },
    'dog-twemoji': { slot: 'face', file: '/overlays/face/dog-twemoji.png', anchor: 'face', label: 'Dog face', labelKey: 'look_overlay_dog_twemoji' },
    'bear-twemoji': { slot: 'face', file: '/overlays/face/bear-twemoji.png', anchor: 'face', label: 'Bear', labelKey: 'look_overlay_bear_twemoji' },
    'grinning-twemoji': { slot: 'face', file: '/overlays/face/grinning-twemoji.png', anchor: 'face', label: 'Grinning', labelKey: 'look_overlay_grinning_twemoji' },
    'beaming-twemoji': { slot: 'face', file: '/overlays/face/beaming-twemoji.png', anchor: 'face', label: 'Beaming', labelKey: 'look_overlay_beaming_twemoji' },
    'joy-twemoji': { slot: 'face', file: '/overlays/face/joy-twemoji.png', anchor: 'face', label: 'Joy', labelKey: 'look_overlay_joy_twemoji' },
    'big-grin-twemoji': { slot: 'face', file: '/overlays/face/big-grin-twemoji.png', anchor: 'face', label: 'Big grin', labelKey: 'look_overlay_big_grin_twemoji' },
    'sweat-twemoji': { slot: 'face', file: '/overlays/face/sweat-twemoji.png', anchor: 'face', label: 'Sweat', labelKey: 'look_overlay_sweat_twemoji' },
    'squinting-twemoji': { slot: 'face', file: '/overlays/face/squinting-twemoji.png', anchor: 'face', label: 'Squinting', labelKey: 'look_overlay_squinting_twemoji' },
    'smiling-twemoji': { slot: 'face', file: '/overlays/face/smiling-twemoji.png', anchor: 'face', label: 'Smiling', labelKey: 'look_overlay_smiling_twemoji' },
    'tongue-twemoji': { slot: 'face', file: '/overlays/face/tongue-twemoji.png', anchor: 'face', label: 'Tongue', labelKey: 'look_overlay_tongue_twemoji' },
    'party-twemoji': { slot: 'face', file: '/overlays/face/party-twemoji.png', anchor: 'face', label: 'Party', labelKey: 'look_overlay_party_twemoji' },
    'angry-twemoji': { slot: 'face', file: '/overlays/face/angry-twemoji.png', anchor: 'face', label: 'Angry', labelKey: 'look_overlay_angry_twemoji' },
    'nauseated-twemoji': { slot: 'face', file: '/overlays/face/nauseated-twemoji.png', anchor: 'face', label: 'Nauseated', labelKey: 'look_overlay_nauseated_twemoji' },
    'vomiting-twemoji': { slot: 'face', file: '/overlays/face/vomiting-twemoji.png', anchor: 'face', label: 'Vomiting', labelKey: 'look_overlay_vomiting_twemoji' },
    'cat-twemoji': { slot: 'face', file: '/overlays/face/cat-twemoji.png', anchor: 'face', label: 'Cat', labelKey: 'look_overlay_cat_twemoji' },
    'pig-twemoji': { slot: 'face', file: '/overlays/face/pig-twemoji.png', anchor: 'face', label: 'Pig', labelKey: 'look_overlay_pig_twemoji' },
    'tiger-twemoji': { slot: 'face', file: '/overlays/face/tiger-twemoji.png', anchor: 'face', label: 'Tiger', labelKey: 'look_overlay_tiger_twemoji' },
    'fox-twemoji': { slot: 'face', file: '/overlays/face/fox-twemoji.png', anchor: 'face', label: 'Fox', labelKey: 'look_overlay_fox_twemoji' },
    'cow-twemoji': { slot: 'face', file: '/overlays/face/cow-twemoji.png', anchor: 'face', label: 'Cow', labelKey: 'look_overlay_cow_twemoji' },
    'panda-twemoji': { slot: 'face', file: '/overlays/face/panda-twemoji.png', anchor: 'face', label: 'Panda', labelKey: 'look_overlay_panda_twemoji' },
    'rabbit-twemoji': { slot: 'face', file: '/overlays/face/rabbit-twemoji.png', anchor: 'face', label: 'Rabbit', labelKey: 'look_overlay_rabbit_twemoji' },
    'mouse-twemoji': { slot: 'face', file: '/overlays/face/mouse-twemoji.png', anchor: 'face', label: 'Mouse', labelKey: 'look_overlay_mouse_twemoji' },
    'koala-twemoji': { slot: 'face', file: '/overlays/face/koala-twemoji.png', anchor: 'face', label: 'Koala', labelKey: 'look_overlay_koala_twemoji' },
    'frog-twemoji': { slot: 'face', file: '/overlays/face/frog-twemoji.png', anchor: 'face', label: 'Frog', labelKey: 'look_overlay_frog_twemoji' },
    'owl-twemoji': { slot: 'face', file: '/overlays/face/owl-twemoji.png', anchor: 'face', label: 'Owl', labelKey: 'look_overlay_owl_twemoji' },
    'hamster-twemoji': { slot: 'face', file: '/overlays/face/hamster-twemoji.png', anchor: 'face', label: 'Hamster', labelKey: 'look_overlay_hamster_twemoji' },
    // Full-body costume covers: the face is punched out, so the learner's own
    // face fills the opening while the uniform and headwear stay.
    'police-officer': { slot: 'face', file: '/overlays/face/police-officer.png', anchor: 'face', label: 'Police officer', labelKey: 'look_overlay_police_officer' },
    chef: { slot: 'face', file: '/overlays/face/chef.png', anchor: 'face', label: 'Chef', labelKey: 'look_overlay_chef' },
    doctor: { slot: 'face', file: '/overlays/face/doctor.png', anchor: 'face', label: 'Doctor', labelKey: 'look_overlay_doctor' },
    firefighter: { slot: 'face', file: '/overlays/face/firefighter.png', anchor: 'face', label: 'Firefighter', labelKey: 'look_overlay_firefighter' },
    pilot: { slot: 'face', file: '/overlays/face/pilot.png', anchor: 'face', label: 'Pilot', labelKey: 'look_overlay_pilot' },
    astronaut: { slot: 'face', file: '/overlays/face/astronaut.png', anchor: 'face', label: 'Astronaut', labelKey: 'look_overlay_astronaut' },
    farmer: { slot: 'face', file: '/overlays/face/farmer.png', anchor: 'face', label: 'Farmer', labelKey: 'look_overlay_farmer' },
    'factory-worker': { slot: 'face', file: '/overlays/face/factory-worker.png', anchor: 'face', label: 'Factory worker', labelKey: 'look_overlay_factory_worker' },
    judge: { slot: 'face', file: '/overlays/face/judge.png', anchor: 'face', label: 'Judge', labelKey: 'look_overlay_judge' },
    'judge-female': { slot: 'face', file: '/overlays/face/judge-female.png', anchor: 'face', label: 'Female judge', labelKey: 'look_overlay_judge_female' },
    'construction-worker': { slot: 'face', file: '/overlays/face/construction-worker.png', anchor: 'face', label: 'Construction worker', labelKey: 'look_overlay_construction_worker' },
    // Above-the-face props.
    witchhat: { slot: 'upper', file: '/overlays/props/witchhat.png', anchor: 'upper', label: 'Witch hat', labelKey: 'look_overlay_witchhat' },
    crown: { slot: 'upper', file: '/overlays/props/crown.png', anchor: 'upper', label: 'Crown', labelKey: 'look_overlay_crown' },
    'graduationcap-twemoji': { slot: 'upper', file: '/overlays/props/graduationcap-twemoji.png', anchor: 'upper', label: 'Graduation cap', labelKey: 'look_overlay_graduationcap_twemoji' },
    'tophat-twemoji': { slot: 'upper', file: '/overlays/props/tophat-twemoji.png', anchor: 'upper', label: 'Top hat', labelKey: 'look_overlay_tophat_twemoji' },
    'santa-hat': { slot: 'upper', file: '/overlays/props/santa-hat.png', anchor: 'upper', label: 'Santa hat', labelKey: 'look_overlay_santa_hat' },
    'mrs-claus-hat': { slot: 'upper', file: '/overlays/props/mrs-claus-hat.png', anchor: 'upper', label: "Mrs Claus hat", labelKey: 'look_overlay_mrs_claus_hat' },
    'mage-hat': { slot: 'upper', file: '/overlays/props/mage-hat.png', anchor: 'upper', label: 'Mage hat', labelKey: 'look_overlay_mage_hat' },
    'prince-hat': { slot: 'upper', file: '/overlays/props/prince-hat.png', anchor: 'upper', label: 'Prince hat', labelKey: 'look_overlay_prince_hat' },
    'princess-hat': { slot: 'upper', file: '/overlays/props/princess-hat.png', anchor: 'upper', label: 'Princess hat', labelKey: 'look_overlay_princess_hat' },
    'guard-hat': { slot: 'upper', file: '/overlays/props/guard-hat.png', anchor: 'upper', label: 'Guard hat', labelKey: 'look_overlay_guard_hat' },
    'construction-hat': { slot: 'upper', file: '/overlays/props/construction-hat.png', anchor: 'upper', label: 'Construction hat', labelKey: 'look_overlay_construction_hat' },
    'turban-hat': { slot: 'upper', file: '/overlays/props/turban-hat.png', anchor: 'upper', label: 'Turban', labelKey: 'look_overlay_turban_hat' },
    'cowboy-hat': { slot: 'upper', file: '/overlays/props/cowboy-hat.png', anchor: 'upper', label: 'Cowboy hat', labelKey: 'look_overlay_cowboy_hat' },
    'billed-cap': { slot: 'upper', file: '/overlays/props/billed-cap.png', anchor: 'upper', label: 'Billed cap', labelKey: 'look_overlay_billed_cap' },
    'helmet': { slot: 'upper', file: '/overlays/props/helmet.png', anchor: 'upper', label: 'Helmet', labelKey: 'look_overlay_helmet' },
    'military-helmet': { slot: 'upper', file: '/overlays/props/military-helmet.png', anchor: 'upper', label: 'Military helmet', labelKey: 'look_overlay_military_helmet' },
    'womans-hat': { slot: 'upper', file: '/overlays/props/womans-hat.png', anchor: 'upper', label: "Woman's hat", labelKey: 'look_overlay_womans_hat' },
    'male-gray-hair': { slot: 'upper', file: '/overlays/props/male-gray-hair.png', anchor: 'upper', label: 'Male gray hair', labelKey: 'look_overlay_male_gray_hair' },
    'female-gray-hair': { slot: 'upper', file: '/overlays/props/female-gray-hair.png', anchor: 'upper', label: 'Female gray hair', labelKey: 'look_overlay_female_gray_hair' },
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
    // A selected Twemoji starts in the middle of the frame and is dragged from
    // there; it is not tied to the body zones.
    emoji: { cx: 0.5, cy: 0.5 },
};

export const LOOK_DRAWERS = ['filter', 'lens', 'screen', 'upper', 'face', 'lower', 'emoji'];

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
    // A Twemoji is an object, not a face cover: start small and let the size
    // slider grow it.
    emoji: 0.3,
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
    if (isTwemojiSlug(slug)) {
        return slot === 'emoji' && !!twemojiCodeFromSlug(slug);
    }
    if (slot === 'emoji') return false;
    const entry = OVERLAY_LIBRARY[slug];
    return !!entry && entry.slot === slot;
}

export function emptySelection() {
    return { filterId: DEFAULT_FILTER_ID, lensId: DEFAULT_LENS_ID, screenId: DEFAULT_SCREEN_ID, slots: { face: null, upper: null, lower: null, emoji: null } };
}

export function emptyTuning() {
    return { face: { ...DEFAULT_TUNING }, upper: { ...DEFAULT_TUNING }, lower: { ...DEFAULT_TUNING }, emoji: { ...DEFAULT_TUNING } };
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
    const result = { face: null, upper: null, lower: null, emoji: null };
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
    if (isTwemojiSlug(slug)) return twemojiAssetUrl(twemojiCodeFromSlug(slug));
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

export const SNOWFLAKE_COUNT = 44;

/**
 * One snowflake at a given time: a small white dot that falls straight down
 * while swaying side to side — the cheap-cartoon wobble, not a diagonal. Same
 * determinism rule as the raindrops: a pure function of (index, timeMs).
 */
export function resolveSnowflake({ index, timeMs = 0, canvasWidth, canvasHeight }) {
    const t = timeMs / 1000;
    const size = hash01(index * 5 + 3);
    // Slow: a flake takes roughly 8–17 s to cross the frame.
    const speed = 0.06 + size * 0.1;
    const travel = ((hash01(index * 5 + 2) + t * speed) % 1.1);
    const wobblePhase = hash01(index * 5 + 4) * Math.PI * 2;
    const wobbleRate = 0.6 + hash01(index * 5 + 5) * 0.9;
    const wobble = Math.sin(t * wobbleRate + wobblePhase) * canvasWidth * (0.015 + size * 0.02);
    const baseX = (0.04 + hash01(index * 5 + 1) * 0.92) * canvasWidth;
    return {
        // Straight down, with a sway that never leaves the frame.
        x: clamp(baseX + wobble, 0, canvasWidth),
        y: travel * canvasHeight,
        radius: canvasWidth * (0.004 + size * 0.006),
        alpha: 0.35 + size * 0.3,
    };
}

// --- Sunny: a warm sun high in the frame, slow rays, drifting pollen. -------

export const SUN_RAY_COUNT = 9;
export const POLLEN_COUNT = 14;

/** Sun position as fractions of the frame: high and to the right, away from the
 * face zone (50% / 40%) and from the left rail. */
export const SUN_POSITION = { cx: 0.78, cy: 0.1 };

/** One pollen mote: a slow, twinkling drift above the frame's lower half. */
export function resolvePollenMote({ index, timeMs = 0, canvasWidth, canvasHeight }) {
    const t = timeMs / 1000;
    const size = hash01(index * 11 + 3);
    const speed = 0.008 + size * 0.014;               // frame-heights per second
    const travel = ((hash01(index * 11 + 2) + t * speed) % 1.05) - 0.02;
    const swayPhase = hash01(index * 11 + 4) * Math.PI * 2;
    const sway = Math.sin(t * (0.5 + size * 0.7) + swayPhase) * canvasWidth * 0.02;
    const baseX = (0.08 + hash01(index * 11 + 1) * 0.84) * canvasWidth;
    return {
        x: clamp(baseX + sway, 0, canvasWidth),
        y: canvasHeight * (0.9 - travel),              // drifts upward
        radius: canvasWidth * (0.002 + size * 0.003),
        // Twinkle: never fully off, never solid.
        alpha: 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * (1.6 + size * 2) + swayPhase)),
    };
}

/**
 * A sunny day: a warm glow around a high sun, slow rotating rays, and pollen
 * glints drifting up. All light, no props: the face zone stays readable.
 */
export function paintSunny({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    if (!ctx || !(canvasWidth > 0) || !(canvasHeight > 0)) return false;
    const t = timeMs / 1000;
    const sunX = canvasWidth * SUN_POSITION.cx;
    const sunY = canvasHeight * SUN_POSITION.cy;
    const radius = Math.max(canvasWidth, canvasHeight) * 0.5;
    try {
        ctx.save();
        // Warm bloom, screened so it reads as light rather than paint.
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 1;
        const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, radius);
        glow.addColorStop(0, 'rgba(255, 244, 196, 0.55)');
        glow.addColorStop(0.35, 'rgba(255, 224, 150, 0.16)');
        glow.addColorStop(1, 'rgba(255, 214, 130, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        // A small bright core so the light has a source.
        const core = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, canvasWidth * 0.09);
        core.addColorStop(0, 'rgba(255, 252, 236, 0.95)');
        core.addColorStop(1, 'rgba(255, 246, 214, 0)');
        ctx.fillStyle = core;
        ctx.fillRect(sunX - canvasWidth * 0.09, sunY - canvasWidth * 0.09, canvasWidth * 0.18, canvasWidth * 0.18);
        // Slow rays. Kept faint and short: they cross the frame, face included.
        ctx.fillStyle = 'rgba(255, 250, 226, 0.05)';
        const spin = t * 0.05;
        const rayLength = Math.max(canvasWidth, canvasHeight) * 0.45;
        for (let i = 0; i < SUN_RAY_COUNT; i++) {
            const angle = spin + (i / SUN_RAY_COUNT) * Math.PI * 2;
            const spread = 0.035;
            ctx.beginPath();
            ctx.moveTo(sunX, sunY);
            ctx.lineTo(sunX + Math.cos(angle - spread) * rayLength, sunY + Math.sin(angle - spread) * rayLength);
            ctx.lineTo(sunX + Math.cos(angle + spread) * rayLength, sunY + Math.sin(angle + spread) * rayLength);
            ctx.closePath();
            ctx.fill();
        }
        // Pollen glints.
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgb(255, 246, 214)';
        for (let i = 0; i < POLLEN_COUNT; i++) {
            const mote = resolvePollenMote({ index: i, timeMs, canvasWidth, canvasHeight });
            ctx.globalAlpha = mote.alpha;
            ctx.beginPath();
            ctx.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        return true;
    } catch (e) {
        return false;
    }
}

// --- Windy: gust streaks crossing the frame + leaves tumbling across. -------

export const GUST_COUNT = 9;
export const WIND_LEAF_COUNT = 12;
const LEAF_COLOURS = ['rgb(214, 168, 76)', 'rgb(196, 108, 52)', 'rgb(126, 158, 74)'];

/** One gust: a long, faint curve sweeping left → right at its own height. */
export function resolveGust({ index, timeMs = 0, canvasWidth, canvasHeight }) {
    const t = timeMs / 1000;
    const size = hash01(index * 7 + 3);
    const speed = 0.2 + size * 0.26;                  // frame-widths per second
    const travel = ((hash01(index * 7 + 2) + t * speed) % 1.35) - 0.15;
    return {
        x: travel * canvasWidth,
        y: (0.1 + hash01(index * 7 + 1) * 0.72) * canvasHeight,
        length: canvasWidth * (0.3 + size * 0.32),
        rise: (hash01(index * 7 + 4) - 0.5) * canvasHeight * 0.08,
        width: 2 + size * 2.5,
        alpha: 0.12 + size * 0.14,
    };
}

/** One leaf: tumbling left → right, faster than the gusts, bobbing as it goes. */
export function resolveWindLeaf({ index, timeMs = 0, canvasWidth, canvasHeight }) {
    const t = timeMs / 1000;
    const size = hash01(index * 9 + 3);
    const speed = 0.32 + size * 0.34;
    const travel = ((hash01(index * 9 + 2) + t * speed) % 1.4) - 0.2;
    const bob = Math.sin(t * (2 + size * 2.5) + hash01(index * 9 + 5) * Math.PI * 2) * canvasHeight * 0.025;
    return {
        x: travel * canvasWidth,
        y: (0.12 + hash01(index * 9 + 1) * 0.72) * canvasHeight + bob,
        rx: canvasWidth * (0.013 + size * 0.011),
        ry: canvasWidth * (0.006 + size * 0.006),
        rotation: t * (1.6 + size * 3) + hash01(index * 9 + 4) * Math.PI * 2,
        colour: LEAF_COLOURS[index % LEAF_COLOURS.length],
        alpha: 0.7 + size * 0.25,
    };
}

/** A windy day: faint gust curves crossing the frame with leaves tumbling after. */
export function paintWindy({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    if (!ctx || !(canvasWidth > 0) || !(canvasHeight > 0)) return false;
    try {
        ctx.save();
        for (let i = 0; i < GUST_COUNT; i++) {
            const gust = resolveGust({ index: i, timeMs, canvasWidth, canvasHeight });
            ctx.globalAlpha = gust.alpha;
            ctx.strokeStyle = 'rgb(255, 255, 255)';
            ctx.lineWidth = gust.width;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(gust.x, gust.y);
            ctx.quadraticCurveTo(gust.x + gust.length * 0.5, gust.y + gust.rise, gust.x + gust.length, gust.y);
            ctx.stroke();
        }
        for (let i = 0; i < WIND_LEAF_COUNT; i++) {
            const leaf = resolveWindLeaf({ index: i, timeMs, canvasWidth, canvasHeight });
            ctx.globalAlpha = leaf.alpha;
            ctx.fillStyle = leaf.colour;
            ctx.save();
            ctx.translate(leaf.x, leaf.y);
            ctx.rotate(leaf.rotation);
            ctx.beginPath();
            ctx.ellipse(0, 0, leaf.rx, leaf.ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Paint the chosen screen overlay over the whole frame. Returns the id painted
 * ('none' when there is nothing to draw or the painter threw), so the adapter
 * can log it.
 */
// ---------------------------------------------------------------------------
// Particle fields. Every "stuff floating in the air" overlay (rain, snow,
// confetti, petals, leaves, bubbles, embers, fireflies, hearts, bokeh) is the
// same deterministic drift with a different motion, shape and colour, so they
// share one resolver instead of ten near-copies.
// ---------------------------------------------------------------------------

/**
 * One drifting particle.
 *
 * `motion`: 'down' | 'up' | 'across'. `sway` is in fractions of the width.
 * Deterministic per (index, timeMs), so any frame can be reproduced exactly
 * and a test can assert movement.
 */
export function resolveDriftParticle({
    index,
    timeMs = 0,
    canvasWidth,
    canvasHeight,
    motion = 'down',
    speed = [0.2, 0.5],
    sway = [0, 0],
    size = [0.004, 0.009],
    alpha = [0.5, 0.9],
}) {
    const t = timeMs / 1000;
    const r = (n) => hash01(index * 13 + n);
    const travel = ((r(2) + t * (speed[0] + (speed[1] - speed[0]) * r(3))) % 1.2) - 0.1;
    const swayAmp = (sway[0] + (sway[1] - sway[0]) * r(5)) * canvasWidth;
    const swayValue = swayAmp ? Math.sin(t * (0.8 + r(4)) + r(1) * Math.PI * 2) * swayAmp : 0;
    const column = (0.05 + r(1) * 0.9) * canvasWidth;
    let x;
    let y;
    if (motion === 'up') {
        x = column + swayValue;
        y = canvasHeight * (1.06 - travel);
    } else if (motion === 'across') {
        x = (travel * 1.2 - 0.1) * canvasWidth;
        y = (0.08 + r(1) * 0.8) * canvasHeight + swayValue;
    } else {
        x = column + swayValue;
        y = travel * canvasHeight;
    }
    return {
        x: clamp(x, -canvasWidth * 0.05, canvasWidth * 1.05),
        y: clamp(y, -canvasHeight * 0.1, canvasHeight * 1.1),
        size: canvasWidth * (size[0] + (size[1] - size[0]) * r(4)),
        alpha: alpha[0] + (alpha[1] - alpha[0]) * r(5),
        rotation: t * (0.4 + r(4) * 1.8) + r(1) * Math.PI * 2,
    };
}

/** Save/restore guard shared by every screen painter. */
function paintGuarded(ctx, draw) {
    if (!ctx) return false;
    try {
        ctx.save();
        draw();
        ctx.restore();
        return true;
    } catch (e) {
        return false;
    }
}

export const CONFETTI_COUNT = 34;
const CONFETTI_COLOURS = ['rgb(255, 86, 86)', 'rgb(255, 196, 64)', 'rgb(86, 200, 255)', 'rgb(126, 224, 122)', 'rgb(255, 126, 214)'];

/** Confetti: coloured rectangles tumbling and drifting down. */
export function paintConfetti({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        for (let i = 0; i < CONFETTI_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                speed: [0.22, 0.5], sway: [0.01, 0.05], size: [0.01, 0.02], alpha: [0.7, 0.95],
            });
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
            ctx.fillRect(-p.size * 0.35, -p.size * 0.6, p.size * 0.7, p.size * 1.2);
            ctx.restore();
        }
    });
}

export const LEAF_COUNT = 10;

/** Falling leaves: flat ellipses rotating as they sway down. */
export function paintLeaves({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        for (let i = 0; i < LEAF_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                speed: [0.1, 0.2], sway: [0.03, 0.07], size: [0.012, 0.02], alpha: [0.65, 0.9],
            });
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = LEAF_COLOURS[i % LEAF_COLOURS.length];
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    });
}

export const PETAL_COUNT = 16;
const PETAL_COLOURS = ['rgb(255, 183, 210)', 'rgb(255, 148, 184)', 'rgb(255, 210, 226)'];

/** Petals: small pink ellipses, slower and lighter than leaves. */
export function paintPetals({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        for (let i = 0; i < PETAL_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                speed: [0.06, 0.14], sway: [0.02, 0.06], size: [0.006, 0.011], alpha: [0.5, 0.8],
            });
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = PETAL_COLOURS[i % PETAL_COLOURS.length];
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    });
}

export const BUBBLE_COUNT = 12;

/** Bubbles: translucent rings with a highlight, rising and wobbling. */
export function paintBubbles({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        for (let i = 0; i < BUBBLE_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                motion: 'up', speed: [0.05, 0.12], sway: [0.015, 0.05], size: [0.012, 0.03], alpha: [0.3, 0.6],
            });
            ctx.globalAlpha = p.alpha;
            ctx.strokeStyle = 'rgb(220, 245, 255)';
            ctx.lineWidth = Math.max(1, p.size * 0.1);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = Math.min(1, p.alpha + 0.2);
            ctx.fillStyle = 'rgb(255, 255, 255)';
            ctx.beginPath();
            ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, Math.max(1, p.size * 0.16), 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

export const EMBER_COUNT = 18;
const EMBER_COLOURS = ['rgb(255, 168, 72)', 'rgb(255, 120, 48)', 'rgb(255, 204, 110)'];

/** Embers: warm sparks drifting up and flickering. */
export function paintEmbers({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        const t = timeMs / 1000;
        for (let i = 0; i < EMBER_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                motion: 'up', speed: [0.08, 0.2], sway: [0.008, 0.03], size: [0.002, 0.005], alpha: [0.5, 0.9],
            });
            // Flicker: each spark breathes on its own clock.
            const flicker = 0.55 + 0.45 * Math.sin(t * (5 + (i % 7)) + i);
            ctx.globalAlpha = p.alpha * flicker;
            ctx.fillStyle = EMBER_COLOURS[i % EMBER_COLOURS.length];
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

export const FIREFLY_COUNT = 12;

/** Fireflies: soft warm dots that pulse, wandering slowly upward. */
export function paintFireflies({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        const t = timeMs / 1000;
        for (let i = 0; i < FIREFLY_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                motion: 'up', speed: [0.01, 0.03], sway: [0.04, 0.12], size: [0.0025, 0.005], alpha: [0.4, 0.85],
            });
            const pulse = 0.5 + 0.5 * Math.sin(t * (1.4 + (i % 5) * 0.4) + i);
            // Halo, then the bright body.
            ctx.globalAlpha = p.alpha * 0.25 * pulse;
            ctx.fillStyle = 'rgb(255, 236, 150)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 3.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = p.alpha * pulse;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

export const HEART_COUNT = 8;
const HEART_COLOURS = ['rgb(255, 96, 140)', 'rgb(255, 140, 170)', 'rgb(255, 120, 120)'];

/** Hearts: translucent hearts floating up. */
export function paintHearts({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        for (let i = 0; i < HEART_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                motion: 'up', speed: [0.03, 0.07], sway: [0.01, 0.04], size: [0.012, 0.022], alpha: [0.45, 0.75],
            });
            const s = p.size;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.sin(p.rotation) * 0.25);
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = HEART_COLOURS[i % HEART_COLOURS.length];
            ctx.beginPath();
            ctx.moveTo(0, s * 0.35);
            ctx.bezierCurveTo(-s * 1.1, -s * 0.4, -s * 0.5, -s * 1.05, 0, -s * 0.45);
            ctx.bezierCurveTo(s * 0.5, -s * 1.05, s * 1.1, -s * 0.4, 0, s * 0.35);
            ctx.fill();
            ctx.restore();
        }
    });
}

export const STAR_COUNT = 64;

/** Starfield: fixed dots that twinkle, plus a few four-point sparkles. */
export function paintStars({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        const t = timeMs / 1000;
        for (let i = 0; i < STAR_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                speed: [0, 0], sway: [0, 0], size: [0.0012, 0.0028], alpha: [0.4, 0.95],
            });
            const twinkle = 0.45 + 0.55 * Math.sin(t * (2 + (i % 6)) + i);
            ctx.globalAlpha = p.alpha * twinkle;
            ctx.fillStyle = 'rgb(255, 255, 255)';
            if (i % 16 === 0) {
                // A cross-shaped sparkle for the brightest few.
                const s = p.size * 4;
                ctx.fillRect(p.x - s, p.y - s * 0.12, s * 2, s * 0.24);
                ctx.fillRect(p.x - s * 0.12, p.y - s, s * 0.24, s * 2);
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });
}

export const SHOOTING_STAR_PERIOD = 5;

/** The shooting star: a scheduled streak that only exists for part of a cycle. */
export function resolveShootingStar({ timeMs = 0, canvasWidth, canvasHeight }) {
    const cycle = (timeMs / 1000 % SHOOTING_STAR_PERIOD) / SHOOTING_STAR_PERIOD;
    const travel = cycle * 1.5 - 0.25;
    return {
        headX: travel * canvasWidth,
        headY: (0.05 + travel * 0.3) * canvasHeight,
        length: canvasWidth * 0.55,
        // Present for most of the cycle (a star that is missing for half of it
        // reads as "broken"), fading quickly in and out at its ends.
        alpha: cycle < 0.04 ? cycle / 0.04 : cycle > 0.75 ? Math.max(0, (0.85 - cycle) / 0.1) : 1,
        angle: Math.atan2(canvasHeight * 0.3, canvasWidth),
    };
}

export function paintShootingStar({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        const star = resolveShootingStar({ timeMs, canvasWidth, canvasHeight });
        if (star.alpha <= 0) return;
        // A tapered streak: 18 segments, fading and thinning toward the tail,
        // with a soft halo behind the head so it reads at a glance.
        ctx.fillStyle = 'rgb(255, 250, 232)';
        ctx.globalAlpha = star.alpha * 0.35;
        ctx.beginPath();
        ctx.arc(star.headX, star.headY, 22, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 18; i++) {
            const k = i / 18;
            const d = star.length * k;
            const x = star.headX - Math.cos(star.angle) * d;
            const y = star.headY - Math.sin(star.angle) * d;
            ctx.globalAlpha = star.alpha * (1 - k);
            ctx.fillStyle = 'rgb(255, 252, 240)';
            const size = 10 * (1 - k) + 2;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

export const VHS_LINE_COUNT = 200;
export const VHS_DROPOUTS = 24;

/**
 * VHS: many THIN scanlines (thick bars read as Venetian blinds), a bright band
 * rolling down with a sharp leading edge, and tracking dropouts smeared along
 * it — the three things that actually say "tape".
 */
export function paintVhs({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        const t = timeMs / 1000;
        const step = canvasHeight / VHS_LINE_COUNT;
        ctx.fillStyle = 'rgb(0, 0, 0)';
        ctx.globalAlpha = 0.07;
        for (let i = 0; i < VHS_LINE_COUNT; i++) {
            ctx.fillRect(0, i * step, canvasWidth, 1);
        }
        const bandY = ((t * 0.22) % 1.25 - 0.15) * canvasHeight;
        const bandHeight = canvasHeight * 0.07;
        const band = ctx.createLinearGradient(0, bandY, 0, bandY + bandHeight);
        band.addColorStop(0, 'rgba(255,255,255,0)');
        band.addColorStop(0.75, 'rgba(255,255,255,0.06)');
        band.addColorStop(0.96, 'rgba(255,255,255,0.22)');
        band.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = band;
        ctx.fillRect(0, bandY, canvasWidth, bandHeight);
        // Dropouts: short bright smears riding the band, re-seeded as it moves.
        const bucket = Math.floor(timeMs / 70);
        ctx.fillStyle = 'rgb(255, 255, 255)';
        for (let i = 0; i < VHS_DROPOUTS; i++) {
            const x = hash01(bucket * 17 + i * 3 + 1) * canvasWidth;
            const y = bandY + hash01(bucket * 17 + i * 3 + 2) * bandHeight;
            const w = canvasWidth * (0.01 + hash01(bucket * 17 + i * 3 + 3) * 0.05);
            ctx.globalAlpha = 0.1 + hash01(bucket * 17 + i * 3 + 4) * 0.18;
            ctx.fillRect(x, y, w, 1.5);
        }
    });
}

export const GRAIN_SPECKS = 900;
/** Grain is re-seeded on a 45 ms bucket so it boils like film, not like noise. */
export const GRAIN_BUCKET_MS = 45;

/**
 * Procedural film grain: light AND dark specks, re-seeded on a bucket so it
 * boils like film. Grain is contrast, not just sparkle, which is why the dark
 * third matters for being visible at all.
 */
export function paintGrain({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        const bucket = Math.floor(timeMs / GRAIN_BUCKET_MS);
        for (let i = 0; i < GRAIN_SPECKS; i++) {
            const x = hash01(bucket * 31 + i * 3 + 1) * canvasWidth;
            const y = hash01(bucket * 31 + i * 3 + 2) * canvasHeight;
            const seed = hash01(bucket * 31 + i * 3 + 3);
            const dark = i % 3 === 0;
            ctx.fillStyle = dark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
            ctx.globalAlpha = dark ? 0.1 + seed * 0.2 : 0.12 + seed * 0.24;
            // 2–4.5 px: a 1 px speck is averaged away when the 720p canvas is
            // shown in a ~390 px wide preview.
            const size = 2 + seed * 2.5;
            ctx.fillRect(x, y, size, size);
        }
    });
}

export const BOKEH_COUNT = 14;

/** Bokeh: big, soft, translucent discs drifting up. */
export function paintBokeh({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        for (let i = 0; i < BOKEH_COUNT; i++) {
            const p = resolveDriftParticle({
                index: i, timeMs, canvasWidth, canvasHeight,
                motion: 'up', speed: [0.01, 0.03], sway: [0.01, 0.04], size: [0.035, 0.09], alpha: [0.1, 0.32],
            });
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
            gradient.addColorStop(0, 'rgba(255, 244, 214, 0.95)');
            gradient.addColorStop(0.72, 'rgba(255, 240, 205, 0.5)');
            // A defined rim is what makes a disc read as bokeh rather than a blob.
            gradient.addColorStop(0.9, 'rgba(255, 250, 230, 0.95)');
            gradient.addColorStop(1, 'rgba(255, 236, 196, 0)');
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

export function paintRaindrops({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
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
    });
}

export function paintSnowfall({ ctx, canvasWidth, canvasHeight, timeMs = 0 }) {
    return paintGuarded(ctx, () => {
        ctx.fillStyle = 'rgb(255, 255, 255)';
        for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
            const flake = resolveSnowflake({ index: i, timeMs, canvasWidth, canvasHeight });
            ctx.globalAlpha = flake.alpha;
            ctx.beginPath();
            ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

const SCREEN_PAINTERS = {
    raindrops: paintRaindrops,
    snowfall: paintSnowfall,
    sunny: paintSunny,
    windy: paintWindy,
    confetti: paintConfetti,
    leaves: paintLeaves,
    petals: paintPetals,
    bubbles: paintBubbles,
    embers: paintEmbers,
    fireflies: paintFireflies,
    hearts: paintHearts,
    stars: paintStars,
    shootingstar: paintShootingStar,
    vhs: paintVhs,
    grain: paintGrain,
    bokeh: paintBokeh,
};

/**
 * Paint the chosen screen overlay over the whole frame. Returns the id painted
 * ('none' when there is nothing to draw or the painter threw), so the adapter
 * can log it.
 */
export function paintScreenOverlay({ ctx, canvasWidth, canvasHeight, screenId, timeMs = 0 }) {
    const id = resolveScreenId(screenId);
    if (!ctx || id === 'none') return 'none';
    if (!(canvasWidth > 0) || !(canvasHeight > 0)) return 'none';
    const painter = SCREEN_PAINTERS[id];
    if (!painter) return 'none';
    return painter({ ctx, canvasWidth, canvasHeight, timeMs }) ? id : 'none';
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
    maskCanvas = null,
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
            // Close-up gets a feathered mask of its sharp oval; every other lens
            // treats the whole frame.
            hole: lensPreset.hole ? resolveCloseUpHole(canvasWidth, canvasHeight) : null,
            maskCanvas: lensPreset.hole ? maskCanvas : null,
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

