import React, { useState } from 'react';
import Strings from '../../data/strings.js';
import './home-landing.css';

// Public homepage carousel of concatenated learner conversations. Poster-first:
// only the poster <img> (lazy) is mounted on load; a video element is created
// only for the slide whose play button was pressed, and unmounted when another
// slide is played or the visitor navigates. At most one video element (and no
// preloaded video bytes) is ever mounted. Presentational only — no store.
export default function ConversationCarousel({ lang = 'en', videos = [] }) {
    const [index, setIndex] = useState(0);
    const [playingSlug, setPlayingSlug] = useState(null);

    if (videos.length === 0) return null;

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
        <section className="uff-section uff-section--alt" id="showcase" data-testid="showcase-carousel">
            <div className="container">
                <div className="text-center mb-4">
                    <h2 className="uff-section-title text-white" data-testid="showcase-heading">
                        {heading}
                    </h2>
                </div>

                <div className="card border-secondary position-relative overflow-hidden">
                    <div className="card-body p-2 p-sm-3">
                        <div
                            data-testid="showcase-track"
                            className="uff-carousel-track"
                            style={{ transform: `translateX(-${index * 100}%)` }}
                        >
                            {videos.map((v) => (
                                <div key={v.slug} data-testid={`showcase-slide-${v.slug}`} className="uff-carousel-slide">
                                    {playingSlug === v.slug ? (
                                        <video
                                            data-testid={`showcase-video-${v.slug}`}
                                            src={v.videoUrl}
                                            poster={v.posterUrl}
                                            controls
                                            autoPlay
                                            playsInline
                                            preload="none"
                                            className="uff-carousel-media"
                                        />
                                    ) : (
                                        <>
                                            <img
                                                data-testid={`showcase-poster-${v.slug}`}
                                                src={v.posterUrl}
                                                loading="lazy"
                                                alt={heading}
                                                className="uff-carousel-media"
                                            />
                                            <button
                                                type="button"
                                                data-testid={`showcase-play-${v.slug}`}
                                                aria-label={Strings.get('home_landing_showcase_play', lang)}
                                                onClick={() => setPlayingSlug(v.slug)}
                                                className="uff-carousel-play"
                                            >
                                                <i className="bi bi-play-fill" aria-hidden="true"></i>
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>

                        <button
                            type="button"
                            data-testid="showcase-prev"
                            className="uff-carousel-nav start-0 ms-2"
                            style={{ left: '8px' }}
                            disabled={index === 0}
                            onClick={handlePrev}
                            aria-label="Previous"
                        >
                            <i className="bi bi-chevron-left" aria-hidden="true"></i>
                        </button>
                        <button
                            type="button"
                            data-testid="showcase-next"
                            className="uff-carousel-nav end-0 me-2"
                            style={{ right: '8px' }}
                            disabled={index === videos.length - 1}
                            onClick={handleNext}
                            aria-label="Next"
                        >
                            <i className="bi bi-chevron-right" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
