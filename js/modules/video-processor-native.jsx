// --- modules/video-processor-native.jsx ---
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableWithoutFeedback,
    Share, ActivityIndicator
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import { VideoRenderPlanner } from './video-processor-logic.js';

const REMOTE_BASE_URL = 'https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F';

/**
 * Native equivalent of initVideoProcessor.
 *
 * Replicates the web's zero-wait illusion:
 *   - Plays all segments sequentially as a lesson review (user watches)
 *   - Simultaneously stitches the final video in the background via FFmpegKit
 *   - Share button appears the moment playback ends, by which point stitching
 *     is usually already complete
 *
 * Usage:
 *   <VideoProcessor
 *     recordings={recordings}
 *     configData={configData}
 *     fluencyData={fluencyData}
 *     lessonId={lessonId}
 *     onComplete={handleComplete}
 *   />
 */
export function VideoProcessor({
    recordings,
    configData,
    fluencyData = { total: 'NA' },
    lessonId,
    onComplete
}) {
    // --- Plan ---
    const plannerRef = useRef(new VideoRenderPlanner(recordings, configData, fluencyData));
    const renderPlan = useRef(plannerRef.current.generatePlan());

    // --- Playback state ---
    const [currentIndex, setCurrentIndex] = useState(0);
    const [subtitle, setSubtitle] = useState('');
    const [isTailing, setIsTailing] = useState(false);
    const [playbackDone, setPlaybackDone] = useState(false);

    // --- Stitch state ---
    const [stitchDone, setStitchDone] = useState(false);
    const [outputUri, setOutputUri] = useState(null);
    const stitchError = useRef(null);

    // --- Resolved local URIs for all segments ---
    // We resolve eagerly so playback and stitching both have what they need
    const resolvedSegments = useRef([]);
    const [segmentsReady, setSegmentsReady] = useState(false);

    const currentStep = renderPlan.current[currentIndex] ?? null;

    // --- expo-video player ---
    const player = useVideoPlayer(
        segmentsReady ? resolvedSegments.current[currentIndex]?.uri ?? null : null,
        p => {
            p.loop = false;
            p.muted = false;
        }
    );

    // -------------------------------------------------------------------------
    // 1. Segment Resolution
    //    Runs once on mount. Downloads any uncached remote segments,
    //    copies webcam URIs, generates tailing placeholder.
    //    Kicks off stitching as soon as resolution is complete.
    // -------------------------------------------------------------------------
    useEffect(() => {
        let cancelled = false;

        async function resolveSegments() {
            const plan = renderPlan.current;
            const resolved = [];

            for (let i = 0; i < plan.length; i++) {
                if (cancelled) return;
                const step = plan[i];

                if (step.type === 'remote') {
                    // Check preloaded cache first, then local fs cache, then download
                    const cacheKey = step.targetId;
                    const localPath = `${FileSystem.cacheDirectory}segment_${cacheKey}.mp4`;
                    const exists = await FileSystem.getInfoAsync(localPath);

                    if (exists.exists) {
                        resolved.push({ uri: localPath, trim: null, step });
                    } else {
                        const remoteUrl = `${REMOTE_BASE_URL}${encodeURIComponent(cacheKey)}.mp4?alt=media`;
                        const { uri } = await FileSystem.downloadAsync(remoteUrl, localPath);
                        resolved.push({ uri, trim: null, step });
                    }

                } else if (step.type === 'webcam') {
                    // Copy to stable cache path so FFmpeg can access it reliably
                    const destPath = `${FileSystem.cacheDirectory}webcam_${lessonId}_${i}.mp4`;
                    await FileSystem.copyAsync({ from: step.uri, to: destPath });
                    resolved.push({ uri: destPath, trim: step.trim, step });

                } else if (step.type === 'tailing') {
                    // Tailing has no real video source — handled in UI as an overlay
                    // We generate a short black segment for the stitch only
                    const tailPath = `${FileSystem.cacheDirectory}tail_${lessonId}.mp4`;
                    const fluencyLabel = String(fluencyData?.total ?? '');
                    const cmd = [
                        '-f', 'lavfi',
                        '-i', 'color=c=black:s=1280x720:d=4',
                        '-vf', `drawtext=text='${fluencyLabel}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2`,
                        '-c:v', 'libx264',
                        '-t', '4',
                        '-y', tailPath
                    ].join(' ');

                    const session = await FFmpegKit.execute(cmd);
                    const code = await session.getReturnCode();
                    if (!ReturnCode.isSuccess(code)) throw new Error('Tail segment generation failed');

                    resolved.push({ uri: tailPath, trim: null, step });
                }
            }

            if (!cancelled) {
                resolvedSegments.current = resolved;
                setSegmentsReady(true);

                // Kick off background stitch immediately —
                // user is now watching the playback review
                runBackgroundStitch(resolved);
            }
        }

        resolveSegments().catch(e => {
            console.error('[VideoProcessor] Segment resolution failed:', e);
        });

        return () => { cancelled = true; };
    }, []);

    // -------------------------------------------------------------------------
    // 2. Background Stitch
    //    Runs concurrently with playback. By the time the user finishes
    //    watching, the file is ready to share.
    // -------------------------------------------------------------------------
    async function runBackgroundStitch(segments) {
        try {
            const manifestPath = `${FileSystem.cacheDirectory}concat_${lessonId}.txt`;
            const manifest = segments.map(({ uri }) => `file '${uri}'`).join('\n');
            await FileSystem.writeAsStringAsync(manifestPath, manifest);

            const outputPath = `${FileSystem.cacheDirectory}final_${lessonId}_${Date.now()}.mp4`;

            const cmd = [
                '-f', 'concat',
                '-safe', '0',
                '-i', manifestPath,
                '-c', 'copy',   // Stream copy — fast, no re-encode
                '-y',
                outputPath
            ].join(' ');

            const session = await FFmpegKit.execute(cmd);
            const code = await session.getReturnCode();

            if (!ReturnCode.isSuccess(code)) {
                const logs = await session.getLogs();
                throw new Error(logs.map(l => l.getMessage()).join('\n'));
            }

            setOutputUri(outputPath);
            setStitchDone(true);
        } catch (e) {
            stitchError.current = e;
            console.error('[VideoProcessor] Background stitch failed:', e);
            setStitchDone(true); // Still mark done so UI unblocks
        }
    }

    // -------------------------------------------------------------------------
    // 3. Sequential Playback
    //    Each segment plays to completion, then advances to the next.
    //    Trim timestamps are enforced via a time update listener.
    //    Tailing step skips video and shows the fluency overlay directly.
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!segmentsReady || !currentStep) return;

        // Tailing step: no video, just show overlay for durationMs
        if (currentStep.type === 'tailing') {
            setIsTailing(true);
            setSubtitle('');
            const timer = setTimeout(() => {
                setPlaybackDone(true);
            }, currentStep.durationMs);
            return () => clearTimeout(timer);
        }

        setIsTailing(false);
        setSubtitle(currentStep.subtitle ?? '');
        player.play();

        // Enforce trim end via time update
        const trimSub = currentStep.trim
            ? player.addTimeUpdateListener(({ currentTime }) => {
                if (currentTime >= currentStep.trim.end) {
                    advanceToNext();
                }
            })
            : null;

        const statusSub = player.addStatusChangeListener(status => {
            if (status === 'ended') advanceToNext();
        });

        return () => {
            trimSub?.remove();
            statusSub?.remove();
        };
    }, [currentIndex, segmentsReady]);

    const advanceToNext = useCallback(() => {
        const nextIndex = currentIndex + 1;
        if (nextIndex >= renderPlan.current.length) {
            setPlaybackDone(true);
        } else {
            setCurrentIndex(nextIndex);
        }
    }, [currentIndex]);

    // -------------------------------------------------------------------------
    // 4. Completion
    //    Called when playback is done. If stitch isn't ready yet,
    //    we wait — this should be rare given segments are usually cached.
    // -------------------------------------------------------------------------
    const handleShare = useCallback(async () => {
        if (!outputUri) return;
        try {
            await Share.share({ url: outputUri, title: 'My Lesson Review' });
            onComplete?.();
        } catch (e) {
            console.error('[VideoProcessor] Share failed:', e);
        }
    }, [outputUri, onComplete]);

    const handleSaveToLibrary = useCallback(async () => {
        if (!outputUri) return;
        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') return;
            await MediaLibrary.createAssetAsync(outputUri);
            onComplete?.();
        } catch (e) {
            console.error('[VideoProcessor] Save failed:', e);
        }
    }, [outputUri, onComplete]);

    // -------------------------------------------------------------------------
    // 5. Render
    // -------------------------------------------------------------------------

    // Not yet resolved — brief loading state before playback begins
    if (!segmentsReady) {
        return (
            <View style={styles.loadingWrapper}>
                <ActivityIndicator size="large" color="#fff" />
            </View>
        );
    }

    // Playback complete — show share UI, matching web bottomButtonBarSuccess
    if (playbackDone) {
        return (
            <View style={styles.completionWrapper}>
                {!stitchDone ? (
                    // Stitch still running — rare but possible on slow devices
                    <View style={styles.stitchingRow}>
                        <ActivityIndicator size="small" color="#fff" />
                        <Text style={styles.stitchingText}>Preparing your video…</Text>
                    </View>
                ) : stitchError.current ? (
                    <Text style={styles.errorText}>Video export failed. Please try again.</Text>
                ) : (
                    <View style={styles.shareRow}>
                        <TouchableWithoutFeedback onPress={handleShare}>
                            <View style={styles.shareButton}>
                                <Text style={styles.shareButtonText}>Share</Text>
                            </View>
                        </TouchableWithoutFeedback>
                        <TouchableWithoutFeedback onPress={handleSaveToLibrary}>
                            <View style={[styles.shareButton, styles.saveButton]}>
                                <Text style={styles.shareButtonText}>Save to Camera Roll</Text>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                )}
            </View>
        );
    }

    // Tailing step — fluency score overlay, no video
    if (isTailing) {
        return (
            <View style={styles.tailingWrapper}>
                <Text style={styles.tailingScore}>{fluencyData?.total ?? ''}</Text>
                <Text style={styles.tailingLabel}>Fluency Score</Text>
            </View>
        );
    }

    // Active playback
    return (
        <View style={styles.wrapper}>
            <VideoView
                player={player}
                style={styles.video}
                nativeControls={false}
                contentFit="contain"
            />
            {subtitle ? (
                <View style={styles.subtitleOverlay} pointerEvents="none">
                    <Text style={styles.subtitleText}>{subtitle}</Text>
                </View>
            ) : null}
        </View>
    );
}

