import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm.web.jsx';

export default function LoginRoute() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirect = searchParams.get('redirect') || '/';
    return (
        <LoginForm
            onLoginSuccess={() => navigate(redirect)}
            onSignupLink={() => navigate('/signup')}
            onForgotPassword={() => navigate('/recover-password')}
        />
    );
}
