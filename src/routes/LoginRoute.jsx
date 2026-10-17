import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm.web.jsx';
import { COURSES_PATH } from '../modules/courses/guest-viewer-logic.js';

export default function LoginRoute() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirect = searchParams.get('redirect') || '/home';
    return (
        <>
            <LoginForm
                onLoginSuccess={() => navigate(redirect)}
                // Story 070: signup is closed, so the "Sign Up" link no longer
                // offers a form. It goes to the course list, where a new learner
                // completes a lesson and the account is created at the end. A
                // visitor who already has an account uses the form above.
                onSignupLink={() => navigate(COURSES_PATH)}
                onForgotPassword={() => navigate('/recover-password')}
            />
        </>
    );
}
