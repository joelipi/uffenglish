import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import SignupForm from '../components/auth/SignupForm.web.jsx';

export default function SignupRoute() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirect = searchParams.get('redirect') || '/';
    return (
        <SignupForm
            onSignupSuccess={() => navigate(redirect)}
            onLoginLink={() => navigate('/login')}
        />
    );
}
