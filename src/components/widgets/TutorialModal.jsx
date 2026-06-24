import React from 'react';

export default function TutorialModal({ onClose }) {
    return (
        <div
            className="tutorial-modal-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                backgroundColor: 'rgba(0,0,0,0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
            onClick={onClose}
        >
            <div
                className="tutorial-modal-content"
                style={{
                    backgroundColor: '#1a1a2e',
                    borderRadius: 12,
                    padding: 24,
                    maxWidth: 500,
                    width: '90%',
                    color: '#fff',
                    textAlign: 'center',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 style={{ marginTop: 0 }}>Watch Tutorial</h2>
                <p style={{ color: '#aaa', margin: '24px 0' }}>
                    Tutorial video coming soon.
                </p>
                <button
                    className="btn call-btn"
                    onClick={onClose}
                    style={{ marginTop: 8 }}
                >
                    <i className="bi bi-x-lg me-2"></i>
                    Close
                </button>
            </div>
        </div>
    );
}
