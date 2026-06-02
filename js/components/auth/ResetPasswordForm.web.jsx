import React from 'react';
import { useResetPasswordForm } from './ResetPasswordForm.jsx';

export default function ResetPasswordForm({ onResetSuccess }) {
    const {
        password,
        setPassword,
        passwordConfirm,
        setPasswordConfirm,
        error,
        success,
        loading,
        invalidLink,
        handleSubmit,
    } = useResetPasswordForm({ onResetSuccess });

    if (invalidLink) {
        return (
            <>
                <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                    Set New Password
                </h2>
                <div className="alert alert-danger" role="alert">
                    Invalid password reset link. Please request a new one.
                </div>
            </>
        );
    }

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                Set New Password
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            {success && (
                <div className="alert alert-success" role="alert">
                    Password updated successfully! <a href="/login" className="alert-link">Log in now</a>.
                </div>
            )}

            {!success && (
                <form onSubmit={handleSubmit}>
                    <div className="mb-3">
                        <label htmlFor="password" className="form-label">New Password (min 8 chars)</label>
                        <input
                            type="password"
                            className="form-control"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                    </div>
                    <div className="mb-3">
                        <label htmlFor="password-confirm" className="form-label">Confirm Password</label>
                        <input
                            type="password"
                            className="form-control"
                            id="password-confirm"
                            value={passwordConfirm}
                            onChange={(e) => setPasswordConfirm(e.target.value)}
                            required
                            minLength={8}
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Updating...' : 'Update Password'}
                    </button>
                </form>
            )}
        </>
    );
}
