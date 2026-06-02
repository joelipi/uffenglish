import React from 'react';
import { useNavigate } from 'react-router-dom';
import RecoverPasswordForm from '../js/components/auth/RecoverPasswordForm.web.jsx';

export default function RecoverPasswordRoute() {
    const navigate = useNavigate();
    return (
        <RecoverPasswordForm
            onBackToLogin={() => navigate('/login')}
        />
    );
}
