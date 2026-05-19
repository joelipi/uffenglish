import React, { useEffect, useState, useRef } from 'react';

export default function IndexPage() {

    useEffect(() => {
        const loadScript = (src) => {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.onload = resolve;
                script.onerror = reject;
                document.body.appendChild(script);
            });
        };

        const loadAllScripts = async () => {
            await loadScript('https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js');
        };
        loadAllScripts();

        return () => {
            // Optional: remove scripts on unmount if needed
        };
    }, []);


    useEffect(() => {
        (function () {
            window.preloadedMedia = {};

            window.preloadLessonAssets = function (lessonData, buildVideoUrlFn) {
                return new Promise(async (resolveApp) => {
                    let progress = 0;
                    const preloader = document.getElementById('appLoadingImageDiv');
                    const progressBar = document.getElementById('ui-progress-bar');
                    const loadingText = document.getElementById('ui-loading-text');

                    // Start the fake loading pulse
                    const progressInterval = setInterval(() => {
                        progress += (95 - progress) * 0.05;
                        if (progressBar) progressBar.style.width = progress + '%';
                    }, 100);

                    try {
                        // Pre-warm the first video
                        if (lessonData?.steps && lessonData.steps[0]) {
                            const firstStep = lessonData.steps[0];
                            const slugToWarm = firstStep.videoUrl || firstStep.simpleVideoUrl || firstStep.introBackgroundVideoUrl;
                            if (slugToWarm) fetch(buildVideoUrlFn(slugToWarm)).catch(() => { });
                        }

                        // Preload essential UI images
                        const imageUrls = [
                            'assets/img/header.png',
                            'assets/img/teacherprofile.webp'];

                        const imagePromises = imageUrls.map(url => new Promise(resolve => {
                            const img = new Image();
                            img.onload = resolve; img.onerror = resolve;
                            img.src = url;
                        }));

                        // Wait for images or 1.5 second timeout, whichever is faster
                        await Promise.race([Promise.all(imagePromises), new Promise(resolve => setTimeout(resolve, 1500))]);

                        // Finish the loading bar
                        clearInterval(progressInterval);
                        if (progressBar) progressBar.style.width = '100%';
                        if (loadingText) loadingText.innerText = 'Ready!';

                        setTimeout(() => {
                            resolveApp();
                        }, 250);

                    } catch (error) {
                        console.error("Failsafe unlocked preloader:", error);
                        clearInterval(progressInterval);
                        resolveApp();
                    }
                });
            };
        })();
    }, []);

    return (
        <div className="index-page-react-wrapper">
            {/* Translated JSX from index.html */}


    <div id="appLoadingImageDiv">
        <div className="appLoadingImage"></div>
        <div id="ui-progress-container">
            <div id="ui-progress-bar"></div>
        </div>
    </div>

    {/* RESTORED: App Loading & Pre-caching Script */}
    {/* Script logic moved to useEffect */}

    {/* AUTH LINK (hidden until needed) */}
    <a href="#" id="auth-link" className="d-none"></a>

    <main className="app-container d-flex justify-content-center align-items-center">

        <div className="video-frame position-relative shadow-lg">

            {/* Media Viewport: IVP, webcam preview, praise images, YouTube */}
            <div id="media-viewport" className="position-absolute top-0 start-0 w-100 h-100 d-none">
                <div id="ivp-container">
                    <div className="ivp-main-wrapper loading" id="ivp-main-wrapper">
                        <div className="ivp-video-wrapper">
                            <video className="ivp-video" playsInline crossOrigin="anonymous"></video>
                            <div className="ivp-blur-overlay"></div>
                            <div className="ivp-subtitles"></div>
                        </div>
                    </div>
                </div>
                <div id="simple-video-container"></div>
                <div id="intro-call-widget" className="intro-video-wrapper d-none">
                    <div className="pulse-ring-wrapper">
                        <div className="pulse-ring"></div>
                        <div className="intro-video-container ringing-animation">
                            <video className="intro-video" playsInline preload="auto" crossOrigin="anonymous" muted></video>
                            <div className="intro-notification-content">
                                <div className="intro-notification-top">
                                    <div className="intro-call-title">
                                        <i className="bi bi-camera-video-fill text-info"></i>
                                        <span id="intro-title">Ringing...</span>
                                    </div>
                                    <div className="intro-call-subtitle"><span lang="es"><i id="intro-subtitle"></i></span>
                                    </div>
                                </div>
                                <div className="intro-notification-bottom">
                                    <div className="intro-caller-name" id="intro-name">Joe Walsh</div>
                                    <div className="intro-caller-title" id="intro-role">English Coach, UFF</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>


            {/* Critical Error Container (Hardcoded) */}
            <div id="criticalErrorContainer"
                className="d-none w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-white text-center">
                <i className="bi bi-exclamation-triangle-fill text-warning mb-3"></i>
                <h4 className="mb-2">Lesson Load Error</h4>
                <p id="criticalErrorMessage" className="text-secondary mb-4"></p>
                <button className="btn btn-primary px-4 rounded-pill" onClick={() => { window.location.reload() }}>
                    <i className="bi bi-arrow-clockwise"></i> Try Again
                </button>
            </div>

            {/* Whisper Review UI (Hardcoded Overlay) */}
            <div id="whisperReviewContainer"
                className="d-none position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-white text-center">
                <div className="whisper-review-box bg-dark p-4 rounded border border-secondary shadow-lg">
                    <div className="mb-3">
                        <div id="whisperTranscript" className="mb-3"></div>
                    </div>
                    <div className="progress whisper-progress mb-4">
                        <div id="reviewProgressBar" className="progress-bar bg-success" role="progressbar"></div>
                    </div>
                    <div className="d-flex justify-content-center gap-3">
                        <button id="rejectBtn" className="btn btn-outline-danger px-4 rounded-pill">
                            <i className="bi bi-arrow-counterclockwise"></i> Re-record
                        </button>
                        <button id="acceptBtn" className="btn btn-primary px-4 rounded-pill">
                            <i className="bi bi-check2"></i> Accept (<span id="reviewTimer"></span>s)
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Remote Video Player */}
            <video id="callVideo" className="w-100 h-100 object-fit-cover d-none" playsInline></video>

            {/* Self-View (Picture-in-Picture) */}
            <div className="pip-container shadow d-none" id="pip-wrapper">
                <video id="webcam-preview" autoPlay muted playsInline></video>
            </div>

            {/* Top Overlay */}
            <div className="top-overlay position-absolute top-0 start-0 w-100 px-3 py-2 z-1">
                <div id="closeAndProgress" className="w-100 text-shadow">

                    {/* Top Row: Close Button & Progress Bar (Spanning full width) */}
                    <div className="d-flex align-items-center w-100 mb-0">
                        <a href="homescreen.html" id="closePage"
                            className="d-flex align-items-center text-decoration-none flex-shrink-0" aria-label="Close">
                            <i className="bi bi-x-lg"></i>
                        </a>
                        <div className="flex-grow-1 ms-3">
                            <div id="progress" className="progress shadow-sm">
                                <div id="progress-bar" className="progress-bar" role="progressbar" style={{'width': '0%'}}
                                    aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Row: Bot Stats (Spread out columns with Listening centered) */}
                    <div id="stats-container" className="row w-100 mx-0 mt-0 text-white stats-container d-none">
                        {/* Pronunciation (left) */}
                        <div className="col-4 d-flex align-items-center justify-content-center px-2">
                            <div title="Pronunciation" className="d-flex flex-column align-items-center w-100">
                                <div className="chat-bubble-header stats-header-label">PRONUNCIATION</div>
                                <span id="pronunciationScore" className="bot-score">100</span>
                            </div>
                        </div>
                        {/* Listening (centered) */}
                        <div className="col-4 d-flex align-items-center justify-content-center px-2">
                            <div title="Listening" className="d-flex flex-column align-items-center w-100">
                                <div className="chat-bubble-header stats-header-label">LISTENING</div>
                                <span id="listeningScore" className="bot-score">100</span>
                            </div>
                        </div>
                        {/* Flow (right) */}
                        <div className="col-4 d-flex align-items-center justify-content-center px-2">
                            <div title="Flow" className="d-flex flex-column align-items-center w-100">
                                <div className="chat-bubble-header stats-header-label">SPEAKING FLOW</div>
                                <span id="flowScore" className="bot-score">100</span>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* HIDDEN FUNCTIONAL ELEMENTS */}
            <video id="originalVideo" src="" className="d-none"></video>
            <video id="resultVideo" className="d-none"></video>
            <canvas id="videoCanvas" className="d-none"></canvas>
            <img id="overlayImage" src="assets/img/header.png" className="d-none" />

            {/* RESTORED: Playback Video Elements */}
            <div id="playback-video-wrapper" className="playback-video-container position-relative d-none">
                <video id="playback-video" playsInline preload="auto" loop></video>
                <button id="playback-mute-toggle" className="playback-mute-toggle position-absolute bottom-0 end-0 m-1">
                    <i className="bi bi-volume-up-fill"></i>
                </button>
            </div>

            <div id="micStatusText" className="d-flex justify-content-center align-items-center"></div>

            {/* Chat Window Container */}
            <div id="chat-window-container">
                <div id="chat-window-header" className="card-header text-white p-0 chat-window-header"></div>

                {/* CLEAN, EMPTY CONTAINER FOR PRODUCTION JS */}
                <div id="chat-message-list" className="card-body chat-message-list text-dark">
                </div>

                {/* Chat Input Footer */}
                <div id="chat-input-area" className="card-footer bg-white border-top-0 w-100">
                    <div className="input-group">
                        <textarea id="chat-input-field" className="form-control" rows="2"
                            placeholder="Ask your tutor a question..."></textarea>
                        <button id="chat-send-button" className="btn btn-primary" type="button">
                            <i className="bi bi-send-fill"></i>
                        </button>
                    </div>
                </div>
            </div>

            {/* Permanent Answer Input Area (for text-input steps; this is distinct from the chat) */}
            <div id="answer-input-area" className="d-none position-absolute w-100 p-3 z-3">
                <div className="card bg-dark border-secondary shadow-lg">
                    <div className="card-body p-2 d-flex align-items-center gap-2">
                        <div className="flex-grow-1 d-flex flex-column">
                            <textarea id="answer-input-field" className="form-control bg-dark text-white border-secondary"
                                rows="2" placeholder="Type your answer..."></textarea>
                            <div id="answer-error-message" className="text-danger small mt-1 d-none"></div>
                        </div>
                        <button id="answer-submit-button">
                            <i className="bi bi-send-fill"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div id="hints" className="d-none card">
                <p className="info-content" id="hintUncommonWords"></p>
            </div>
            {/* Bottom Overlay */}
            <div className="bottom-overlay position-absolute bottom-0 start-0 w-100 d-flex flex-column">

                {/* Layer 1: The Reflecting Pool */}
                <div className="reflecting-pool-bg"></div>

                {/* Layer 2: The Unmasked Content */}
                <div className="bottom-overlay-content">
                    <div className="mission-section" id="mission-section">
                        <div className="mission-row text-shadow">
                            <div className="d-flex align-items-baseline flex-grow-1 overflow-hidden">
                                <span className="mission-label">Mission</span>
                                <span className="mission-text"></span>
                                <span className="mission-label">Where</span>
                                <span className="setting-text"></span>
                                <span className="mission-label">You are</span>
                                <span className="roleUser-text"></span>
                                <span className="mission-label">Talking to</span>
                                <span className="roleOther-text"></span>
                            </div>
                            <div className="mission-toggle-icon">
                                <i className="bi bi-chevron-up" id="mission-carat"></i>
                            </div>
                        </div>
                    </div>

                    <div className="controls-section">
                        <div className="d-flex justify-content-between align-items-center w-100">

                            {/* LEFT: Friend Button */}
                            <button className="btn call-btn" id="friendBtn" aria-label="Contact Friend">
                                <img src="assets/img/userprofile.png" alt="Friend Profile" className="friend-img" />
                            </button>

                            {/* CENTER STATE 1: Standard Mic (Visible by default) */}
                            <div className="mic-btn-wrapper" id="state-standard-mic">
                                <div className="mic-ring"></div>
                                <div className="mic-ring"></div>
                                <div className="mic-ring"></div>
                                <button className="btn call-btn toggled-off" id="micBtn" aria-label="Toggle Microphone">
                                    <i className="bi bi-mic-mute-fill"></i>
                                </button>
                                <button className="btn call-btn d-none" id="txtBtn" aria-label="Toggle Text Input">
                                    <i className="bi bi-keyboard-fill"></i>
                                </button>
                            </div>

                            {/* CENTER STATE 2: Intro Choices (Hidden by default) */}
                            <div className="d-flex gap-3 align-items-center d-none" id="state-intro-choices">
                                <button className="btn call-icon" id="audioOnlyButton" aria-label="Audio Only">
                                    <i className="bi bi-telephone-fill text-white"></i>
                                </button>
                                <button className="btn call-btn btn-primary" id="continueButton" aria-label="Video Call">
                                    <i className="bi bi-camera-video-fill"></i>
                                </button>
                                <button className="btn call-icon" id="textOnlyButton" aria-label="Text Only">
                                    <i className="bi bi-keyboard text-white"></i>
                                </button>
                            </div>

                            {/* CENTER STATE 3: (End of) Lesson Success (Hidden by default) */}
                            <div className="d-flex gap-3 align-items-center d-none" id="state-lesson-success">

                                <button className="btn btn-outline-primary w-100 text-white" id="createVideoButton"
                                    aria-label="Create Video">
                                    <i className="bi bi-film text-white"></i>
                                </button>

                            </div>

                            {/* RIGHT: Help Button */}
                            <button className="btn call-btn" id="helpBtn" aria-label="Help">
                                <i className="bi bi-question-circle-fill"></i>
                            </button>

                        </div>
                    </div>
                </div>

            </div>
        </div>
    </main>

    {/* DIALOG: Guest Login Welcome Modal (Native <dialog>, styled cleanly) */}
    <dialog id="guestLoginModal">
        <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content bg-dark text-white border-light shadow-lg">
                <div className="modal-header border-secondary">
                    <h5 className="modal-title" id="guestLoginModalLabel"><i
                            className="bi bi-shield-lock-fill text-warning me-2"></i><span
                            id="guestLoginModalTitleText">Welcome!</span></h5>
                </div>
                <div className="modal-body">
                    <p className="text-light" id="guestLoginModalBodyText">You are currently not logged in. Log in or sign
                        up to save your progress and
                        access all features. Or, continue as a guest to try out the app.</p>
                    <div className="d-grid gap-2 mt-4">
                        <a href="login.html" id="guestLoginBtn" className="btn btn-primary">
                            <i className="bi bi-box-arrow-in-right me-1"></i><span id="guestLoginBtnText">Log In</span>
                        </a>
                        <a href="signup.html" id="guestSignupBtn" className="btn btn-secondary">
                            <i className="bi bi-person-plus-fill me-1"></i><span id="guestSignupBtnText">Sign Up</span>
                        </a>
                        <button type="button" className="btn btn-outline-light mt-2" id="guestContinueBtn">
                            <span id="guestContinueBtnText">Continue as Guest</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </dialog>

    {/* Bootstrap 5 JS Bundle */}


    {/* App Module */}


        </div>
    );
}
