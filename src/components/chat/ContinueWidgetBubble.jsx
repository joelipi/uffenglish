import React, { useRef, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { DEFAULT_BOT_NAME, DEFAULT_AVATAR_URL } from '../../modules/user/tutor-config.js';
import { getBilingual } from '../../data/strings.js';

function BilingualLabel({ textKey, lang, fallback }) {
    const data = getBilingual(textKey, lang);
    if (!data.localized) {
        return <>{data.english}</>;
    }
    return (
        <>
            {data.english}
            <br />
            <span lang={data.lang}><i>{data.localized}</i></span>
        </>
    );
}

export default function ContinueWidgetBubble({ onClick, nextStepVideoUrl }) {
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const isCameraOff = useStore(appStore, (state) => state.isCameraOff);
    const lang = useStore(appStore, (state) => state.userData?.native_language) || 'en';
    const videoRef = useRef(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        setIsReady(false);
        const video = videoRef.current;
        if (!video || !nextStepVideoUrl) return;

        video.muted = true;
        video.playsInline = true;

        const onReady = () => {
            // Double rAF to ensure the first frame is painted before revealing.
            // See comment in IncomingVideoWidget for rationale.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsReady(true));
            });
        };
        video.addEventListener('loadeddata', onReady);

        // If the video is already cached and ready, set isReady immediately
        if (video.readyState >= 2) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsReady(true));
            });
        }

        return () => {
            video.removeEventListener('loadeddata', onReady);
        };
    }, [nextStepVideoUrl]);

    let iconClass = 'bi-camera-video-fill';
    let actionTextKey = 'widget_action_video';
    if (isTextMode) {
        iconClass = 'bi-keyboard-fill';
        actionTextKey = 'widget_action_text';
    } else if (isCameraOff) {
        iconClass = 'bi-telephone-fill';
        actionTextKey = 'widget_action_audio';
    }

    return (
        <div className="chat-message-row chat-message-row--system" id="continueButtonRow">
            <img src={DEFAULT_AVATAR_URL} alt={DEFAULT_BOT_NAME} className="chat-avatar-inline" onError={e => { e.currentTarget.src = DEFAULT_AVATAR_URL; }} />
            <div className="chat-message-bubble chat-message-bubble--system incoming-call-bubble">
                <div className="chat-bubble-header">{DEFAULT_BOT_NAME}</div>
                <div
                    id="lessonNextButton"
                    className={`incoming-video-widget${nextStepVideoUrl ? ' has-video-preview' : ''} ringing-animation`}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onClick) onClick();
                    }}
                >
                    {nextStepVideoUrl && (
                        <video
                            ref={videoRef}
                            className="continue-video-preview"
                            src={nextStepVideoUrl}
                            muted
                            playsInline
                            preload="auto"
                            crossOrigin="anonymous"
                            style={{ opacity: isReady ? 1 : 0, transition: 'opacity 0.15s ease-in' }}
                        />
                    )}
                    <div className="incoming-video-inner">
                        <div className="incoming-video-header">
                            <i className={`bi ${iconClass} text-info pulse-camera`}></i>
                            <span><BilingualLabel textKey="widget_incoming" lang={lang} fallback="INCOMING" /></span>
                        </div>
                        <div className="incoming-video-caller">
                            <span className="caller-name">{DEFAULT_BOT_NAME}</span>
                        </div>
                        <div className="incoming-video-btn-wrapper">
                            <div className="btn-pulse-ring"></div>
                            <button className="incoming-video-btn" aria-label="Answer Call">
                                <i className={`bi ${iconClass}`}></i>
                            </button>
                        </div>
                    </div>
                </div>
                <span id="caller-action"><BilingualLabel textKey={actionTextKey} lang={lang} fallback="Tap to answer..." /></span>
            </div>
        </div>
    );
}
