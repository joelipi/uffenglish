import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import {
    FILTER_PRESETS,
    OVERLAY_SLOTS,
    OVERLAY_LIBRARY,
    overlaySlugsForSlot,
    assetFileForSlug,
    MIN_SCALE,
    MAX_SCALE,
} from '../../modules/looks/recording-looks-logic.js';

// Look controls for the friendClosedResponse preview screen (stories/092).
//
// Render-only: every rule (which filters exist, which asset belongs to which
// slot, scale limits) comes from modules/looks/recording-looks-logic.js. This is
// DOM laid over the preview <video>, so it is never part of the recorded canvas.
//
// Copy is intentionally English-only for now; localizing the look labels is
// tracked in the story's Notes.

const SLOT_LABELS = {
    face: 'Face',
    upper: 'Above face',
    lower: 'Lower',
};

function FilterStrip() {
    const filterId = useStore(appStore, (state) => state.lookSelection.filterId);
    return (
        <div className="look-strip" data-testid="look-filter-strip" style={styles.strip}>
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

function OverlayRow({ slot }) {
    const slugForSlot = useStore(appStore, (state) => state.lookSelection.slots[slot]);
    const activeSlot = useStore(appStore, (state) => state.lookActiveSlot);
    const slugs = overlaySlugsForSlot(slot);
    const isActive = activeSlot === slot;

    return (
        <div style={styles.row} data-testid={`look-slot-row-${slot}`}>
            <button
                type="button"
                onClick={() => appStore.getState().setLookActiveSlot(slot)}
                style={{ ...styles.rowLabel, ...(isActive ? styles.rowLabelActive : null) }}
                data-testid={`look-slot-label-${slot}`}
            >
                {SLOT_LABELS[slot]}
            </button>
            <div style={styles.strip}>
                <button
                    type="button"
                    data-testid={`look-slot-${slot}-none`}
                    aria-pressed={!slugForSlot}
                    onClick={() => appStore.getState().setLookSlot(slot, null)}
                    style={{ ...styles.chip, ...(!slugForSlot ? styles.chipSelected : null) }}
                >
                    <span style={{ ...styles.swatch, background: 'repeating-linear-gradient(45deg,#333,#333 6px,#444 6px,#444 12px)' }} />
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
        </div>
    );
}

function SizeSlider() {
    const activeSlot = useStore(appStore, (state) => state.lookActiveSlot);
    const slug = useStore(appStore, (state) => state.lookSelection.slots[activeSlot]);
    const scale = useStore(appStore, (state) => state.lookTuning[activeSlot].scale);
    if (!slug) return null;
    return (
        <label style={styles.sliderRow} data-testid="look-size-slider">
            <span style={styles.sliderLabel}>Size</span>
            <input
                type="range"
                min={MIN_SCALE}
                max={MAX_SCALE}
                step={0.05}
                value={scale}
                onChange={(e) => appStore.getState().setLookTuning(activeSlot, { scale: Number(e.target.value) })}
                style={styles.slider}
            />
            <button
                type="button"
                onClick={() => appStore.getState().setLookTuning(activeSlot, { dx: 0, dy: 0, scale: 1 })}
                style={styles.resetButton}
                data-testid="look-size-reset"
            >
                Reset
            </button>
        </label>
    );
}

export default function LookControls() {
    const awaiting = useStore(appStore, (state) => state.awaitingRecordingStart);
    // Locked once recording starts: a mid-take change would pop in the blob.
    if (!awaiting) return null;
    return (
        <div style={styles.panel} data-testid="look-controls" onPointerDown={(e) => e.stopPropagation()}>
            <FilterStrip />
            {OVERLAY_SLOTS.map((slot) => <OverlayRow key={slot} slot={slot} />)}
            <SizeSlider />
            <div style={styles.hint}>Drag on the preview to move the selected overlay</div>
        </div>
    );
}

const styles = {
    panel: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '8px 10px 12px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0.35))',
        zIndex: 120,
        maxHeight: '52%',
        overflowY: 'auto',
        pointerEvents: 'auto',
        touchAction: 'pan-y',
    },
    strip: {
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 6,
        scrollSnapType: 'x mandatory',
    },
    chip: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        minWidth: 58,
        padding: '5px 6px',
        borderRadius: 10,
        border: '2px solid transparent',
        background: 'rgba(255,255,255,0.10)',
        color: '#fff',
        scrollSnapAlign: 'start',
    },
    chipSelected: {
        borderColor: '#4ade80',
        background: 'rgba(74,222,128,0.22)',
    },
    swatch: {
        width: 40,
        height: 40,
        borderRadius: 8,
        display: 'block',
    },
    thumb: {
        width: 40,
        height: 40,
        objectFit: 'contain',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.35)',
    },
    chipLabel: {
        fontSize: 10,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
    },
    rowLabel: {
        minWidth: 62,
        padding: '6px 4px',
        borderRadius: 8,
        border: 'none',
        background: 'transparent',
        color: 'rgba(255,255,255,0.72)',
        fontSize: 11,
        textAlign: 'left',
    },
    rowLabelActive: {
        color: '#4ade80',
        fontWeight: 700,
    },
    sliderRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
        color: 'rgba(255,255,255,0.8)',
        fontSize: 11,
    },
    sliderLabel: { minWidth: 30 },
    slider: { flex: 1 },
    resetButton: {
        border: '1px solid rgba(255,255,255,0.4)',
        background: 'transparent',
        color: '#fff',
        borderRadius: 8,
        fontSize: 11,
        padding: '3px 8px',
    },
    hint: {
        marginTop: 6,
        fontSize: 10,
        color: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
    },
};
