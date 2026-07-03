import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import UserProfile from '../components/profile/UserProfile.jsx';

export default function ProfileRoute() {
    const { finishPreloader } = usePreloader();
    useEffect(() => { finishPreloader(); }, []);
    return <UserProfile />;
}
