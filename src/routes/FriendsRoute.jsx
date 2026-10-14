import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import Friends from '../components/friends/Friends.jsx';

export default function FriendsRoute() {
    const { finishPreloader } = usePreloader();
    useEffect(() => { finishPreloader(); }, []);
    return <Friends />;
}
