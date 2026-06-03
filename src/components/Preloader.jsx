import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store/store.js';
import uffLogo from '../assets/img/u-f-f.png';

const styles = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        opacity: 1,
        transition: 'opacity 0.3s ease-out'
    },
    image: {
        width: '80vw',
        height: '80vh',
        maxWidth: '800px',
        maxHeight: '800px',
        background: `url(${uffLogo}) no-repeat center center`,
        backgroundSize: 'contain'
    },
    progressContainer: {
        position: 'absolute',
        top: '40%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '60%',
        maxWidth: '300px',
        height: '6px',
        background: 'rgba(255, 255, 255, 0.2)',
        borderRadius: '10px',
        overflow: 'hidden',
        zIndex: 1000000
    },
    progressBar: {
        width: '0%',
        height: '100%',
        background: '#ffffff',
        borderRadius: '10px',
        transition: 'width 0.1s linear'
    }
};

export default function Preloader() {
    const preloaderVisible = useStore(appStore, (state) => state.preloaderVisible);
    const preloaderProgress = useStore(appStore, (state) => state.preloaderProgress);

    useEffect(() => {
        appStore.getState().setReactReady(true);
    }, []);

    if (!preloaderVisible) return null;

    const fadeOut = preloaderProgress >= 100;

    return (
        <div style={{ ...styles.overlay, opacity: fadeOut ? 0 : 1, pointerEvents: fadeOut ? 'none' : 'auto' }}>
            <div style={styles.image}></div>
            <div style={styles.progressContainer}>
                <div style={{ ...styles.progressBar, width: `${Math.round(preloaderProgress)}%` }}></div>
            </div>
        </div>
    );
}
