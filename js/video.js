export class InteractiveVideoPlayer {
  constructor(config) {
    // FOUC fix: inject styles before any DOM work
    this.injectStyles();

    const defaults = {
      videoUrl: '',
      cue: '',
      containerSelector: 'body',
      speeds: [0.75, 0.6, 1],
      videoStyles: {},
      subtitleStyles: {}
    };

    this.config = { ...defaults, ...config };
    this.validateInput();

    this.tokens = [];
    this.originalIndices = [];
    this.shuffledIndices = [];
    this.currentRevealStart = 0;
    this.currentSpeedIndex = 0;
    this.isFirstPlay = true;
    this.isSecondPlay = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    this.isVideoLoaded = false;

    // Store bound references so removeEventListener actually works
    this._handleClick = this.handleClick.bind(this);
    this._handleLoop = this.handleLoop.bind(this);
    this._updateSubtitles = this.updateSubtitles.bind(this);
    this._applyVideoStyles = this.applyVideoStyles.bind(this);
    this._handleVideoLoaded = this.handleVideoLoaded.bind(this);

    this.initContainer();
    this.initVideo();
    this.initSubtitles();
    this.initEventListeners();
  }

  validateInput() {
    if (!this.config.videoUrl) throw new Error('videoUrl is required');
    if (!this.config.cue) throw new Error('cue is required');
    if (!document.querySelector(this.config.containerSelector)) {
      throw new Error('Container element not found');
    }
  }

  initContainer() {
    this.container = document.querySelector(this.config.containerSelector);
    this.mainWrapper = document.createElement('div');
    this.mainWrapper.className = 'ivp-main-wrapper';

    // FOUC fix: hide with visibility so layout is preserved but nothing is painted
    this.mainWrapper.style.visibility = 'hidden';

    this.container.style.margin = '0';
    this.container.style.padding = '0';
    this.container.style.overflowX = 'hidden';

    this.container.appendChild(this.mainWrapper);
  }

  initVideo() {
    this.videoWrapper = document.createElement('div');
    this.videoWrapper.className = 'ivp-video-wrapper';

    this.video = document.createElement('video');
    this.video.className = 'ivp-video';
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('preload', this.isIOS ? 'metadata' : 'auto');
    this.video.setAttribute('crossorigin', 'anonymous');

    // iOS loading spinner
    if (this.isIOS) {
      this.loadingSpinner = document.createElement('div');
      this.loadingSpinner.className = 'ivp-loading-spinner';
      this.loadingSpinner.innerHTML = `
        <div class="spinner-border text-light" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      `;
      this.videoWrapper.appendChild(this.loadingSpinner);
    }

    this.video.src = this.config.videoUrl;

    // FOUC fix: use stored bound reference so removeEventListener actually works
    this.video.addEventListener('loadeddata', this._handleVideoLoaded);
    this.video.addEventListener('canplay', this._handleVideoLoaded);

    // FOUC fix: safety fallback in case neither event fires
    this._fouc_fallback = setTimeout(() => {
      if (!this.isVideoLoaded) this.reveal();
    }, 3000);

    if (this.isIOS) {
      this.video.setAttribute('poster', 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');

      const unmute = () => {
        this.video.muted = false;
        document.removeEventListener('click', unmute);
        document.removeEventListener('touchstart', unmute);
      };
      document.addEventListener('click', unmute);
      document.addEventListener('touchstart', unmute);

      setTimeout(() => {
        this.applyVideoStyles();
        if (this.loadingSpinner) this.loadingSpinner.style.display = 'none';
      }, 100);

    } else {
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
        const canvas = document.createElement('canvas');
        canvas.width = tempVideo.videoWidth;
        canvas.height = tempVideo.videoHeight;
        const ctx = canvas.getContext('2d');

        try {
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          this.video.setAttribute('poster', canvas.toDataURL());
        } catch (error) {
          console.warn('Canvas export failed, using default video:', error);
        }

        cleanupTempVideo();

        const unmute = () => {
          this.video.muted = false;
          document.removeEventListener('click', unmute);
          document.removeEventListener('touchstart', unmute);
        };
        document.addEventListener('click', unmute);
        document.addEventListener('touchstart', unmute);

        this.applyVideoStyles();
      });

      document.body.appendChild(tempVideo);
      tempVideo.load();

      setTimeout(() => {
        if (document.body.contains(tempVideo)) {
          cleanupTempVideo();
          this.applyVideoStyles();
        }
      }, 2000);
    }

    this.videoWrapper.appendChild(this.video);
    this.mainWrapper.appendChild(this.videoWrapper);
  }

  // FOUC fix: single reveal method used everywhere, with double-rAF to ensure paint
  reveal() {
    if (this.isVideoLoaded) return;
    this.isVideoLoaded = true;
    clearTimeout(this._fouc_fallback);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.mainWrapper.style.visibility = 'visible';
      });
    });
  }

  handleVideoLoaded() {
    if (this.isVideoLoaded) return;

    // Remove listeners using stored bound references (fixes broken removeEventListener)
    this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
    this.video.removeEventListener('canplay', this._handleVideoLoaded);

    if (this.loadingSpinner) this.loadingSpinner.style.display = 'none';

    this.reveal();
  }

  initSubtitles() {
    this.blurOverlay = document.createElement('div');
    this.blurOverlay.className = 'ivp-blur-overlay';
    this.videoWrapper.appendChild(this.blurOverlay);

    this.subtitleDisplay = document.createElement('div');
    this.subtitleDisplay.className = 'ivp-subtitles';
    Object.assign(this.subtitleDisplay.style, this.config.subtitleStyles);
    this.videoWrapper.appendChild(this.subtitleDisplay);

    this.tokens = this.config.cue.split(/\s+/);
    this.originalIndices = Array.from({ length: this.tokens.length }, (_, i) => i);
    this.shuffledIndices = this.constructor.shuffle([...this.originalIndices]);

    this.subtitleDisplay.textContent = '';
  }

  static shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  initEventListeners() {
    this.mainWrapper.addEventListener('click', this._handleClick);
    this.video.addEventListener('ended', this._handleLoop);
    this.video.addEventListener('play', this._updateSubtitles);
    window.addEventListener('resize', this._applyVideoStyles);

    if (this.isIOS) {
      this.video.addEventListener('loadedmetadata', () => {
        this.applyVideoStyles();
        if (this.loadingSpinner) this.loadingSpinner.style.display = 'none';
      });

      this.video.addEventListener('canplay', () => {
        this.applyVideoStyles();
        if (this.loadingSpinner) this.loadingSpinner.style.display = 'none';
      });
    }
  }

  applyVideoStyles() {
    this.mainWrapper.style.cssText = '';
    this.videoWrapper.style.cssText = '';
    this.video.style.cssText = '';
    this.subtitleDisplay.style.cssText = '';
    if (this.blurOverlay) this.blurOverlay.style.cssText = '';
    if (this.loadingSpinner) this.loadingSpinner.style.cssText = '';

    // FOUC fix: re-apply hidden state after cssText reset if not yet revealed
    if (!this.isVideoLoaded) {
      this.mainWrapper.style.visibility = 'hidden';
    }

    this.mainWrapper.style.display = 'flex';
    this.mainWrapper.style.flexDirection = 'column';
    this.mainWrapper.style.alignItems = 'center';
    this.mainWrapper.style.justifyContent = 'center';
    this.mainWrapper.style.width = '100%';
    this.mainWrapper.style.margin = '0 auto';

    const isDesktop = window.innerWidth > 800;
    let videoWidth, videoHeight;

    if (isDesktop) {
      videoWidth = 300;
      videoHeight = 375;
    } else {
      const maxMobileWidth = Math.min(window.innerWidth * 0.95, 500);
      videoWidth = maxMobileWidth;
      videoHeight = maxMobileWidth * (5 / 4);
    }

    this.videoWrapper.style.width = `${videoWidth}px`;
    this.videoWrapper.style.height = `${videoHeight}px`;
    this.videoWrapper.style.position = 'relative';
    this.videoWrapper.style.overflow = 'hidden';
    this.videoWrapper.style.backgroundColor = '#000';

    this.video.style.position = 'absolute';
    this.video.style.top = '0';
    this.video.style.left = '0';
    this.video.style.width = '100%';
    this.video.style.height = '100%';
    this.video.style.objectFit = 'cover';

    if (this.isIOS) this.video.style.webkitPlaysinline = 'true';

    const minSubtitleHeight = Math.max(60, videoHeight * 0.25);

    if (this.blurOverlay) {
      this.blurOverlay.style.display = 'none';
    }

    this.subtitleDisplay.style.position = 'absolute';
    this.subtitleDisplay.style.bottom = '0';
    this.subtitleDisplay.style.left = '0';
    this.subtitleDisplay.style.right = '0';
    this.subtitleDisplay.style.minHeight = `${minSubtitleHeight}px`;
    this.subtitleDisplay.style.height = 'auto';
    this.subtitleDisplay.style.padding = '12px 24px';
    this.subtitleDisplay.style.fontSize = isDesktop ? 'clamp(1rem, 4vw, 1.5rem)' : 'clamp(1.2rem, 5vw, 1.8rem)';
    
    if (CSS.supports('backdrop-filter', 'blur(10px)')) {
      this.subtitleDisplay.style.backdropFilter = 'blur(10px)';
      this.subtitleDisplay.style.backgroundColor = 'rgba(0,0,0,0.6)';
    } else {
      this.subtitleDisplay.style.backgroundColor = 'rgba(0,0,0,0.85)';
    }
    
    this.subtitleDisplay.style.color = 'white';
    this.subtitleDisplay.style.textAlign = 'center';
    this.subtitleDisplay.style.boxSizing = 'border-box';
    this.subtitleDisplay.style.zIndex = '2';
    this.subtitleDisplay.style.display = 'flex';
    this.subtitleDisplay.style.alignItems = 'center';
    this.subtitleDisplay.style.justifyContent = 'center';
    this.subtitleDisplay.style.flexWrap = 'wrap';
    this.subtitleDisplay.style.lineHeight = '1.3';

    if (this.isIOS && this.loadingSpinner) {
      this.loadingSpinner.style.position = 'absolute';
      this.loadingSpinner.style.top = '50%';
      this.loadingSpinner.style.left = '50%';
      this.loadingSpinner.style.transform = 'translate(-50%, -50%)';
      this.loadingSpinner.style.zIndex = '10';
      this.loadingSpinner.style.display = 'flex';
      this.loadingSpinner.style.alignItems = 'center';
      this.loadingSpinner.style.justifyContent = 'center';
    }
  }

  updateSubtitles() {
    if (this.isFirstPlay || this.isSecondPlay) {
      this.subtitleDisplay.textContent = '';
      return;
    }

    const revealCount = Math.floor(this.tokens.length / 8) + 1;
    const currentIndices = this.shuffledIndices.slice(
      this.currentRevealStart,
      this.currentRevealStart + revealCount
    );

    this.subtitleDisplay.textContent = this.tokens
      .map((token, index) => currentIndices.includes(index) ? token : token.replace(/[\p{L}\p{N}]/gu, '_'))
      .join(' ');
  }

  handleLoop() {
    if (this.isFirstPlay) {
      this.isFirstPlay = false;
      this.isSecondPlay = true;
      this.updateSubtitles();
      this.video.play();
      return;
    }

    if (this.isSecondPlay) {
      this.isSecondPlay = false;
      this.currentSpeedIndex = 0;
      this.currentRevealStart = 0;
      this.video.playbackRate = this.config.speeds[this.currentSpeedIndex];
      this.updateSubtitles();
      this.video.play();
      return;
    }

    const revealCount = Math.floor(this.tokens.length / 8) + 1;
    this.currentRevealStart += revealCount;

    if (this.currentRevealStart >= this.shuffledIndices.length) {
      this.shuffledIndices = this.constructor.shuffle([...this.originalIndices]);
      this.currentRevealStart = 0;
    }

    this.currentSpeedIndex = (this.currentSpeedIndex + 1) % this.config.speeds.length;
    this.video.playbackRate = this.config.speeds[this.currentSpeedIndex];

    this.updateSubtitles();
    this.video.play();
  }

  handleClick() {
    if (this.video.paused) {
      if (this.isFirstPlay) this.subtitleDisplay.textContent = '';
      const playPromise = this.video.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => console.log('Play failed:', error));
      }
    } else {
      this.video.pause();
    }
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .d-none { display: none !important; }

      html, body {
        margin: 0;
        padding: 0;
        overflow-x: hidden;
      }

      .ivp-main-wrapper {
        display: flex;
        flex-direction: column;
      }

      .ivp-video-wrapper {
        position: relative;
      }

      .ivp-blur-overlay {}
      .ivp-subtitles {}

      @media (min-width: 768px) {
        .ivp-main-wrapper {
          max-width: 300px;
        }
      }

      @media (max-width: 768px) {
        .ivp-subtitles {
          font-size: clamp(1.2rem, 5vw, 1.8rem) !important;
        }
      }

      video::-webkit-media-controls {
        display: none !important;
      }

      video {
        -webkit-playsinline: true;
      }
    `;
    document.head.appendChild(style);
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
    clearTimeout(this._fouc_fallback);
    if (this.mainWrapper) {
      this.mainWrapper.removeEventListener('click', this._handleClick);
      this.mainWrapper.remove();
    }
    if (this.video) {
      this.video.removeEventListener('ended', this._handleLoop);
      this.video.removeEventListener('play', this._updateSubtitles);
      this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
      this.video.removeEventListener('canplay', this._handleVideoLoaded);
    }
    window.removeEventListener('resize', this._applyVideoStyles);
  }
}
