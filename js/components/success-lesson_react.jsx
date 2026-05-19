import React, { useState, useEffect } from 'react';

/**
 * React transition for success-lesson.js
 * Shows the completion screen and triggers confetti.
 */
export default function SuccessLesson({ isVisible, lessonStats, onContinue }) {
    const [statsVisible, setStatsVisible] = useState(false);

    useEffect(() => {
        if (isVisible) {
            // Trigger confetti (using canvas-confetti library, assumed imported/available globally or via import)
            if (window.confetti) {
                window.confetti({
                    particleCount: 150,
                    spread: 80,
                    origin: { y: 0.6 }
                });
            }

            // Stagger stat reveals
            setTimeout(() => setStatsVisible(true), 500);
        } else {
            setStatsVisible(false);
        }
    }, [isVisible]);

    if (!isVisible) return null;

    return (
        <div className="success-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 9999,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: 'white', padding: '20px'
        }}>
            <h1 className="animate__animated animate__bounceIn" style={{ color: '#00d2ff', fontSize: '3rem', marginBottom: '30px' }}>
                Lesson Complete!
            </h1>

            {statsVisible && (
                <div className="stats-container animate__animated animate__fadeInUp" style={{ background: '#222', padding: '20px', borderRadius: '15px', width: '100%', maxWidth: '400px' }}>
                    <div className="stat-row" style={{ display: 'flex', justifyContent: 'space-between', margin: '15px 0', fontSize: '1.2rem' }}>
                        <span>Fluency Score:</span>
                        <span style={{ color: '#00d2ff', fontWeight: 'bold' }}>{lessonStats?.fluencyScore || 0}%</span>
                    </div>
                    <div className="stat-row" style={{ display: 'flex', justifyContent: 'space-between', margin: '15px 0', fontSize: '1.2rem' }}>
                        <span>Words Spoken:</span>
                        <span>{lessonStats?.wordsSpoken || 0}</span>
                    </div>
                    <div className="stat-row" style={{ display: 'flex', justifyContent: 'space-between', margin: '15px 0', fontSize: '1.2rem' }}>
                        <span>Average WPM:</span>
                        <span>{lessonStats?.averageWpm || 0}</span>
                    </div>
                </div>
            )}

            <button
                onClick={onContinue}
                className="btn btn-primary btn-lg mt-5 animate__animated animate__fadeIn"
                style={{ borderRadius: '50px', padding: '15px 40px', fontSize: '1.2rem', animationDelay: '1.5s' }}
            >
                Continue
            </button>
        </div>
    );
}
