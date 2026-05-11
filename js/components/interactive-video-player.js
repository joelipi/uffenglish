// components/interactive-video-player.js
import { InteractiveVideoStateController } from '../modules/interactive-video-controller.js';

export class InteractiveVideoPlayerUI {
  constructor(config) {
    this.config = config;
    this.elements = {};
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  createDOM() {
    const container = document.querySelector(this.config.containerSelector);
    if (!container) throw new Error('Container element not found');

    const mainWrapper = document.createElement('div');
    mainWrapper.className = 'ivp-main-wrapper loading';
    mainWrapper.style.visibility = 'hidden';
    container.style.margin = '0';
    container.style.padding = '0';
    container.style.overflowX = 'hidden';
    container.appendChild(mainWrapper);

    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'ivp-video-wrapper';
    mainWrapper.appendChild(videoWrapper);

    const video = document.createElement('video');
    video.className = 'ivp-video';
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', this.isIOS ? 'metadata' : 'auto');
    video.setAttribute('crossorigin', 'anonymous');
    video.muted = true;
    video.src = this.config.videoUrl;

    if (this.config.videoStyles) Object.assign(video.style, this.config.videoStyles);
    videoWrapper.appendChild(video);

    let loadingSpinner = null;
    if (this.isIOS) {
      loadingSpinner = document.createElement('div');
      loadingSpinner.className = 'ivp-loading-spinner';
      loadingSpinner.innerHTML = `
                <div class="spinner-border text-light" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            `;
      Object.assign(loadingSpinner.style, {
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: '10'
      });
      videoWrapper.appendChild(loadingSpinner);
    }

    const blurOverlay = document.createElement('div');
    blurOverlay.className = 'ivp-blur-overlay';
    blurOverlay.style.display = 'none'; // Always hidden in this configuration
    videoWrapper.appendChild(blurOverlay);

    const overlay = document.createElement('div');
    overlay.className = 'ivp-overlay';
    overlay.innerHTML = `
      <div class="ivp-overlay-content">
        <div class="ivp-overlay-circle"></div>
        <p class="ivp-overlay-text">Understand<br>100%?</p>
      </div>
      <div class="ivp-overlay-arrow ivp-overlay-arrow-up"><span class="ivp-arrow-label">NO</span></div>
      <div class="ivp-overlay-arrow ivp-overlay-arrow-down"><span class="ivp-arrow-label">YES</span></div>
    `;
    videoWrapper.appendChild(overlay);

    const subtitleDisplay = document.createElement('div');
    subtitleDisplay.className = 'ivp-subtitles';
    if (this.config.subtitleStyles) Object.assign(subtitleDisplay.style, this.config.subtitleStyles);
    videoWrapper.appendChild(subtitleDisplay);

    this.elements = { container, mainWrapper, videoWrapper, video, loadingSpinner, blurOverlay, overlay, subtitleDisplay };
    return this.elements;
  }

  render(state) {
    if (!this.elements.mainWrapper) return;

    // 1. Handle Loaded / Visibility
    if (state.isLoaded && this.elements.mainWrapper.style.visibility === 'hidden') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.elements.mainWrapper.classList.remove('loading');
          this.elements.mainWrapper.style.visibility = 'visible';
          if (this.elements.loadingSpinner) this.elements.loadingSpinner.style.display = 'none';
        });
      });
    }

    // 2. Handle Subtitle Tokens Updates
    if (this.elements.subtitleDisplay && state.subtitleTokens) {
      const tokensVersion = state.subtitleTokens.map(t => `${t.index}-${t.revealed}-${t.strikethrough}`).join(',');
      if (this.elements.subtitleDisplay.dataset.tokensVersion !== tokensVersion) {
        this.elements.subtitleDisplay.dataset.tokensVersion = tokensVersion;
        const fragment = document.createDocumentFragment();
        state.subtitleTokens.forEach(token => {
          let el;
          if (token.clickable) {
            el = document.createElement('button');
            el.className = 'ivp-token ivp-token-hidden';
            el.setAttribute('aria-label', 'Hidden word');
            el.textContent = token.text; // Text is hidden via CSS
            el.onclick = (e) => {
               e.stopPropagation();
               if (this.onTokenClick) this.onTokenClick(token.index);
            };
          } else {
            el = document.createElement('span');
            el.className = 'ivp-token ' + (token.isPunctuation ? 'ivp-token-punctuation' : 'ivp-token-revealed');
            if (token.strikethrough) el.classList.add('ivp-token-strikethrough');
            el.textContent = token.text;
          }
          fragment.appendChild(el);
        });
        this.elements.subtitleDisplay.innerHTML = '';
        this.elements.subtitleDisplay.appendChild(fragment);
      }
    }

    // 3. Handle Playback Rate
    if (this.elements.video && this.elements.video.playbackRate !== state.playbackRate) {
      this.elements.video.playbackRate = state.playbackRate;
    }

    // 4. Handle Overlay
    if (this.elements.overlay) {
      this.elements.overlay.style.display = state.showOverlay ? 'flex' : 'none';
    }

    // 5. Handle Zoom (isSlowMode)
    if (this.elements.video) {
      this.elements.video.style.transform = state.isSlowMode ? 'scale(1.5)' : '';
    }
  }

  destroy() {
    if (this.elements.mainWrapper) {
      this.elements.mainWrapper.remove();
    }
  }
}

