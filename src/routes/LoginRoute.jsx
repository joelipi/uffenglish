import React from 'react';
import { useNavigate } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm.web.jsx';

export default function LoginRoute() {
    const navigate = useNavigate();
    return (
        <LoginForm
            onLoginSuccess={() => navigate('/')}
            onSignupLink={() => navigate('/signup')}
            onForgotPassword={() => navigate('/recover-password')}
        />
    );
}
