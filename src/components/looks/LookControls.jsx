import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import {
    FILTER_PRESETS,
    OVERLAY_LIBRARY,
    overlaySlugsForSlot,
    assetFileForSlug,
    resolveFilterPreset,
    MIN_SCALE,
    MAX_SCALE,
} from '../../modules/looks/recording-looks-logic.js';

// Look controls for the friendClosedResponse preview screen (stories/092).
//
// Vertically stacked along the left edge between the top header blur and the
// bottom subtitle/microphone bands. Each item is a compact rail button that
// folds out horizontally only when tapped, keeping the face, subtitles, and
// microphone button unobstructed.

const SLOT_RAIL_META = [
    { slot: 'upper', label: 'Top', icon: 'bi-magic' },
    { slot: 'face', label: 'Face', icon: 'bi-emoji-smile' },
    { slot: 'lower', label: 'Bottom', icon: 'bi-layers' },
];

function FilterStrip() {
    const filterId = useStore(appStore, (state) => state.lookSelection.filterId);
    return (
        <div className="look-strip" data-testid="look-filter-strip" style={styles.foldoutStrip}>
            {FILTER_PRESETS.map((preset) => {
                const selected = preset.id === filterId;
                return (
                    <button
                        key={preset.id}
                        type="button"
                        data-testid={`look-filter-${preset.id}`}
                        aria-pressed={selected}
                        onClick={() => appStore.getState().setLookFilter(preset.id)}
                        style={{
                            ...styles.chip,
                            ...(selected ? styles.chipSelected : null),
                        }}
                    >
                        <span style={{ ...styles.swatch, background: preset.swatch }} />
                        <span style={styles.chipLabel}>{preset.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

function OverlayFoldout({ slot }) {
    const slugForSlot = useStore(appStore, (state) => state.lookSelection.slots[slot]);
    const scale = useStore(appStore, (state) => state.lookTuning[slot].scale);
    const slugs = overlaySlugsForSlot(slot);

    return (
        <div style={styles.foldoutColumn} data-testid={`look-slot-row-${slot}`}>
            <div style={styles.foldoutStrip}>
                <button
                    type="button"
                    data-testid={`look-slot-${slot}-none`}
                    aria-pressed={!slugForSlot}
                    onClick={() => appStore.getState().setLookSlot(slot, null)}
                    style={{ ...styles.chip, ...(!slugForSlot ? styles.chipSelected : null) }}
                >
                    <span style={{ ...styles.swatch, background: 'repeating-linear-gradient(45deg,#333,#333 5px,#444 5px,#444 10px)' }} />
                    <span style={styles.chipLabel}>None</span>
                </button>
                {slugs.map((slug) => {
                    const selected = slugForSlot === slug;
                    return (
                        <button
                            key={slug}
                            type="button"
                            data-testid={`look-slot-${slot}-${slug}`}
                            aria-pressed={selected}
                            onClick={() => {
                                appStore.getState().setLookSlot(slot, slug);
                                appStore.getState().setLookActiveSlot(slot);
                            }}
                            style={{ ...styles.chip, ...(selected ? styles.chipSelected : null) }}
                        >
                            <img src={assetFileForSlug(slug)} alt="" style={styles.thumb} />
                            <span style={styles.chipLabel}>{OVERLAY_LIBRARY[slug].label}</span>
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
    const slots = useStore(appStore, (state) => state.lookSelection.slots);
    const activeSlot = useStore(appStore, (state) => state.lookActiveSlot);

    if (!awaiting) return null;

    const currentPreset = resolveFilterPreset(filterId);
    const filterOpen = openDrawer === 'filter';

    return (
        <div style={styles.rail} data-testid="look-controls" onPointerDown={(e) => e.stopPropagation()}>
            <div style={styles.railRow}>
                <button
                    type="button"
                    data-testid="look-drawer-toggle-filter"
                    aria-expanded={filterOpen}
                    onClick={() => appStore.getState().toggleLookOpenDrawer('filter')}
                    style={{
                        ...styles.railBtn,
                        ...(filterOpen ? styles.railBtnOpen : null),
                    }}
                >
                    <span style={{ ...styles.railSwatch, background: currentPreset.swatch }} />
                    <span style={styles.railLabel}>Filter</span>
                </button>
                {filterOpen && <FilterStrip />}
            </div>

            {SLOT_RAIL_META.map(({ slot, label, icon }) => {
                const isOpen = openDrawer === slot;
                const slug = slots[slot];
                const isActive = activeSlot === slot && !!slug;
                return (
                    <div key={slot} style={styles.railRow}>
                        <button
                            type="button"
                            data-testid={`look-drawer-toggle-${slot}`}
                            aria-expanded={isOpen}
                            onClick={() => appStore.getState().toggleLookOpenDrawer(slot)}
                            style={{
                                ...styles.railBtn,
                                ...(isOpen ? styles.railBtnOpen : isActive ? styles.railBtnActive : null),
                            }}
                        >
                            {slug ? (
                                <img src={assetFileForSlug(slug)} alt="" style={styles.railThumb} />
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
        top: '18%',
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
        border: '1.5px solid rgba(255,255,255,0.28)',
        background: 'rgba(15, 17, 24, 0.72)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: 4,
        boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
    },
    railBtnOpen: {
        borderColor: '#4ade80',
        background: 'rgba(20, 40, 28, 0.88)',
    },
    railBtnActive: {
        borderColor: 'rgba(74, 222, 128, 0.65)',
    },
    railSwatch: {
        width: 20,
        height: 20,
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.6)',
        display: 'block',
    },
    railThumb: {
        width: 22,
        height: 22,
        objectFit: 'contain',
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
    foldoutColumn: {
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
        background: 'rgba(15, 17, 24, 0.84)',
        borderRadius: 12,
        padding: '4px 6px',
        maxWidth: 'calc(100vw - 84px)',
        scrollSnapType: 'x mandatory',
    },
    chip: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        minWidth: 48,
        padding: '4px 5px',
        borderRadius: 10,
        border: '1.5px solid transparent',
        background: 'rgba(255,255,255,0.08)',
        color: '#fff',
        scrollSnapAlign: 'start',
    },
    chipSelected: {
        borderColor: '#4ade80',
        background: 'rgba(74,222,128,0.22)',
    },
    swatch: {
        width: 30,
        height: 30,
        borderRadius: 6,
        display: 'block',
    },
    thumb: {
        width: 30,
        height: 30,
        objectFit: 'contain',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.35)',
    },
    chipLabel: {
        fontSize: 9,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
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
    },
};
