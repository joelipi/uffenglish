import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { DEFAULT_BOT_NAME, DEFAULT_AVATAR_URL } from '../../modules/tutor-config.js';
import Strings from '../../data/strings.js';

export default function ContinueWidgetBubble({ onClick }) {
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const isCameraOff = useStore(appStore, (state) => state.isCameraOff);
    const lang = useStore(appStore, (state) => state.userData?.native_language) || 'en';

    let iconClass = 'bi-camera-video-fill';
    let actionTextKey = 'widget_action_video';
    if (isTextMode) {
        iconClass = 'bi-keyboard-fill';
        actionTextKey = 'widget_action_text';
    } else if (isCameraOff) {
        iconClass = 'bi-telephone-fill';
        actionTextKey = 'widget_action_audio';
    }

    const incomingLabel = (typeof Strings !== 'undefined' && typeof Strings.get === 'function')
        ? (Strings.get('widget_incoming', lang) || 'INCOMING')
        : 'INCOMING';
    const actionText = (typeof Strings !== 'undefined' && typeof Strings.get === 'function')
        ? (Strings.get(actionTextKey, lang) || 'Tap to answer...')
        : 'Tap to answer...';

    return (
        <div className="chat-message-row chat-message-row--system" id="continueButtonRow">
            <img src={DEFAULT_AVATAR_URL} alt={DEFAULT_BOT_NAME} className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system incoming-call-bubble">
                <div className="chat-bubble-header">{DEFAULT_BOT_NAME}</div>
                <div
                    id="lessonNextButton"
                    className="incoming-video-widget ringing-animation"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onClick) onClick();
                    }}
                >
                    <div className="incoming-video-inner">
                        <div className="incoming-video-header">
                            <i className={`bi ${iconClass} text-info pulse-camera`}></i>
                            <span>{incomingLabel}</span>
                        </div>
                        <div className="incoming-video-caller">
                            <span className="caller-name">{DEFAULT_BOT_NAME}</span>
                            <span className="caller-action">{actionText}</span>
                        </div>
                        <div className="incoming-video-btn-wrapper">
                            <div className="btn-pulse-ring"></div>
                            <button className="incoming-video-btn" aria-label="Answer Call">
                                <i className={`bi ${iconClass}`}></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
