import React from 'react';
import { useNavigate } from 'react-router-dom';
import SignupForm from '../js/components/auth/SignupForm.web.jsx';

export default function SignupRoute() {
    const navigate = useNavigate();
    return (
        <SignupForm
            onSignupSuccess={() => navigate('/')}
            onLoginLink={() => navigate('/login')}
        />
    );
}
