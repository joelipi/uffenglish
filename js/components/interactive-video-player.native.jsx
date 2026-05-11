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
    const [subtitleTokens, setSubtitleTokens] = useState([]);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [showOverlay, setShowOverlay] = useState(false);
    const [isSlowMode, setIsSlowMode] = useState(false);

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
            setSubtitleTokens(state.subtitleTokens || []);
            setIsLoaded(state.isLoaded);
            setShowOverlay(state.showOverlay);
            setIsSlowMode(state.isSlowMode);

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
        if (showOverlay) {
            controllerRef.current.dismissOverlay();
            return;
        }

        if (!hasUnmuted.current) {
            player.muted = false;
            hasUnmuted.current = true;
        }

        if (player.status === 'paused') {
            player.play();
        } else {
            player.pause();
        }
    }, [player, showOverlay]);

    return (
        <TouchableWithoutFeedback onPress={handleTap}>
            <View style={[styles.wrapper, !isLoaded && styles.hidden, style]}>

                <VideoView
                    player={player}
                    style={[styles.video, isSlowMode && styles.videoZoomed]}
                    nativeControls={false}
                    contentFit="contain"
                />

                {/* Subtitle overlay — bottom 15-35% of the video, matching web */}
                {subtitleTokens && subtitleTokens.length > 0 ? (
                    <View style={styles.subtitleOverlay} pointerEvents="box-none">
                        <View style={styles.subtitlesContainer}>
                            {subtitleTokens.map((token, idx) => {
                                if (token.clickable) {
                                    return (
                                        <TouchableWithoutFeedback key={idx} onPress={() => controllerRef.current.revealToken(token.index)}>
                                            <View style={[styles.token, styles.tokenHidden]}>
                                                <Text style={styles.hiddenText}>{token.text}</Text>
                                            </View>
                                        </TouchableWithoutFeedback>
                                    );
                                } else {
                                    return (
                                        <View key={idx} style={[styles.token, token.isPunctuation ? styles.tokenPunctuation : styles.tokenRevealed]}>
                                            <Text style={[styles.tokenText, token.strikethrough && styles.tokenStrikethrough]}>
                                                {token.text}
                                            </Text>
                                        </View>
                                    );
                                }
                            })}
                        </View>
                    </View>
                ) : null}

                {showOverlay && (
                    <View style={styles.overlay} pointerEvents="none">
                        <View style={styles.overlayCircle} />
                        <Text style={styles.overlayText}>Understand{`\n`}100%?</Text>
                    </View>
                )}

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

    videoZoomed: {
        transform: [{ scale: 1.5 }],
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
    subtitlesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
    },
    token: {
        borderRadius: 9999,
        paddingVertical: 2,
        paddingHorizontal: 8,
        margin: 2,
    },
    tokenRevealed: {
        backgroundColor: '#000',
        borderColor: '#444',
        borderWidth: 1,
    },
    tokenPunctuation: {
        backgroundColor: '#000',
        borderColor: '#444',
        borderWidth: 1,
        paddingVertical: 2,
        paddingHorizontal: 4,
    },
    tokenHidden: {
        backgroundColor: '#3a8fd5', // fallback solid color (gradient not built into standard RN without expo-linear-gradient)
        borderColor: 'rgba(255, 255, 255, 0.3)',
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 2,
    },
    tokenText: {
        color: '#fff',
        fontSize: 16,
    },
    hiddenText: {
        color: 'transparent',
        fontSize: 16,
    },
    tokenStrikethrough: {
        textDecorationLine: 'line-through',
        textDecorationColor: 'red',
        textDecorationStyle: 'solid',
    },
    overlay: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    overlayCircle: {
        width: 100, height: 100,
        borderRadius: 50,
        borderWidth: 6,
        borderColor: 'rgba(255, 255, 255, 0.4)',
        borderTopColor: '#ffffff',
        marginBottom: 10,
    },
    overlayText: {
        fontSize: 32,
        color: '#ffffff',
        textAlign: 'center',
        fontWeight: 'bold',
        textShadowColor: 'rgba(0,0,0,0.7)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
    }
});