export class InteractiveVideoPlayer {
  constructor(config) {
    const defaults = {
      videoUrl: '',
      cue: '',
      containerSelector: 'body',
      speeds: [0.75, 0.6, 1],
      videoStyles: {},
      subtitleStyles: {},
      onRepetition: null,
      onWordReveal: null
    };

    this.config = { ...defaults, ...config };
    this.validateInput();

    // Safety trackers to prevent memory leaks
    this.timeouts = new Set();
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Core Components
    this.ui = new InteractiveVideoPlayerUI(this.config);
    this.elements = this.ui.createDOM();
    this.video = this.elements.video; // Direct access for API compatibility

    // Initialize Pure Logic Controller
    this.controller = new InteractiveVideoStateController(this.config);
    this.ui.onTokenClick = (index) => this.controller.revealToken(index);

    // Bind UI Renderer to Controller State
    this.unsubscribeController = this.controller.subscribe((state) => {
      this.ui.render(state);
      // Handle Video Player Auto-Looping execution
      if (state.isPlaying && this.video.paused) {
        const playPromise = this.video.play();
        if (playPromise !== undefined) playPromise.catch(() => { });
      }
    });

    // Store explicitly bound references for flawless event cleanup
    this._handleVideoLoaded = () => this.controller.setLoaded();
    this._handleLoop = () => this.controller.handleLoop();
    this._handleClick = this.handleClick.bind(this);
    this._handlePlay = () => this.controller.play();
    this._handlePause = () => this.controller.pause();

    this.initVideoLogic();
    this.initEventListeners();
  }

  _setTimeout(fn, delay) {
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      fn();
    }, delay);
    this.timeouts.add(id);
    return id;
  }

  validateInput() {
    if (!this.config.videoUrl) throw new Error('videoUrl is required');
    if (!this.config.cue) throw new Error('cue is required');
  }

  initVideoLogic() {
    this.video.addEventListener('loadeddata', this._handleVideoLoaded);
    this.video.addEventListener('canplay', this._handleVideoLoaded);

    // FOUC Fallback
    this._setTimeout(() => this.controller.setLoaded(), 3000);

    // Safely bound Unmute Logic (prevents crash if destroyed early)
    this._handleUnmute = () => {
      if (this.video) this.video.muted = false;
      document.removeEventListener('click', this._handleUnmute);
      document.removeEventListener('touchstart', this._handleUnmute);
    };
    document.addEventListener('click', this._handleUnmute);
    document.addEventListener('touchstart', this._handleUnmute);

    if (this.isIOS) {
      this.video.setAttribute('poster', 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
    } else {
      this.generateTempPoster();
    }
  }

  generateTempPoster() {
    const tempVideo = document.createElement('video');
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.src = this.config.videoUrl;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';
    tempVideo.style.display = 'none';

    const cleanupTempVideo = () => {
      if (document.body.contains(tempVideo)) document.body.removeChild(tempVideo);
    };

    tempVideo.addEventListener('loadeddata', () => {
      if (!this.ui) return cleanupTempVideo();

      const canvas = document.createElement('canvas');
      canvas.width = tempVideo.videoWidth;
      canvas.height = tempVideo.videoHeight;
      const ctx = canvas.getContext('2d');

      try {
        ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
        this.video.setAttribute('poster', canvas.toDataURL());
      } catch (error) {
        console.warn('Canvas export failed, using default poster');
      }
      cleanupTempVideo();
    });

    document.body.appendChild(tempVideo);
    tempVideo.load();

    this._setTimeout(() => {
      if (document.body.contains(tempVideo)) cleanupTempVideo();
    }, 2000);
  }

  initEventListeners() {
    this.elements.mainWrapper.addEventListener('click', this._handleClick);

    // Adapter events mapped to Controller
    this.video.addEventListener('play', this._handlePlay);
    this.video.addEventListener('pause', this._handlePause);
    this.video.addEventListener('ended', this._handleLoop);

    // Force UI re-render on iOS metadata loads
    if (this.isIOS) {
      this.video.addEventListener('loadedmetadata', () => this.ui.render(this.controller.state));
      this.video.addEventListener('canplay', () => this.ui.render(this.controller.state));
    }
  }

  handleClick(e) {
    if (this.controller.state.showOverlay) {
        this.controller.dismissOverlay();
        return;
    }

    if (this.video.paused) {
      const playPromise = this.video.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => console.log('Play failed:', error));
      }
    } else {
      this.video.pause();
    }
  }

  pauseAndPrepForSwap() {
    this.video.pause();
    this.elements.mainWrapper.classList.add('ivp-swapped');
    return this.elements.mainWrapper;
  }

  play() {
    const playPromise = this.video.play();
    if (playPromise !== undefined) {
      return playPromise.catch(error => {
        console.log('Play failed:', error);
        throw error;
      });
    }
  }

  pause() {
    this.video.pause();
  }

  destroy() {
    // 1. Clean up Timeouts
    this.timeouts.forEach(clearTimeout);
    this.timeouts.clear();

    // 2. Clean up Document Listeners
    if (this._handleUnmute) {
      document.removeEventListener('click', this._handleUnmute);
      document.removeEventListener('touchstart', this._handleUnmute);
    }

    // 3. Clean up DOM Listeners
    if (this.elements.mainWrapper) {
      this.elements.mainWrapper.removeEventListener('click', this._handleClick);
    }

    // 4. Clean up Video Listeners
    if (this.video) {
      this.video.removeEventListener('play', this._handlePlay);
      this.video.removeEventListener('pause', this._handlePause);
      this.video.removeEventListener('ended', this._handleLoop);
      this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
      this.video.removeEventListener('canplay', this._handleVideoLoaded);
    }

    // 5. Unsubscribe from Logic Controller
    if (this.unsubscribeController) this.unsubscribeController();

    // 6. Destroy DOM
    if (this.ui) this.ui.destroy();
    this.ui = null;
    this.video = null;
  }
}
