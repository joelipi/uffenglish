import React from 'react';
import { useLoginForm } from './LoginForm.jsx';

export default function LoginForm({ onLoginSuccess, onSignupLink, onForgotPassword }) {
    const {
        email,
        setEmail,
        password,
        setPassword,
        error,
        loading,
        handleSubmit,
    } = useLoginForm({ onLoginSuccess });

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                Login
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}

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
                <div className="mb-3">
                    <label htmlFor="password" className="form-label">Password</label>
                    <input
                        type="password"
                        className="form-control"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? 'Logging in...' : 'Log In'}
                </button>
            </form>

            <div className="text-center mt-3">
                <p>Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); onSignupLink?.(); }}>Sign up</a></p>
                <p><a href="#" onClick={(e) => { e.preventDefault(); onForgotPassword?.(); }}>Forgot password?</a></p>
            </div>
        </>
    );
}
