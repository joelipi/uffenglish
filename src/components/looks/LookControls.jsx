import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import {
    FILTER_PRESETS,
    LENS_PRESETS,
    SCREEN_PRESETS,
    OVERLAY_LIBRARY,
    overlaySlugsForSlot,
    assetFileForSlug,
    resolveFilterPreset,
    resolveLensPreset,
    resolveScreenPreset,
    DEFAULT_FILTER_ID,
    DEFAULT_LENS_ID,
    DEFAULT_SCREEN_ID,
    NONE_SWATCH,
    MIN_SCALE,
    MAX_SCALE,
} from '../../modules/looks/recording-looks-logic.js';

// Look controls for the friendClosedResponse preview screen (stories/092).
//
// Vertically stacked along the left edge between the top header blur and the
// bottom subtitle/microphone bands. Each item is a compact rail button that
// folds out horizontally only when tapped, keeping the face, subtitles, and
// microphone button unobstructed.

// iOS draws a white rounded bezel on a bare <button> unless the UA appearance
// is reset (stories/092: chrome I removed from the chips exposed exactly that
// bezel). Inline, not only via `.look-tap`, so neither a stale stylesheet nor a
// UA rule can bring it back.
const UA_RESET = {
    WebkitAppearance: 'none',
    appearance: 'none',
    WebkitTapHighlightColor: 'transparent',
};

const SLOT_RAIL_META = [
    // A cloud (a thing that sits above a head), not a magic wand.
    { slot: 'upper', label: 'Top', icon: 'bi-cloud-fill' },
    { slot: 'face', label: 'Face', icon: 'bi-emoji-smile' },
    { slot: 'lower', label: 'Bottom', icon: 'bi-layers' },
];

// iOS Safari keeps its native focus ring on the tapped <button> until focus
// moves elsewhere, so an option the learner tapped and then abandoned still
// looked ringed (stories/092). The applied state is the green ring, so a
// pointer activation releases focus; a keyboard activation (detail 0) keeps it
// so tab navigation still works.
function releaseFocusAfterPointerTap(event) {
    if (event?.detail > 0) event.currentTarget.blur();
}

