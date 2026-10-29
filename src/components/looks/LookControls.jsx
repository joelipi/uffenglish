import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import {
    FILTER_PRESETS,
    LENS_PRESETS,
    SCREEN_PRESETS,
    OVERLAY_LIBRARY,
    overlaySlugsForSlot,
    assetFileForSlug,
    DEFAULT_FILTER_ID,
    DEFAULT_LENS_ID,
    DEFAULT_SCREEN_ID,
    NONE_SWATCH,
    MIN_SCALE,
    MAX_SCALE,
} from '../../modules/looks/recording-looks-logic.js';
import { twemojiAssetUrl, twemojiCharacter, twemojiSlug } from '../../modules/looks/twemoji-collection.js';
import {
    DEFAULT_EMOJI_CATEGORY,
    EMOJI_PAGE_SIZE,
    filterEmojis,
    visibleEmojis,
} from '../../modules/looks/emoji-picker-logic.js';

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

function FiltersIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={styles.railIconSvg}>
            <circle cx="8" cy="9" r="5" />
            <circle cx="16" cy="9" r="5" />
            <circle cx="12" cy="15" r="5" />
        </svg>
    );
}

function LensIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={styles.railIconSvg}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
    );
}

function TophatIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={styles.railIconSvg}>
            <rect x="3" y="17" width="18" height="3" rx="1.5" />
            <path d="M7 17 L8.5 7 L15.5 7 L17 17 Z" />
            <rect x="8.5" y="5" width="7" height="2.5" rx="1" />
        </svg>
    );
}

const SLOT_RAIL_META = [
    { slot: 'upper', icon: <TophatIcon /> },
    { slot: 'face', icon: 'bi-mask' },
    { slot: 'lower', icon: 'bi-layers' },
    { slot: 'emoji', icon: 'bi-emoji-laughing' },
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
        <div className="look-strip" data-testid={`${testidPrefix}-strip`} style={styles.trayStrip}>
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
                            ...styles.trayChip,
                            ...(selected ? styles.chipSelected : null),
                        }}
                    >
                        <span style={styles.swatchWrap}>
                            <span style={{ ...styles.swatch, background: preset.swatch }} />
                            {selected && <i className="bi bi-check-circle-fill" style={styles.chipCheck}></i>}
                        </span>
                        <span style={styles.trayChipLabel}>
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

function SizeSlider({ slot }) {
    const scale = useStore(appStore, (state) => state.lookTuning[slot].scale);
    return (
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
    );
}

