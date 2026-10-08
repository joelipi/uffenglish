import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ConfirmEmailForm from '../components/auth/ConfirmEmailForm.web.jsx';

export default function ConfirmEmailRoute() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    return (
        <ConfirmEmailForm
            token={params.get('token')}
            onContinue={() => navigate('/')}
        />
    );
}