// One radio-group strip, reused by the filter picker and the lens-effect
// picker: the two are independent choices, so they share the chrome, not the
// state.
function ChoiceStrip({ testidPrefix, presets, selectedId, onPick }) {
    return (
        <div className="look-strip" data-testid={`${testidPrefix}-strip`} style={styles.foldoutStrip}>
            {presets.map((preset) => {
                const selected = preset.id === selectedId;
                return (
                    <button
                        key={preset.id}
                        type="button"
                        className="look-tap"
                        data-testid={`${testidPrefix}-${preset.id}`}
                        aria-pressed={selected}
                        onClick={(e) => {
                            releaseFocusAfterPointerTap(e);
                            onPick(preset.id);
                        }}
                        style={{
                            ...styles.chip,
                            ...(selected ? styles.chipSelected : null),
                        }}
                    >
                        <span style={styles.swatchWrap}>
                            <span style={{ ...styles.swatch, background: preset.swatch }} />
                            {selected && <i className="bi bi-check-circle-fill" style={styles.chipCheck}></i>}
                        </span>
                        <span style={{ ...styles.chipLabel, ...(selected ? styles.chipLabelSelected : null) }}>
                            {preset.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function FilterStrip() {
    const filterId = useStore(appStore, (state) => state.lookSelection.filterId);
    return (
        <ChoiceStrip
            testidPrefix="look-filter"
            presets={FILTER_PRESETS}
            selectedId={filterId}
            onPick={(id) => appStore.getState().toggleLookFilter(id)}
        />
    );
}

function LensStrip() {
    const lensId = useStore(appStore, (state) => state.lookSelection.lensId);
    return (
        <ChoiceStrip
            testidPrefix="look-lens"
            presets={LENS_PRESETS}
            selectedId={lensId}
            onPick={(id) => appStore.getState().toggleLookLens(id)}
        />
    );
}

function ScreenStrip() {
    const screenId = useStore(appStore, (state) => state.lookSelection.screenId);
    return (
        <ChoiceStrip
            testidPrefix="look-screen"
            presets={SCREEN_PRESETS}
            selectedId={screenId}
            onPick={(id) => appStore.getState().toggleLookScreen(id)}
        />
    );
}

function OverlayFoldout({ slot }) {
    const slugForSlot = useStore(appStore, (state) => state.lookSelection.slots[slot]);
    const scale = useStore(appStore, (state) => state.lookTuning[slot].scale);
    const slugs = overlaySlugsForSlot(slot);

    return (
        <div style={styles.foldoutColumn} data-testid={`look-slot-row-${slot}`}>
            <div style={styles.trayStrip}>
                <button
                    type="button"
                    className="look-tap"
                    data-testid={`look-slot-${slot}-none`}
                    aria-pressed={!slugForSlot}
                    onClick={(e) => {
                        releaseFocusAfterPointerTap(e);
                        appStore.getState().setLookSlot(slot, null);
                    }}
                    style={{ ...styles.trayChip, ...(!slugForSlot ? styles.chipSelected : null) }}
                >
                    <span style={{ ...styles.swatch, background: NONE_SWATCH }} />
                    <span style={styles.trayChipLabel}>None</span>
                </button>
                {slugs.map((slug) => {
                    const selected = slugForSlot === slug;
                    return (
                        <button
                            key={slug}
                            type="button"
                            className="look-tap"
                            data-testid={`look-slot-${slot}-${slug}`}
                            aria-pressed={selected}
                            onClick={(e) => {
                                releaseFocusAfterPointerTap(e);
                                appStore.getState().setLookSlot(slot, slug);
                                appStore.getState().setLookActiveSlot(slot);
                            }}
                            style={{ ...styles.trayChip, ...(selected ? styles.chipSelected : null) }}
                        >
                            <img src={assetFileForSlug(slug)} alt="" draggable={false} style={styles.thumb} />
                            <span style={styles.trayChipLabel}>{OVERLAY_LIBRARY[slug].label}</span>
                        </button>
                    );
                })}
            </div>
            {slugForSlot && (
                <div style={styles.sliderRow} data-testid="look-size-slider">
                    <span style={styles.sliderLabel}>Size</span>
                    <input
                        type="range"
                        min={MIN_SCALE}
                        max={MAX_SCALE}
                        step={0.05}
                        value={scale}
                        onChange={(e) => appStore.getState().setLookTuning(slot, { scale: Number(e.target.value) })}
                        style={styles.slider}
                    />
                    <button
                        type="button"
                        className="look-tap"
                        onClick={() => appStore.getState().setLookTuning(slot, { dx: 0, dy: 0, scale: 1 })}
                        style={styles.resetButton}
                        data-testid="look-size-reset"
                    >
                        Reset
                    </button>
                </div>
            )}
        </div>
    );
}

export default function LookControls() {
    const awaiting = useStore(appStore, (state) => state.awaitingRecordingStart);
    const openDrawer = useStore(appStore, (state) => state.lookOpenDrawer);
    const filterId = useStore(appStore, (state) => state.lookSelection.filterId);
    const lensId = useStore(appStore, (state) => state.lookSelection.lensId);
    const screenId = useStore(appStore, (state) => state.lookSelection.screenId);
    const slots = useStore(appStore, (state) => state.lookSelection.slots);
    const activeSlot = useStore(appStore, (state) => state.lookActiveSlot);

    if (!awaiting) return null;

    const currentPreset = resolveFilterPreset(filterId);
    const filterOpen = openDrawer === 'filter';
    const filterActive = filterId !== DEFAULT_FILTER_ID;
    const currentLens = resolveLensPreset(lensId);
    const lensOpen = openDrawer === 'lens';
    const lensActive = lensId !== DEFAULT_LENS_ID;
    const currentScreen = resolveScreenPreset(screenId);
    const screenOpen = openDrawer === 'screen';
    const screenActive = screenId !== DEFAULT_SCREEN_ID;

    return (
        <div style={styles.rail} data-testid="look-controls" onPointerDown={(e) => e.stopPropagation()}>
            <div style={styles.railRow}>
                <button
                    type="button"
                    className="look-tap"
                    data-testid="look-drawer-toggle-filter"
                    aria-expanded={filterOpen}
                    onClick={(e) => {
                        releaseFocusAfterPointerTap(e);
                        appStore.getState().toggleLookOpenDrawer('filter');
                    }}
                    style={{
                        ...styles.railBtn,
                        ...(filterOpen ? styles.railBtnOpen : filterActive ? styles.railBtnActive : null),
                    }}
                >
                    <span style={{ ...styles.railSwatch, background: currentPreset.swatch }} />
                    <span style={styles.railLabel}>Filter</span>
                </button>
                {filterOpen && <FilterStrip />}
            </div>

            <div style={styles.railRow}>
                <button
                    type="button"
                    className="look-tap"
                    data-testid="look-drawer-toggle-lens"
                    aria-expanded={lensOpen}
                    onClick={(e) => {
                        releaseFocusAfterPointerTap(e);
                        appStore.getState().toggleLookOpenDrawer('lens');
                    }}
                    style={{
                        ...styles.railBtn,
                        ...(lensOpen ? styles.railBtnOpen : lensActive ? styles.railBtnActive : null),
                    }}
                >
                    <span style={{ ...styles.railSwatch, background: currentLens.swatch }} />
                    <span style={styles.railLabel}>Lens</span>
                </button>
                {lensOpen && <LensStrip />}
            </div>

            <div style={styles.railRow}>
                <button
                    type="button"
                    className="look-tap"
                    data-testid="look-drawer-toggle-screen"
                    aria-expanded={screenOpen}
                    onClick={(e) => {
                        releaseFocusAfterPointerTap(e);
                        appStore.getState().toggleLookOpenDrawer('screen');
                    }}
                    style={{
                        ...styles.railBtn,
                        ...(screenOpen ? styles.railBtnOpen : screenActive ? styles.railBtnActive : null),
                    }}
                >
                    <span style={{ ...styles.railSwatch, background: currentScreen.swatch }} />
                    <span style={styles.railLabel}>Screen</span>
                </button>
                {screenOpen && <ScreenStrip />}
            </div>

            {SLOT_RAIL_META.map(({ slot, label, icon }) => {
                const isOpen = openDrawer === slot;
                const slug = slots[slot];
                const isActive = activeSlot === slot && !!slug;
                return (
                    <div key={slot} style={styles.railRow}>
                        <button
                            type="button"
                            className="look-tap"
                            data-testid={`look-drawer-toggle-${slot}`}
                            aria-expanded={isOpen}
                            onClick={(e) => {
                                releaseFocusAfterPointerTap(e);
                                appStore.getState().toggleLookOpenDrawer(slot);
                            }}
                            style={{
                                ...styles.railBtn,
                                ...(isOpen ? styles.railBtnOpen : isActive ? styles.railBtnActive : null),
                            }}
                        >
                            {slug ? (
                                <img src={assetFileForSlug(slug)} alt="" draggable={false} style={styles.railThumb} />
                            ) : (
                                <i className={`bi ${icon}`} style={styles.railIcon}></i>
                            )}
                            <span style={styles.railLabel}>{label}</span>
                        </button>
                        {isOpen && <OverlayFoldout slot={slot} />}
                    </div>
                );
            })}
        </div>
    );
}

const styles = {
    rail: {
        position: 'absolute',
        left: 12,
        // The pinned tray opens at the rail top, so the rail top IS the tray
        // top: just under the header blur (~0-15%), with the whole menu ending
        // well above the mic band on every screen.
        top: '25%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 80,
        pointerEvents: 'auto',
        maxWidth: 'calc(100% - 24px)',
    },
    railRow: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
    },
    railBtn: {
        width: 48,
        height: 48,
        flexShrink: 0,
        borderRadius: 14,
        // No white chrome: on the picker the only outline anywhere is the green
        // "this is applied" ring, otherwise a previous selection kept looking
        // active (stories/092 review).
        border: '1.5px solid transparent',
        background: 'rgba(15, 17, 24, 0.72)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: 4,
        boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
        ...UA_RESET,
    },
    // Open = a lifted fill, applied = the green ring. Two separate signals, so
    // an open drawer never competes with a selection for the same border.
    railBtnOpen: {
        background: 'rgba(58, 64, 78, 0.95)',
    },
    railBtnActive: {
        borderColor: '#4ade80',
    },
    railSwatch: {
        width: 20,
        height: 20,
        borderRadius: '50%',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
        display: 'block',
    },
    railThumb: {
        width: 22,
        height: 22,
        objectFit: 'contain',
        // Pointer-transparent so a swipe starting on the thumbnail scrolls the
        // strip (or taps the button) instead of starting an image drag.
        pointerEvents: 'none',
        userSelect: 'none',
    },
    railIcon: {
        fontSize: 18,
        lineHeight: 1,
    },
    railLabel: {
        fontSize: 9,
        lineHeight: 1,
        letterSpacing: '0.02em',
        color: 'rgba(255,255,255,0.88)',
    },
    // The prop rows (Face/Top/Bottom) are a VERTICAL tray pinned to the TOP of
    // the rail — not dangling from their own button. A tray that opens at the
    // Face button starts mid-screen and its bottom (plus the Size slider under
    // it) lands behind the mic button; pinned to the rail top (~25% of the
    // viewport) the whole menu stays clear of the mic band on every screen.
    // Only one drawer is ever open, so the pinned trays never overlap.
    foldoutColumn: {
        position: 'absolute',
        top: 0,
        left: 56,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'rgba(15, 17, 24, 0.84)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 14,
        padding: '6px 8px',
        maxWidth: 'calc(100vw - 84px)',
        boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
    },
    foldoutStrip: {
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        // The prop rows (Face/Top/Bottom) are the only strips whose chips hold
        // <img> thumbnails, and on iOS a swipe that starts on an image goes to
        // image interaction instead of the scroller — which is why those rows
        // would not scroll while the swatch-only rows did. Momentum scrolling
        // plus an explicit pan gesture (in case an ancestor sets touch-action:
        // none for drag-to-move) plus pointer-transparent thumbnails keep every
        // row scrollable (stories/092).
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-x pan-y',
        // Composited layer: on iOS a non-composited overflow box can refuse
        // touch scrolling outright while the identical box scrolls on desktop.
        transform: 'translateZ(0)',
        background: 'rgba(15, 17, 24, 0.84)',
        borderRadius: 12,
        padding: '4px 6px',
        maxWidth: 'calc(100vw - 84px)',
        // Proximity, not mandatory: on iOS a mandatory snap can eat a swipe
        // and fling the strip back to where it started, which reads as "does
        // not scroll". Proximity keeps the paging feel without ever
        // force-returning the strip (stories/092).
        scrollSnapType: 'x proximity',
    },
    // A sticker-sheet GRID, not a list and not a horizontal strip: one row per
    // overlay cannot hold the dozens of faces coming, and a horizontal strip
    // can only show its last items by scrolling to a far snap point (which on
    // iOS reads as stuck partway). Three columns of compact cells scroll on
    // the platform's most robust gesture and fit many more items.
    trayStrip: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
        overflowY: 'auto',
        overflowX: 'hidden',
        // Fixed pixels, not vh: the tray sits between the header blur and the
        // mic band, and vh units shift under iOS Safari's collapsing chrome.
        // Tray (300) + Size slider below it stays above the mic on a 667px
        // phone with room to spare.
        maxHeight: 300,
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
        transform: 'translateZ(0)',
        background: 'rgba(15, 17, 24, 0.84)',
        borderRadius: 12,
        padding: '6px',
        // Explicit width, not just maxWidth: an absolutely positioned box
        // shrink-wraps to its (narrow) containing block, which would collapse
        // the 1fr columns to slivers.
        width: 'calc(100vw - 84px)',
        maxWidth: 'calc(100vw - 84px)',
    },
    trayChip: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 3,
        minWidth: 0,
        padding: '6px 4px',
        borderRadius: 10,
        border: '1.5px solid transparent',
        background: 'transparent',
        color: '#fff',
    },
    trayChipLabel: {
        fontSize: 10,
        lineHeight: 1.2,
        textAlign: 'center',
    },
    chip: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // Size to the content, never shrink: a squeezed chip lets its label
        // spill over its neighbours (and over their touch targets), and the
        // strip's snap stops end up narrower than a finger.
        flex: '0 0 auto',
        gap: 3,
        minWidth: 48,
        padding: '4px 5px',
        borderRadius: 10,
        border: '1.5px solid transparent',
        // Transparent until chosen: the applied chip is the only one with a
        // surface and an outline (stories/092).
        background: 'transparent',
        color: '#fff',
        scrollSnapAlign: 'start',
        ...UA_RESET,
    },
    chipSelected: {
        borderColor: '#4ade80',
        background: 'rgba(74,222,128,0.22)',
        boxShadow: '0 0 10px rgba(74,222,128,0.45)',
    },
    swatchWrap: {
        position: 'relative',
        display: 'block',
        lineHeight: 0,
    },
    // The tick is what makes the single applied filter unmistakable, so an
    // unselected chip can stay flat instead of needing a box of its own.
    chipCheck: {
        position: 'absolute',
        right: -5,
        bottom: -3,
        fontSize: 13,
        lineHeight: 1,
        color: '#4ade80',
        background: '#0f1118',
        borderRadius: '50%',
    },
    swatch: {
        width: 30,
        height: 30,
        borderRadius: 6,
        display: 'block',
        // A dark inset edge instead of a white ring: a light ring on every
        // swatch read as "selected" on the chips that were not (stories/092).
        boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
    },
    thumb: {
        width: 30,
        height: 30,
        objectFit: 'contain',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.35)',
        // Pointer-transparent so a swipe starting on the thumbnail scrolls the
        // strip (or taps the button) instead of starting an image drag.
        pointerEvents: 'none',
        userSelect: 'none',
    },
    chipLabel: {
        fontSize: 9,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
    },
    chipLabelSelected: {
        color: '#bbf7d0',
        fontWeight: 600,
    },
    sliderRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 4px 2px',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 10,
    },
    sliderLabel: { minWidth: 26 },
    slider: { flex: 1, minWidth: 90 },
    resetButton: {
        border: '1px solid rgba(255,255,255,0.4)',
        background: 'transparent',
        color: '#fff',
        borderRadius: 6,
        fontSize: 10,
        padding: '2px 6px',
        ...UA_RESET,
    },
};
