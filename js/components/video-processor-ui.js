export const DOM = {
    get bottomButtonBar() { return document.getElementById('bottomButtonBar'); },
    get bottomButtonBarSuccess() { return document.getElementById('bottomButtonBarSuccess'); },
    get micStatusText() { return document.getElementById('micStatusText'); },
    get originalVideo() { return document.getElementById('originalVideo'); },
    get processBtn() { return document.getElementById('processBtn'); },
    get resultVideo() { return document.getElementById('resultVideo'); },
    get mediaContainer() { return document.getElementById('media-container'); },
    get bigButtons() { return document.getElementById('big-buttons'); },
    get videoCanvas() { return document.getElementById('videoCanvas'); },
    get playbackVideoMobileContainer() { return document.getElementById('playback-video-mobile-container'); },
    get questionsContainerContainer() { return document.getElementById('questions-container-container'); },
    get overlayImage() { return document.getElementById('overlayImage'); },
    get playbackVideoDesktop() { return document.getElementById('playback-video-desktop'); },
    get playbackVideoMobile() { return document.getElementById('playback-video-mobile'); },
    get footer() { return document.querySelector('footer'); },
    get shareMp4Btn() { return document.getElementById('shareMp4Btn'); }
};

export function setupInitialProcessingUI() {
    if (DOM.bottomButtonBar) DOM.bottomButtonBar.classList.add('d-none');
    if (DOM.bottomButtonBarSuccess) DOM.bottomButtonBarSuccess.classList.remove('d-none');
    if (DOM.micStatusText) DOM.micStatusText.innerHTML = "<div class='text-center'>Get Complete Fluency Score and Shareable Video.<br><span lang='es'><i>Recibir Calificación de Fluidez Completa y Video Compartible.</i></span></div>";
}

export function getOrCreateResultVideo() {
    let resultVideo = DOM.resultVideo;
    if (!resultVideo) {
        resultVideo = document.createElement('video');
        resultVideo.id = 'resultVideo';
        resultVideo.classList.add('d-none');

        const container = DOM.mediaContainer || document.body;
        container.appendChild(resultVideo);
        console.log("Created resultVideo element dynamically");
    }
    return resultVideo;
}

export function createAndAppendDisplayCanvas(isDesktop) {
    const displayCanvas = document.createElement('canvas');
    displayCanvas.id = 'displayCanvas';
    displayCanvas.style.position = 'static';
    displayCanvas.style.width = '100%';
    displayCanvas.style.maxWidth = '400px';
    displayCanvas.style.height = 'auto';
    displayCanvas.style.margin = '10px auto';
    displayCanvas.style.zIndex = 'auto';
    displayCanvas.style.display = 'none';
    displayCanvas.style.boxSizing = 'border-box';
    displayCanvas.style.backgroundColor = '#000';

    const targetContainer = isDesktop
        ? DOM.playbackVideoMobileContainer
        : DOM.playbackVideoMobileContainer; // Note: In original code it was the same for both

    if (targetContainer) {
        targetContainer.appendChild(displayCanvas);
        console.log("Display canvas appended to target container");
    } else {
        const questionsContainer = DOM.questionsContainerContainer;
        if (questionsContainer) {
            questionsContainer.insertBefore(displayCanvas, questionsContainer.firstChild);
            console.log("Display canvas appended to questions container");
        } else {
            console.warn('No suitable container found, appending to body as fallback');
            document.body.appendChild(displayCanvas);
        }
    }
    return displayCanvas;
}

export function createTestVideo() {
    const testVideo = document.createElement('video');
    testVideo.style.display = 'none';
    document.body.appendChild(testVideo);
    return testVideo;
}

export function removeTestVideo(testVideo) {
    if (testVideo && testVideo.parentNode) {
        testVideo.parentNode.removeChild(testVideo);
    }
}

export function pauseAndClearPlaybackVideos() {
    const desktopVideo = DOM.playbackVideoDesktop;
    if (desktopVideo) {
        desktopVideo.pause();
        desktopVideo.src = '';
    }

    const mobileVideo = DOM.playbackVideoMobile;
    if (mobileVideo) {
        mobileVideo.pause();
        mobileVideo.src = '';
    }
}

export function hideFooter() {
    const footer = DOM.footer;
    if (footer) footer.classList.add("d-none");
}

export function renderFinalVideoUI() {
    if (DOM.bottomButtonBarSuccess) DOM.bottomButtonBarSuccess.classList.add('d-none');
    if (DOM.bigButtons) DOM.bigButtons.classList.remove('d-none');
    document.body.style.background = "black";
    document.documentElement.style.background = "black";
}

export function updateProcessButtonState(isDisabled) {
    if (DOM.processBtn) {
        DOM.processBtn.disabled = isDisabled;
        DOM.processBtn.style.display = isDisabled ? 'none' : 'block';
    }
}

export function hideDisplayCanvas(displayCanvas) {
    if (displayCanvas) {
        displayCanvas.style.display = 'none';
    }
}

export function showDisplayCanvas(displayCanvas) {
    if (displayCanvas) {
        displayCanvas.style.display = 'block';
    }
}

export function hideVideoCanvas() {
    if (DOM.videoCanvas) {
        DOM.videoCanvas.classList.add('d-none');
    }
}

export function showShareButton() {
    if (DOM.shareMp4Btn) {
        DOM.shareMp4Btn.classList.remove('d-none');
    }
}

export function configureResultVideo(url, thumbnailUrl, maxVideoWidth, isIOSDevice) {
    const resultVideo = getOrCreateResultVideo();
    resultVideo.src = url;
    resultVideo.controls = true;
    resultVideo.playsInline = true;
    resultVideo.setAttribute('playsinline', '');
    resultVideo.setAttribute('webkit-playsinline', '');
    resultVideo.muted = false;
    resultVideo.preload = 'auto';
    resultVideo.crossOrigin = 'anonymous';

    if (thumbnailUrl) {
        resultVideo.poster = thumbnailUrl;
    }

    resultVideo.classList.remove('d-none');
    resultVideo.style.display = 'block';

    resultVideo.style.position = 'static';
    resultVideo.style.width = '100%';
    resultVideo.style.maxWidth = maxVideoWidth + 'px';
    resultVideo.style.height = 'auto';
    resultVideo.style.margin = '10px auto';
    resultVideo.style.boxSizing = 'border-box';
    resultVideo.style.zIndex = 'auto';
    resultVideo.style.backgroundColor = '#000';

    if (!isIOSDevice) {
        // Need to clear existing click listeners to avoid duplicates, but since we recreate or reuse,
        // using an onclick assignment is safer.
        resultVideo.onclick = function () {
            this.paused ? this.play() : this.pause();
        };
    }

    resultVideo.load();
    return resultVideo;
}
