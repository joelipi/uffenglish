// components/simple-video-player.native.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback, ScrollView } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { VideoStateController } from '../modules/video-controller.js';

/**
 * Native equivalent of SimpleVideoPlayer + SimpleVideoPlayerUI.
 * Driven by the same VideoStateController as the web version.
 *
 * Usage:
 *   <SimpleVideoPlayer
 *     videoUrl="https://..."
 *     subtitles="Full transcript text here..."
 *     scrollSpeed={1.0}
 *     scrollSubtitles={true}
 *   />
 */
export function SimpleVideoPlayer({
    videoUrl,
    subtitles = '',
    scrollSpeed = 1.0,
    scrollSubtitles = true,
    style
}) {
    // --- Controller (pure logic, shared with web) ---
    const controllerRef = useRef(
        new VideoStateController({ scrollSpeed, scrollSubtitles })
    );

    // --- Reactive UI state, driven by controller subscriptions ---
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [scrollRatio, setScrollRatio] = useState(0);

    // --- Subtitle scroll ---
    // On native we use a ScrollView driven programmatically,
    // equivalent to the translateY approach in the web version.
    const scrollViewRef = useRef(null);
    const subtitleContentHeight = useRef(0);
    const subtitleContainerHeight = useRef(0);

    // --- expo-video player ---
    const player = useVideoPlayer(videoUrl, p => {
        p.loop = false;
        p.muted = true;
        p.play();
    });

    // --- Subscribe controller → UI state ---
    useEffect(() => {
        const unsub = controllerRef.current.subscribe(state => {
            setIsPlaying(state.isPlaying);
            setIsLoaded(state.isLoaded);
            setScrollRatio(state.scrollRatio);
        });
        return unsub;
    }, []);

    // --- Drive subtitle scroll position from scrollRatio ---
    useEffect(() => {
        if (!scrollViewRef.current || !scrollSubtitles) return;

        const maxScroll = subtitleContentHeight.current - subtitleContainerHeight.current;
        if (maxScroll <= 0) return;

        const targetY = scrollRatio * maxScroll;
        scrollViewRef.current.scrollTo({ y: targetY, animated: true });
    }, [scrollRatio, scrollSubtitles]);

    // --- Video status events → controller ---
    useEffect(() => {
        const statusSub = player.addStatusChangeListener(status => {
            if (status === 'playing') controllerRef.current.play();
            if (status === 'paused') controllerRef.current.pause();
        });
        return () => statusSub.remove();
    }, [player]);

    // --- Time updates → controller (drives subtitle scroll) ---
    useEffect(() => {
        // expo-video fires timeUpdate frequently enough for smooth scrolling
        const timeSub = player.addTimeUpdateListener(({ currentTime }) => {
            controllerRef.current.updateProgress(currentTime, player.duration);
        });
        return () => timeSub.remove();
    }, [player]);

    // --- Loaded event → controller ---
    useEffect(() => {
        const loadedSub = player.addOnLoadedListener(() => {
            controllerRef.current.setLoaded();
        });

        // FOUC fallback — mirrors the 3000ms timeout in the web version
        const fallback = setTimeout(() => controllerRef.current.setLoaded(), 3000);

        return () => {
            loadedSub.remove();
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

                {/* Play overlay — shown when paused, matching web ivp-play-overlay */}
                {!isPlaying && (
                    <View style={styles.playOverlay} pointerEvents="none">
                        <View style={styles.playIconContainer}>
                            {/* Triangle play icon, matching the SVG in the web version */}
                            <View style={styles.playTriangle} />
                        </View>
                    </View>
                )}

                {/* Subtitle scroll area — programmatically scrolled via scrollRatio */}
                {subtitles ? (
                    <View
                        style={styles.subtitleScrollContainer}
                        onLayout={e => {
                            subtitleContainerHeight.current = e.nativeEvent.layout.height;
                        }}
                        pointerEvents="none"
                    >
                        <ScrollView
                            ref={scrollViewRef}
                            scrollEnabled={false}  // User cannot manually scroll; driven by time
                            showsVerticalScrollIndicator={false}
                        >
                            <Text
                                style={styles.subtitleText}
                                onLayout={e => {
                                    subtitleContentHeight.current = e.nativeEvent.layout.height;
                                }}
                            >
                                {subtitles}
                            </Text>
                        </ScrollView>
                    </View>
                ) : null}

            </View>
        </TouchableWithoutFeedback>
    );
}

const PLAY_TRIANGLE_SIZE = 24;

const styles = StyleSheet.create({
    wrapper: {
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: '#000',
        position: 'relative',
        overflow: 'hidden',
    },
    hidden: {
        opacity: 0, // Mirrors web visibility:hidden — keeps player alive but invisible
    },
    video: {
        width: '100%',
        height: '100%',
    },

    // --- Play overlay ---
    playOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.15)',
    },
    playIconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    // CSS triangle technique in React Native
    playTriangle: {
        width: 0,
        height: 0,
        borderTopWidth: PLAY_TRIANGLE_SIZE / 2,
        borderBottomWidth: PLAY_TRIANGLE_SIZE / 2,
        borderLeftWidth: PLAY_TRIANGLE_SIZE,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: '#fff',
        marginLeft: 4, // Optical centering
    },

    // --- Subtitle scroll area ---
    subtitleScrollContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: '40%',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    subtitleText: {
        color: '#fff',
        fontSize: 14,
        lineHeight: 22,
        textAlign: 'left', // Matches typical subtitle/transcript style
    },
});