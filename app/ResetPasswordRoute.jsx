import React from 'react';
import { useNavigate } from 'react-router-dom';
import ResetPasswordForm from '../js/components/auth/ResetPasswordForm.web.jsx';

export default function ResetPasswordRoute() {
    const navigate = useNavigate();
    return (
        <ResetPasswordForm
            onResetSuccess={() => navigate('/login')}
        />
    );
}
