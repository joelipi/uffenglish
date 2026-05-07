// components/interactive-video-player.native.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { InteractiveVideoStateController } from '../modules/interactive-video-controller.js';

/**
 * Native equivalent of InteractiveVideoPlayer + InteractiveVideoPlayerUI.
 * Driven by the same InteractiveVideoStateController as the web version.
 *
 * Usage:
 *   <InteractiveVideoPlayer
 *     videoUrl="https://..."
 *     cue="The quick brown fox"
 *     speeds={[0.75, 0.6, 1]}
 *   />
 */
export function InteractiveVideoPlayer({ videoUrl, cue, speeds, style }) {
    // --- Controller (pure logic, shared with web) ---
    const controllerRef = useRef(
        new InteractiveVideoStateController({ videoUrl, cue, speeds })
    );

    // --- Reactive UI state, driven by controller subscriptions ---
    const [subtitleText, setSubtitleText] = useState('');
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isLoaded, setIsLoaded] = useState(false);

    // --- expo-video player ---
    const player = useVideoPlayer(videoUrl, p => {
        p.loop = false; // We handle looping manually via controller
        p.muted = true; // Unmuted on first tap, matching web behaviour
        p.play();
    });

    // --- Subscribe controller → UI state ---
    useEffect(() => {
        const controller = controllerRef.current;
        const unsub = controller.subscribe(state => {
            setSubtitleText(state.subtitleText);
            setIsLoaded(state.isLoaded);

            // Sync playback rate to player
            if (player.rate !== state.playbackRate) {
                player.rate = state.playbackRate;
            }

            // Controller requested play but player is paused
            if (state.isPlaying && player.status === 'paused') {
                player.play();
            }
        });
        return unsub;
    }, [player]);

    // --- Video event → controller ---
    useEffect(() => {
        // expo-video exposes an addStatusChangeListener for playback events
        const sub = player.addStatusChangeListener(status => {
            if (status === 'playing') controllerRef.current.play();
            if (status === 'paused') controllerRef.current.pause();
            if (status === 'ended') {
                controllerRef.current.handleLoop();
                player.seekTo(0);
                player.play();
            }
        });
        return () => sub.remove();
    }, [player]);

    // --- Loaded event → controller ---
    useEffect(() => {
        const sub = player.addOnLoadedListener(() => {
            controllerRef.current.setLoaded();
        });

        // FOUC fallback — mirrors the 3000ms timeout in the web version
        const fallback = setTimeout(() => controllerRef.current.setLoaded(), 3000);

        return () => {
            sub.remove();
            clearTimeout(fallback);
        };
    }, [player]);

    // --- Tap to toggle play/pause + unmute on first interaction ---
    const hasUnmuted = useRef(false);
    const handleTap = useCallback(() => {
        if (!hasUnmuted.current) {
            player.muted = false;
            hasUnmuted.current = true;
        }

        if (player.status === 'paused') {
            player.play();
        } else {
            player.pause();
        }
    }, [player]);

    return (
        <TouchableWithoutFeedback onPress={handleTap}>
            <View style={[styles.wrapper, !isLoaded && styles.hidden, style]}>

                <VideoView
                    player={player}
                    style={styles.video}
                    nativeControls={false}
                    contentFit="contain"
                />

                {/* Subtitle overlay — bottom 15-35% of the video, matching web */}
                {subtitleText ? (
                    <View style={styles.subtitleOverlay} pointerEvents="none">
                        <Text style={styles.subtitleText}>{subtitleText}</Text>
                    </View>
                ) : null}

            </View>
        </TouchableWithoutFeedback>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: '#000',
        position: 'relative',
        overflow: 'hidden',
    },
    hidden: {
        opacity: 0,   // Invisible until loaded, avoids FOUC — mirrors web visibility:hidden
    },
    video: {
        width: '100%',
        height: '100%',
    },
    subtitleOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '35%',          // Covers the same region as the web overlay
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        // Soft gradient feel without expo-linear-gradient dependency
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
    },
    subtitleText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center',
        lineHeight: 24,
        letterSpacing: 0.3,
    },
});