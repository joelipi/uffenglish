import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import headerLogo from '../assets/img/uff-logo.png';
import SignupForm from '../components/auth/SignupForm.web.jsx';

export default function SignupRoute() {
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
                    style={{ height: 'auto', width: 'auto', maxHeight: 40, maxWidth: '50vw', display: 'inline-block' }}
                />
            </header>
            <SignupForm
                onSignupSuccess={() => navigate(redirect)}
                onLoginLink={() => navigate(redirect !== '/' ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login')}
            />
        </>
    );
}
