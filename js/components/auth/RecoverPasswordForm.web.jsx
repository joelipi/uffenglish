import React from 'react';
import { useRecoverPasswordForm } from './RecoverPasswordForm.jsx';

export default function RecoverPasswordForm({ onBackToLogin }) {
    const {
        email,
        setEmail,
        error,
        success,
        loading,
        handleSubmit,
    } = useRecoverPasswordForm({ onBackToLogin });

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                Recover Password
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            {success && <div className="alert alert-success" role="alert">Recovery email sent. Check your inbox.</div>}

            <p className="text-center text-light mb-4">Enter your email address to receive a password reset link.</p>

            <form onSubmit={handleSubmit}>
                <div className="mb-3">
                    <label htmlFor="email" className="form-label">Email address</label>
                    <input
                        type="email"
                        className="form-control"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? 'Sending...' : 'Send Recovery Email'}
                </button>
            </form>

            <div className="text-center mt-3">
                <p><a href="#" onClick={(e) => { e.preventDefault(); onBackToLogin?.(); }}>Back to login</a></p>
            </div>
        </>
    );
}
