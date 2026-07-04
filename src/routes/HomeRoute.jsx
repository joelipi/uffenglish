import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import HomeScreen from '../components/homescreen/HomeScreen.jsx';

export default function HomeRoute() {
    const { finishPreloader } = usePreloader();

    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <HomeScreen />;
}
