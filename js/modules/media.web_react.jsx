import React, { useRef, useEffect, useState } from 'react';

/**
 * React transition for media.web.js
 * In Vanilla, this file instantiated Audio objects and manipulated the DOM directly
 * to ensure mobile browsers allowed audio playback.
 * In React, this logic should be encapsulated in a Hook or a high-level Provider Component
 * that renders actual <audio> tags so React can manage their lifecycle,
 * and handles the global interaction event to unlock them.
 */

export const useAudioWeb = () => {
    const audioRefs = useRef({});
    const [audioUnlocked, setAudioUnlocked] = useState(false);

    // Audio sources map
    const audioSources = {
        correct: '/assets/sounds/correct.mp3',
        incorrect: '/assets/sounds/incorrect.mp3',
        complete: '/assets/sounds/complete.mp3',
        enableAudio: '/assets/sounds/enableaudio.mp3'
    };

    // Unlock audio on first user interaction
    useEffect(() => {
        const unlockAudio = () => {
            if (audioUnlocked) return;

            // Play and immediately pause all audio elements to unlock them on mobile Safari/Chrome
            Object.values(audioRefs.current).forEach(audioEl => {
                if (audioEl) {
                    audioEl.volume = 0;
                    const playPromise = audioEl.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            audioEl.pause();
                            audioEl.currentTime = 0;
                            audioEl.volume = 1; // Restore volume
                        }).catch(error => {
                            console.log("Audio autoplay prevented on unlock", error);
                        });
                    }
                }
            });
            setAudioUnlocked(true);

            // Cleanup listeners
            ['click', 'touchstart', 'keydown'].forEach(event => {
                document.removeEventListener(event, unlockAudio);
            });
        };

        ['click', 'touchstart', 'keydown'].forEach(event => {
            document.addEventListener(event, unlockAudio, { once: true });
        });

        return () => {
            ['click', 'touchstart', 'keydown'].forEach(event => {
                document.removeEventListener(event, unlockAudio);
            });
        };
    }, [audioUnlocked]);

    const playSound = (soundName) => {
        const audioEl = audioRefs.current[soundName];
        if (audioEl) {
            audioEl.currentTime = 0;
            audioEl.play().catch(e => console.warn(`Could not play ${soundName}:`, e));
        }
    };

    const stopAllSounds = () => {
        Object.values(audioRefs.current).forEach(audioEl => {
            if (audioEl) {
                audioEl.pause();
                audioEl.currentTime = 0;
            }
        });
    };

    // Component to render the audio tags
    const AudioProvider = () => (
        <>
            {Object.entries(audioSources).map(([name, src]) => (
                <audio
                    key={name}
                    ref={el => audioRefs.current[name] = el}
                    src={src}
                    preload="auto"
                />
            ))}
        </>
    );

    return {
        playSound,
        stopAllSounds,
        AudioProvider
    };
};