// -------------------------------------------------------------------------
// Platform router — mirrors media.js / interactive-video-player.js pattern
// -------------------------------------------------------------------------
// In media.js you'd add:
//   export { VideoProcessor } from './video-processor-native.jsx';   // .native.js
//   export { initVideoProcessor } from './video-processor-web.js';   // .web.js

const styles = StyleSheet.create({
    wrapper: {
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: '#000',
        position: 'relative',
        overflow: 'hidden',
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
        height: '35%',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    subtitleText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center',
        lineHeight: 24,
    },
    tailingWrapper: {
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    tailingScore: {
        color: '#fff',
        fontSize: 72,
        fontWeight: '700',
    },
    tailingLabel: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 18,
        marginTop: 8,
    },
    loadingWrapper: {
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    completionWrapper: {
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: '#111',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    stitchingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    stitchingText: {
        color: '#fff',
        fontSize: 16,
    },
    shareRow: {
        gap: 12,
        width: '100%',
        alignItems: 'center',
    },
    shareButton: {
        backgroundColor: '#2563eb',
        paddingVertical: 14,
        paddingHorizontal: 32,
        borderRadius: 8,
        width: '80%',
        alignItems: 'center',
    },
    saveButton: {
        backgroundColor: '#16a34a',
    },
    shareButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    errorText: {
        color: '#f87171',
        fontSize: 16,
        textAlign: 'center',
    },
});