import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';

let _videoEl = null;
let _wrapperEl = null;
let _muteToggleEl = null;

export function getPlaybackVideoElement() { return _videoEl; }
export function getPlaybackVideoWrapper() { return _wrapperEl; }
export function getPlaybackMuteToggle() { return _muteToggleEl; }

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PlaybackVideo() {
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const muteRef = useRef(null);
    const observerRef = useRef(null);

    const blob = useStore(appStore, (s) => s.playbackBlob);
    const autoplay = useStore(appStore, (s) => s.playbackAutoplay);
    const speechCamChunks = useStore(appStore, (s) => s.playbackSpeechCamChunks);
    const isMuted = useStore(appStore, (s) => s.isPlaybackMuted);
    const videoPlayTrigger = useStore(appStore, (s) => s.videoPlayTrigger);
    const videoClearTrigger = useStore(appStore, (s) => s.videoClearTrigger);
    const prevPlayTrigger = useRef(videoPlayTrigger);
    const prevClearTrigger = useRef(videoClearTrigger);

    useEffect(() => {
        _videoEl = videoRef.current;
        _wrapperEl = wrapperRef.current;
        _muteToggleEl = muteRef.current;
        return () => {
            _videoEl = null;
            _wrapperEl = null;
            _muteToggleEl = null;
        };
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (video.src && video.src.startsWith('blob:')) {
            URL.revokeObjectURL(video.src);
        }

        if (!blob) {
            video.src = '';
            video.load();
            const wrapper = wrapperRef.current;
            if (wrapper) wrapper.style.display = 'none';
            return;
        }

        if (isIOS) {
            video.controls = true;
            video.loop = true;
            const url = URL.createObjectURL(blob);
            video.onerror = () => {
                try {
                    const alternativeBlob = new Blob([blob], { type: 'video/mp4' });
                    video.src = URL.createObjectURL(alternativeBlob);
                } catch (e) { }
            };
            video.src = url;
            video.onloadeddata = () => { };
        } else {
            video.src = URL.createObjectURL(blob);
            video.onerror = null;
        }

        video.controls = false;
        video.loop = true;
        video.autoplay = false;
        video.preload = 'auto';
        video.muted = appStore.getState().isPlaybackMuted || false;
        video.style.cursor = 'pointer';

        if (video._interactionHandler) {
            video.removeEventListener('touchstart', video._interactionHandler);
            video.removeEventListener('click', video._interactionHandler);
        }
        video._interactionHandler = function (e) {
            e.preventDefault(); e.stopPropagation();
            requestAnimationFrame(() => {
                if (this.paused) {
                    this.play().catch(e => {
                        this.currentTime = 0;
                        setTimeout(() => this.play().catch(console.error), 100);
                    });
                } else {
                    this.pause();
                }
            });
        };
        video.addEventListener('touchstart', video._interactionHandler, { passive: false });
        video.addEventListener('click', video._interactionHandler);

        video.onloadedmetadata = () => {
            const wrapper = wrapperRef.current;
            if (wrapper) {
                wrapper.classList.remove('d-none');
                wrapper.style.display = 'flex';

                wrapper.style.width = '';
                wrapper.style.height = '';
                video.style.width = '';
                video.style.height = '';
                video.style.maxHeight = '';
                video.style.borderRadius = '';
                video.style.objectFit = '';

                wrapper.style.position = 'absolute';
                wrapper.style.top = '15%';
                wrapper.style.left = '0';
                wrapper.style.right = '0';
                wrapper.style.zIndex = '5';
            }

            video.style.display = 'block';

            if (autoplay || appStore.getState().playbackAutoplay) {
                video.play().catch(e => {
                    if (e.name === 'NotAllowedError') {
                        video.muted = true;
                        appStore.getState().setPlaybackMuted(true);
                        const muteToggle = muteRef.current;
                        if (muteToggle) {
                            const icon = muteToggle.querySelector('i');
                            if (icon) icon.className = 'bi bi-volume-mute-fill';
                        }
                        video.play().catch(err => console.error('[Playback] muted fallback failed:', err));
                    }
                });
            }

            if (observerRef.current) observerRef.current.disconnect();
            observerRef.current = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting && !video.paused) {
                        video.pause();
                    }
                });
            }, { threshold: 0.1 });
            requestAnimationFrame(() => {
                if (observerRef.current && video) {
                    observerRef.current.observe(video);
                }
            });
        };
    }, [blob]);

    useEffect(() => {
        if (!muteRef.current) return;
        const muteToggle = muteRef.current;
        const video = videoRef.current;
        const icon = muteToggle.querySelector('i');

        if (blob) {
            muteToggle.classList.remove('d-none');
        } else {
            muteToggle.classList.add('d-none');
            return;
        }

        if (icon) {
            icon.className = isMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
        }

        muteToggle.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wasMuted = appStore.getState().isPlaybackMuted;
            appStore.getState().setPlaybackMuted(!wasMuted);
            if (video) video.muted = !wasMuted;
            if (icon) {
                icon.className = !wasMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
            }
        };
    }, [blob, isMuted]);

    useEffect(() => {
        if (videoClearTrigger === prevClearTrigger.current) return;
        prevClearTrigger.current = videoClearTrigger;
        const video = videoRef.current;
        const wrapper = wrapperRef.current;
        const muteToggle = muteRef.current;

        if (video) {
            video.pause();
            if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
            video.src = '';
            video.load();
            video.style.display = 'none';
            video.onerror = null;
            video.onloadeddata = null;
            video.onloadedmetadata = null;
        }
        if (wrapper) wrapper.style.display = 'none';
        if (muteToggle) muteToggle.classList.add('d-none');
    }, [videoClearTrigger]);

    useEffect(() => {
        if (videoPlayTrigger === prevPlayTrigger.current) return;
        prevPlayTrigger.current = videoPlayTrigger;
        const video = videoRef.current;
        if (video) {
            video.muted = appStore.getState().videoPlayMuted;
            video.play().catch(e => console.warn('[playback] Playback resume failed:', e));
        }
    }, [videoPlayTrigger]);

    const chatModeActive = useStore(appStore, (s) => s.chatModeActive);
    const prevChatRef = useRef(chatModeActive);

    useEffect(() => {
        if (chatModeActive === prevChatRef.current) return;
        prevChatRef.current = chatModeActive;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        if (chatModeActive) {
            wrapper.style.setProperty('display', 'none', 'important');
        } else {
            wrapper.style.removeProperty('display');
        }
    }, [chatModeActive]);

    return (
        <div ref={wrapperRef} id="playback-video-wrapper"
            className="playback-video-container d-none"
            style={{ position: 'absolute', top: '15%', left: 0, right: 0, zIndex: 5 }}>
            <video ref={videoRef} id="playback-video" playsInline preload="auto" loop />
            <button ref={muteRef} id="playback-mute-toggle" className="playback-mute-toggle position-absolute bottom-0 end-0 m-1 d-none">
                <i className="bi bi-volume-up-fill"></i>
            </button>
        </div>
    );
}
