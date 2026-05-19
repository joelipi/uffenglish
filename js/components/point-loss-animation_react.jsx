import React, { useState, useEffect } from 'react';

/**
 * React transition for point-loss-animation.js
 * In React, instead of a global class appending to document.body,
 * this component should be mounted high in the DOM tree, and
 * take an array of "loss events" via state/props.
 */
export default function PointLossAnimation({ lossEvents = [], duration = 1500 }) {
    const [events, setEvents] = useState([]);

    // Sync incoming events with internal state so we can remove them after animation
    useEffect(() => {
        if (lossEvents.length > 0) {
            setEvents(prev => [...prev, ...lossEvents]);
        }
    }, [lossEvents]);

    // Cleanup individual events after their duration
    useEffect(() => {
        if (events.length === 0) return;

        const timers = events.map(event => {
            return setTimeout(() => {
                setEvents(prev => prev.filter(e => e.id !== event.id));
            }, duration);
        });

        return () => {
            timers.forEach(clearTimeout);
        };
    }, [events, duration]);

    return (
        <>
            <style>{`
                .point-loss-float {
                    position: fixed;
                    font-family: Orbitron, monospace;
                    font-size: 2.5em;
                    font-weight: bold;
                    color: #ff4757;
                    pointer-events: none;
                    z-index: 10000;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
                    transform: translate(-50%, -50%);
                }

                @keyframes pointLossFloatAnim {
                    0% {
                        opacity: 1;
                        transform: translate(-50%, -50%) translateY(0) scale(1);
                    }
                    20% {
                        transform: translate(-50%, -50%) translateY(-10px) scale(1.2);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, -50%) translateY(-60px) scale(0.8);
                    }
                }

                .point-loss-float.animate {
                    animation: pointLossFloatAnim ${duration}ms ease-out forwards;
                }
            `}</style>

            {events.map(event => (
                <div
                    key={event.id}
                    className="point-loss-float animate"
                    style={{
                        left: event.x + 'px',
                        top: event.y + 'px'
                    }}
                >
                    -{event.points}
                </div>
            ))}
        </>
    );
}
