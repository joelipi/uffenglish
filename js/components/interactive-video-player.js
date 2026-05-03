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
    
    // 1. Look for existing HTML wrapper instead of creating a new one
    this.mainWrapper = this.container.querySelector('.ivp-main-wrapper') || document.createElement('div');
    
    // Only append if it's a newly created element
    if (!this.mainWrapper.parentElement) {
      this.mainWrapper.className = 'ivp-main-wrapper loading';
      this.container.appendChild(this.mainWrapper);
    }

    this.container.style.margin = '0';
    this.container.style.padding = '0';
    this.container.style.overflowX = 'hidden';
  }

  initVideo() {
    // 2. Look for existing video wrapper and video elements
    this.videoWrapper = this.mainWrapper.querySelector('.ivp-video-wrapper') || document.createElement('div');
    if (!this.videoWrapper.parentElement) {
      this.videoWrapper.className = 'ivp-video-wrapper';
      this.mainWrapper.appendChild(this.videoWrapper);
    }

    this.video = this.videoWrapper.querySelector('.ivp-video') || document.createElement('video');
    if (!this.video.parentElement) {
      this.video.className = 'ivp-video';
      this.videoWrapper.appendChild(this.video);
    }

    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('preload', this.isIOS ? 'metadata' : 'auto');
    this.video.setAttribute('crossorigin', 'anonymous');
    
    // Apply custom styles from config
    if (this.config.videoStyles) {
      Object.assign(this.video.style, this.config.videoStyles);
    }

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

    // this.videoWrapper.appendChild(this.video); // Already handled above
    // this.mainWrapper.appendChild(this.videoWrapper); // Already handled above
  }

  // FOUC fix: single reveal method used everywhere, with double-rAF to ensure paint
  reveal() {
    if (this.isVideoLoaded) return;
    this.isVideoLoaded = true;
    clearTimeout(this._fouc_fallback);
    
    // Final style pass before revealing
    this.applyVideoStyles();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Remove the loading class to reveal the player seamlessly
        this.mainWrapper.classList.remove('loading');
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
    // 3. Look for existing subtitle overlays
    this.blurOverlay = this.videoWrapper.querySelector('.ivp-blur-overlay') || document.createElement('div');
    if(!this.blurOverlay.parentElement) {
       this.blurOverlay.className = 'ivp-blur-overlay';
       this.videoWrapper.appendChild(this.blurOverlay);
    }

    this.subtitleDisplay = this.videoWrapper.querySelector('.ivp-subtitles') || document.createElement('div');
    if(!this.subtitleDisplay.parentElement) {
      this.subtitleDisplay.className = 'ivp-subtitles';
      this.videoWrapper.appendChild(this.subtitleDisplay);
    }
    
    Object.assign(this.subtitleDisplay.style, this.config.subtitleStyles);

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
    // Instead of resetting everything, we only apply dynamic or critical layout styles.
    // Base layout (flex, width, margin) is now handled in style.css.

    // FOUC fix: re-apply hidden state if not yet revealed
    if (!this.isVideoLoaded) {
      this.mainWrapper.style.visibility = 'hidden';
      this.mainWrapper.classList.add('loading');
    }

    const maxWidth = Math.min(window.innerWidth * 0.95, 600);
    const videoHeight = maxWidth * (5 / 4);

    const minSubtitleHeight = Math.max(60, videoHeight * 0.25);

    if (this.blurOverlay) {
      this.blurOverlay.style.display = 'none';
    }

    // Dynamic subtitle styling - mostly handled by style.css now.
    // We only keep critical runtime overrides if needed, but here we can offload to CSS.
    
    if (this.blurOverlay) {
      this.blurOverlay.style.display = 'none';
    }

    if (this.isIOS && this.loadingSpinner) {
      Object.assign(this.loadingSpinner.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: '10',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      });
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
    // Styles moved to style.css for better performance and stability
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
