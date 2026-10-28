import React, { useEffect, useState } from 'react';
import {
    HERO_ROTATION_INTERVAL_MS,
    heroHeadlineText,
    resolveHeroHeadline,
} from '../../modules/home/hero-headline-logic.js';
import { readHeroReducedMotion } from '../../modules/home/hero-headline-webonly.js';

// The homepage hero headline: one sentence whose relationship and two CEFR
// bands rotate. All copy, word lists and index maths live in the pure
// hero-headline-logic module; this component only renders that decision and
// advances the tick.
//
// The rotating surfaces are stacked in one grid cell and only the active value
// is opaque, so a longer word never reflows the line and the share-code card
// below never moves mid-read. Every candidate stays in the DOM (a short word
// pads inside the cell instead of leaving a hole), the visible stack is
// aria-hidden, and a visually-hidden copy of the sentence carries the accessible
// name — assistive tech reads one coherent sentence, not a word changing every
// second. Under prefers-reduced-motion the tick never advances: the headline is
// still complete and readable, just not animated.
export default function HeroHeadline({
    lang = 'en',
    intervalMs = HERO_ROTATION_INTERVAL_MS,
}) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (readHeroReducedMotion() || !(intervalMs > 0)) {
            console.log('[HeroHeadline] rotation off — reduced motion or no interval');
            return undefined;
        }

        const id = setInterval(() => setTick((value) => value + 1), intervalMs);
        console.log(`[HeroHeadline] rotating every ${intervalMs}ms`);

        return () => clearInterval(id);
    }, [intervalMs]);

    const segments = resolveHeroHeadline(lang, tick);

    return (
        <span className="uff-hero-headline" data-testid="hero-headline">
            <span className="visually-hidden" data-testid="hero-headline-accessible">
                {heroHeadlineText(lang, 0)}
            </span>
            <span aria-hidden="true" data-testid="hero-headline-visual">
                {segments.map((segment, index) => {
                    if (segment.kind !== 'slot') {
                        return <React.Fragment key={`text-${index}`}>{segment.text}</React.Fragment>;
                    }
                    return (
                        <span
                            key={segment.slot}
                            className="uff-hero-rot"
                            data-testid={`hero-slot-${segment.slot}`}
                        >
                            {segment.values.map((value, valueIndex) => (
                                <span
                                    key={value}
                                    className={valueIndex === segment.activeIndex
                                        ? 'uff-hero-rot__item is-on'
                                        : 'uff-hero-rot__item'}
                                >
                                    {value}
                                </span>
                            ))}
                        </span>
                    );
                })}
            </span>
        </span>
    );
}
