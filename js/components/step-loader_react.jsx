import React, { useEffect, useState } from 'react';

/**
 * React transition for step-loader.js
 * Renders the question/step prompt UI.
 */
export default function StepLoader({ stepData, isTextMode }) {
    if (!stepData) return null;

    return (
        <div className="step-container p-3 animate__animated animate__fadeIn">
            {/* Mission/Context Header */}
            {stepData.mission && (
                <div className="mission-banner mb-3 text-muted">
                    <small className="text-uppercase fw-bold">Mission</small>
                    <div>{stepData.mission}</div>
                </div>
            )}

            {/* Main Prompt */}
            <h3 className="step-prompt mb-4" style={{ fontWeight: 600 }}>
                {stepData.step}
            </h3>

            {/* Translation (if available and text mode is on) */}
            {isTextMode && stepData.translation && (
                <div className="step-translation fst-italic text-secondary mb-3">
                    {stepData.translation}
                </div>
            )}

            {/* Hints / Cues */}
            {stepData.incues && stepData.incues.length > 0 && (
                <div className="step-hints">
                    {stepData.incues.map((cue, idx) => (
                        <span key={idx} className="badge bg-info text-dark me-2 mb-2 p-2" style={{ fontSize: '0.9rem' }}>
                            {cue}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
