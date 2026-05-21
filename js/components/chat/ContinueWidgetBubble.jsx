import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
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

    let incomingLabel = 'INCOMING';
    let actionText = 'Tap to answer...';
    if (typeof Strings !== 'undefined' && typeof Strings.get === 'function') {
        incomingLabel = Strings.get('widget_incoming', lang) || incomingLabel;
        actionText = Strings.get(actionTextKey, lang) || actionText;
    }

    return (
        <div className="chat-message-row chat-message-row--system" id="continueButtonRow">
            <img src="/assets/img/teacherprofile.webp" alt="Joe Walsh" className="chat-avatar-inline" />
            <div className="chat-message-bubble chat-message-bubble--system incoming-call-bubble">
                <div className="chat-bubble-header">Joe Walsh</div>
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
                            <span dangerouslySetInnerHTML={{ __html: incomingLabel }} />
                        </div>
                        <div className="incoming-video-caller">
                            <span className="caller-name">Joe Walsh</span>
                            <span className="caller-action" dangerouslySetInnerHTML={{ __html: actionText }} />
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