import React, { useState } from 'react';
import Strings from '../../data/strings.js';

// Public homepage carousel of concatenated learner conversations. Poster-first:
// only the poster <img> (lazy) is mounted on load; a video element is created
// only for the slide whose play button was pressed, and unmounted when another
// slide is played or the visitor navigates. At most one video element (and no
// preloaded video bytes) is ever mounted. Presentational only — no store.
export default function ConversationCarousel({ lang = 'en', videos = [] }) {
    const [index, setIndex] = useState(0);
    const [playingSlug, setPlayingSlug] = useState(null);

    if (videos.length === 0) return null;

    const cardStyle = {
        backgroundColor: '#1a3a5a',
        borderRadius: '12px',
        padding: '24px',
        border: '1px solid #2a4a6a',
    };

    const mediaStyle = {
        width: '100%',
        aspectRatio: '9/16',
        objectFit: 'cover',
        display: 'block',
    };

    const playBtnStyle = {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        background: 'white',
        color: '#1a1a1a',
        border: 'none',
        fontSize: '24px',
        lineHeight: 1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    };

    const navBtnStyle = {
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'rgba(0,0,0,0.5)',
        color: 'white',
        border: 'none',
        borderRadius: '50%',
        width: '36px',
        height: '36px',
        fontSize: '22px',
        lineHeight: 1,
        cursor: 'pointer',
    };

    function handlePrev() {
        setPlayingSlug(null);
        setIndex((i) => Math.max(0, i - 1));
    }

    function handleNext() {
        setPlayingSlug(null);
        setIndex((i) => Math.min(videos.length - 1, i + 1));
    }

    const heading = Strings.get('home_landing_showcase_heading', lang);

    return (
        <section data-testid="showcase-carousel" style={cardStyle}>
            <h2 data-testid="showcase-heading" style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px' }}>
                {heading}
            </h2>
            <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
                <div
                    data-testid="showcase-track"
                    style={{ display: 'flex', transition: 'transform .3s', transform: `translateX(-${index * 100}%)` }}
                >
                    {videos.map((v) => (
                        <div key={v.slug} data-testid={`showcase-slide-${v.slug}`} style={{ flex: '0 0 100%', position: 'relative' }}>
                            {playingSlug === v.slug ? (
                                <video
                                    data-testid={`showcase-video-${v.slug}`}
                                    src={v.videoUrl}
                                    poster={v.posterUrl}
                                    controls
                                    autoPlay
                                    playsInline
                                    preload="none"
                                    style={mediaStyle}
                                />
                            ) : (
                                <>
                                    <img
                                        data-testid={`showcase-poster-${v.slug}`}
                                        src={v.posterUrl}
                                        loading="lazy"
                                        alt={heading}
                                        style={mediaStyle}
                                    />
                                    <button
                                        type="button"
                                        data-testid={`showcase-play-${v.slug}`}
                                        aria-label={Strings.get('home_landing_showcase_play', lang)}
                                        onClick={() => setPlayingSlug(v.slug)}
                                        style={playBtnStyle}
                                    >
                                        ▶
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    data-testid="showcase-prev"
                    disabled={index === 0}
                    onClick={handlePrev}
                    aria-label="Previous"
                    style={{ ...navBtnStyle, left: '8px' }}
                >
                    ‹
                </button>
                <button
                    type="button"
                    data-testid="showcase-next"
                    disabled={index === videos.length - 1}
                    onClick={handleNext}
                    aria-label="Next"
                    style={{ ...navBtnStyle, right: '8px' }}
                >
                    ›
                </button>
            </div>
        </section>
    );
}
