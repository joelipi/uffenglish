import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import headerLogo from '../assets/img/uff-logo.png';
import LoginForm from '../components/auth/LoginForm.web.jsx';

export default function LoginRoute() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirect = searchParams.get('redirect') || '/home';
    return (
        <>
            <header
                style={{
                    background: 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)',
                    padding: '0.75rem 1rem',
                    textAlign: 'center',
                    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.35)',
                }}
            >
                <img
                    src={headerLogo}
                    alt="UFF"
                    style={{ height: 40, width: 'auto', maxWidth: '35vw', display: 'inline-block' }}
                />
            </header>
            <LoginForm
                onLoginSuccess={() => navigate(redirect)}
                onSignupLink={() => navigate(redirect !== '/' ? `/signup?redirect=${encodeURIComponent(redirect)}` : '/signup')}
                onForgotPassword={() => navigate('/recover-password')}
            />
        </>
    );
}