function EmojiFoldout() {
    const selected = useStore(appStore, (state) => state.lookSelection.slots.emoji);
    const [collection, setCollection] = useState(null);
    const [category, setCategory] = useState(DEFAULT_EMOJI_CATEGORY);
    const [query, setQuery] = useState('');
    const [visibleCount, setVisibleCount] = useState(EMOJI_PAGE_SIZE);

    // The 3,700-entry manifest is only fetched when the drawer is opened.
    useEffect(() => {
        let cancelled = false;
        import('../../generated/twemoji-emojis.js')
            .then((module) => { if (!cancelled) setCollection(module); })
            .catch(() => { if (!cancelled) setCollection({ TWEMOJI_EMOJIS: [], TWEMOJI_CATEGORIES: [] }); });
        return () => { cancelled = true; };
    }, []);

    const categories = collection?.TWEMOJI_CATEGORIES || [];
    const filtered = useMemo(
        () => filterEmojis(collection?.TWEMOJI_EMOJIS || [], { category, query }),
        [collection, category, query],
    );
    const shown = visibleEmojis(filtered, visibleCount);

    useEffect(() => { setVisibleCount(EMOJI_PAGE_SIZE); }, [category, query]);

    return (
        <div style={styles.emojiColumn} data-testid="look-slot-row-emoji">
            <div style={styles.emojiToolbar}>
                <button
                    type="button"
                    className="look-tap"
                    data-testid="look-slot-emoji-none"
                    aria-pressed={!selected}
                    onClick={(e) => {
                        releaseFocusAfterPointerTap(e);
                        appStore.getState().setLookSlot('emoji', null);
                    }}
                    style={{ ...styles.trayChip, ...(!selected ? styles.chipSelected : null) }}
                >
                    <span style={{ ...styles.swatch, background: NONE_SWATCH }} />
                    <span style={styles.trayChipLabel}>None</span>
                </button>
                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={styles.emojiSelect}
                    aria-label="Emoji category"
                >
                    {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search"
                    aria-label="Search emoji"
                    style={styles.emojiSearch}
                />
            </div>
            <div style={styles.emojiGrid} data-testid="look-emoji-grid">
                {shown.map((emoji) => {
                    const slug = twemojiSlug(emoji.code);
                    const isSelected = selected === slug;
                    const character = twemojiCharacter(emoji.code);
                    return (
                        <button
                            key={emoji.code}
                            type="button"
                            className="look-tap"
                            data-testid={`look-emoji-${emoji.code}`}
                            aria-pressed={isSelected}
                            title={emoji.name}
                            aria-label={emoji.name || character || emoji.code}
                            onClick={(e) => {
                                releaseFocusAfterPointerTap(e);
                                appStore.getState().setLookSlot('emoji', slug);
                                appStore.getState().setLookActiveSlot('emoji');
                            }}
                            style={{ ...styles.emojiCell, ...(isSelected ? styles.emojiCellSelected : null) }}
                        >
                            <img
                                src={twemojiAssetUrl(emoji.code)}
                                alt=""
                                loading="lazy"
                                draggable={false}
                                style={styles.emojiThumb}
                            />
                        </button>
                    );
                })}
            </div>
            {filtered.length > shown.length && (
                <button
                    type="button"
                    className="look-tap"
                    onClick={() => setVisibleCount((n) => n + EMOJI_PAGE_SIZE)}
                    style={styles.emojiMore}
                    data-testid="look-emoji-more"
                >
                    Show more ({filtered.length - shown.length} left)
                </button>
            )}
            {selected && <SizeSlider slot="emoji" />}
        </div>
    );
}

function OverlayFoldout({ slot }) {
    if (slot === 'emoji') return <EmojiFoldout />;
    return <SlotOverlayFoldout slot={slot} />;
}

function SlotOverlayFoldout({ slot }) {
    const slugForSlot = useStore(appStore, (state) => state.lookSelection.slots[slot]);
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
            {slugForSlot && <SizeSlider slot={slot} />}
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

    const filterOpen = openDrawer === 'filter';
    const filterActive = filterId !== DEFAULT_FILTER_ID;
    const lensOpen = openDrawer === 'lens';
    const lensActive = lensId !== DEFAULT_LENS_ID;
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
                    <FiltersIcon />
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
                    <LensIcon />
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
                    <i className="bi bi-wind" style={styles.railIcon}></i>
                </button>
                {screenOpen && <ScreenStrip />}
            </div>

            {SLOT_RAIL_META.map(({ slot, icon }) => {
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
                                typeof icon === 'string' ? <i className={`bi ${icon}`} style={styles.railIcon}></i> : icon
                            )}
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
        right: 12,
        // The pinned tray opens at the rail top, so the rail top IS the tray
        // top: just under the header blur (the blurred band is the top ~18.5%
        // of the frame — see .video-header-blur), with the whole menu ending
        // well above the mic band on every screen.
        top: '19%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 80,
        // Transparent to touches: the rail now spans the frame width, so only
        // the buttons and the open tray may capture pointers — everything else
        // falls through to the preview (e.g. drag-to-move) underneath.
        pointerEvents: 'none',
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
        pointerEvents: 'auto',
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
    railIconSvg: {
        display: 'block',
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
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'rgba(15, 17, 24, 0.84)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 14,
        padding: '6px 8px',
        pointerEvents: 'auto',
        boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
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
        // Captures its own touches: the rail is pointer-transparent (so gaps
        // fall through to the preview), which means every interactive child
        // must opt back in — without this, taps sail through the tray to the
        // video underneath, whose pointerdown folds the drawer shut.
        pointerEvents: 'auto',
        // Fixed pixels, not vh: the tray sits between the header blur and the
        // mic band, and vh units shift under iOS Safari's collapsing chrome.
        // Tray (300) + Size slider below it stays above the mic on a 667px
        // phone with room to spare. Width comes from left/right anchoring, and
        // is capped so the tray stays compact on wide frames.
        maxHeight: 300,
        maxWidth: 420,
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
        transform: 'translateZ(0)',
        background: 'rgba(15, 17, 24, 0.84)',
        borderRadius: 12,
        padding: '6px',
        // Explicit width, not just maxWidth: an absolutely positioned box
        // shrink-wraps to its (narrow) containing block, which would collapse
        // the 1fr columns to slivers.
        // In-flow inside the anchored column (prop rows) or the rail row
        // (swatch rows): it fills whatever contains it, so no viewport units
        // are needed anywhere here.
        width: '100%',
    },
    emojiColumn: {
        position: 'absolute',
        top: 0,
        left: 56,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'rgba(15, 17, 24, 0.9)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 14,
        padding: '6px 8px',
        pointerEvents: 'auto',
        boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
        maxWidth: 420,
        minWidth: 0,
        boxSizing: 'border-box',
    },
    emojiToolbar: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'stretch',
        minWidth: 0,
    },
    emojiSelect: {
        flex: '0 0 auto',
        maxWidth: 150,
        minWidth: 0,
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.25)',
        background: 'rgba(0,0,0,0.45)',
        color: '#fff',
        fontSize: 11,
        padding: '4px 6px',
    },
    emojiSearch: {
        flex: 1,
        minWidth: 0,
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.25)',
        background: 'rgba(0,0,0,0.45)',
        color: '#fff',
        fontSize: 12,
        padding: '4px 8px',
    },
    emojiGrid: {
        display: 'grid',
        // minmax(0, 1fr) is load-bearing: a plain 1fr keeps each cell's
        // min-content width (the intrinsic 150px SVG), which overflows the
        // tray and pushes the last column off-screen instead of scrolling.
        gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
        gap: 4,
        maxHeight: 300,
        minWidth: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        pointerEvents: 'auto',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
        transform: 'translateZ(0)',
        background: 'rgba(15, 17, 24, 0.84)',
        borderRadius: 12,
        padding: 6,
    },
    emojiCell: {
        // No aspect-ratio here: Safari ignores it on <button>, collapsing every
        // row to zero height so the whole sheet piles at one spot. The cell is
        // content-sized like trayChip; the image's own ratio sets the height.
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 0,
        padding: 4,
        borderRadius: 10,
        border: '1.5px solid transparent',
        background: 'rgba(255,255,255,0.06)',
        ...UA_RESET,
    },
    emojiCellSelected: {
        borderColor: '#5ee08a',
        background: 'rgba(94,224,138,0.2)',
    },
    emojiThumb: {
        // height auto (not 100%): a percentage height against the content-sized
        // cell is indefinite, which collapses the image where aspect-ratio is
        // also ignored. Width-constrained with auto height follows the SVG
        // viewBox ratio on every browser.
        width: '100%',
        height: 'auto',
        display: 'block',
        objectFit: 'contain',
        pointerEvents: 'none',
    },
    emojiMore: {
        alignSelf: 'center',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.25)',
        background: 'rgba(0,0,0,0.45)',
        color: '#fff',
        fontSize: 11,
        padding: '5px 12px',
        ...UA_RESET,
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
        ...UA_RESET,
    },
    trayChipLabel: {
        fontSize: 10,
        lineHeight: 1.2,
        textAlign: 'center',
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
