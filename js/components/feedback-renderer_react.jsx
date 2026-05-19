import React from 'react';

/**
 * React transition for feedback-renderer.js
 * Renders the AI feedback for a user's verbal response.
 */
export default function FeedbackRenderer({ feedbackData }) {
    if (!feedbackData) return null;

    const {
        score,
        message,
        grammarCorrections = [],
        isPerfect
    } = feedbackData;

    return (
        <div className={`feedback-container mt-3 p-4 rounded shadow-sm ${isPerfect ? 'bg-success bg-opacity-10' : 'bg-light'}`}>
            <div className="d-flex align-items-center mb-3">
                <div className={`score-badge rounded-circle d-flex align-items-center justify-content-center me-3 ${score >= 80 ? 'bg-success' : score >= 60 ? 'bg-warning' : 'bg-danger'} text-white`} style={{ width: '60px', height: '60px', fontSize: '1.5rem', fontWeight: 'bold' }}>
                    {score}%
                </div>
                <h4 className="m-0 text-dark">
                    {score >= 90 ? 'Excellent!' : score >= 70 ? 'Good Job' : 'Keep Practicing'}
                </h4>
            </div>

            <p className="feedback-message fs-5 text-dark mb-4">
                {message}
            </p>

            {grammarCorrections.length > 0 && (
                <div className="grammar-corrections mt-3 border-top pt-3">
                    <h5 className="text-secondary mb-2">Corrections:</h5>
                    <ul className="list-group list-group-flush bg-transparent">
                        {grammarCorrections.map((correction, idx) => (
                            <li key={idx} className="list-group-item bg-transparent border-0 px-0 py-2">
                                <div className="text-danger text-decoration-line-through mb-1">
                                    <i className="bi bi-x-circle me-2"></i>
                                    {correction.original}
                                </div>
                                <div className="text-success fw-bold">
                                    <i className="bi bi-check-circle me-2"></i>
                                    {correction.correction}
                                </div>
                                {correction.explanation && (
                                    <div className="text-muted small mt-1 ms-4">
                                        {correction.explanation}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
