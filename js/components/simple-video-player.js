import { SimpleVideoStateController } from '../modules/simple-video-controller.js';

export class simpleVideoPlayer {
  constructor(config) {

    const defaults = {
      videoUrl: '',
      subtitles: '',
      containerSelector: 'body',
      videoStyles: {},
      subtitleStyles: {},
      scrollSubtitles: true,
      scrollSpeed: 1.0
    };

    this.config = { ...defaults, ...config };
    this.validateInput();

    this.controller = new SimpleVideoStateController(this.config);
    this.controller.initSubtitles(this.config.subtitles);
    this.unsubscribe = this.controller.subscribe(state => this.render(state));

    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.lastScrollUpdate = 0;
    this.scrollUpdateInterval = 100;
    this.scrollPosition = 0;
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.isAndroid = /Android/.test(navigator.userAgent);
    this.isPlaying = false;
    this.isVideoLoaded = false;

    // Store bound references so they can be properly removed later
    this._handleVideoLoaded = this.handleVideoLoaded.bind(this);
    this._applyVideoStyles = this.applyVideoStyles.bind(this);
    this._updateSubtitleScroll = this.updateSubtitleScroll.bind(this);
    this._handleClick = this.handleClick.bind(this);

    this.initContainer();
    this.initVideo();
    this.initSubtitles();
    this.initPlayOverlay();
    this.initEventListeners();
  }

  validateInput() {
    if (!this.config.videoUrl) throw new Error('videoUrl is required');
    if (!this.config.subtitles) throw new Error('subtitles is required');
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
    this.video.setAttribute('disableRemotePlayback', '');
    this.video.setAttribute('preload', 'metadata');
    this.video.setAttribute('crossorigin', 'anonymous');
    this.video.muted = true;
    this.video.src = this.config.videoUrl;

    if (this.isAndroid) this.disableMediaSession();

    // FOUC fix: use stored bound reference so removeEventListener actually works
    this.video.addEventListener('loadeddata', this._handleVideoLoaded);
    this.video.addEventListener('canplay', this._handleVideoLoaded);

    // FOUC fix: safety fallback in case neither loadeddata nor canplay fires
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
        this.updateSubtitleScroll(true);
      }, 100);

    } else {
      // Non-iOS: generate poster from first frame
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
          this.video.setAttribute('poster', canvas.toDataURL('image/jpeg', 0.8));
        } catch (error) {
          this.video.setAttribute('poster', 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
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
        this.updateSubtitleScroll(true);
      });

      document.body.appendChild(tempVideo);
      tempVideo.load();

      // Fallback if tempVideo stalls
      setTimeout(() => {
        if (document.body.contains(tempVideo)) {
          cleanupTempVideo();
          this.applyVideoStyles();
          this.updateSubtitleScroll(true);
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

    // Remove listeners using stored bound references (fixes the broken removeEventListener bug)
    this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
    this.video.removeEventListener('canplay', this._handleVideoLoaded);

    this.reveal();
  }

  initSubtitles() {
    this.blurOverlay = document.createElement('div');
    this.blurOverlay.className = 'ivp-blur-overlay';
    this.videoWrapper.appendChild(this.blurOverlay);

    this.subtitleScrollContainer = document.createElement('div');
    this.subtitleScrollContainer.className = 'ivp-subtitle-scroll-container';

    this.subtitleDisplay = document.createElement('div');
    this.subtitleDisplay.className = 'ivp-subtitles';

    this.subtitleScrollContainer.appendChild(this.subtitleDisplay);
    this.videoWrapper.appendChild(this.subtitleScrollContainer);

    // Apply config styles if provided
    if (this.config.subtitleStyles) {
      Object.assign(this.subtitleDisplay.style, this.config.subtitleStyles);
    }

    setTimeout(() => this.updateSubtitleScroll(true), 200);
  }

  initPlayOverlay() {
    this.playOverlay = document.createElement('div');
    this.playOverlay.className = 'ivp-play-overlay';
    this.playOverlay.innerHTML = `
      <div class="ivp-play-icon-container">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </div>
    `;
    this.videoWrapper.appendChild(this.playOverlay);
    this.updatePlayOverlay();
  }

  disableMediaSession() {
    if (!this.isAndroid) return;

    if ('mediaSession' in navigator) {
      const clearMediaSession = () => {
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
          const actions = ['play', 'pause', 'stop', 'seekbackward', 'seekforward',
            'seekto', 'previoustrack', 'nexttrack', 'skipad'];
          actions.forEach(action => {
            try { navigator.mediaSession.setActionHandler(action, null); } catch (e) { }
          });
        } catch (error) { }
      };

      clearMediaSession();
      this.video.addEventListener('play', clearMediaSession);
      this.video.addEventListener('playing', clearMediaSession);
      this.video.addEventListener('loadstart', clearMediaSession);
      this.video.addEventListener('canplay', clearMediaSession);
    }

    Object.defineProperty(this.video, 'duration', { get: () => NaN, configurable: true });
    this.video.setAttribute('title', '');
    this.video.removeAttribute('title');
    this.video.setAttribute('data-ambient', 'true');

    let mediaSessionInterval;

    this.video.addEventListener('play', () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
        mediaSessionInterval = setInterval(() => {
          try {
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
          } catch (e) { }
        }, 100);
      }
    });

    this.video.addEventListener('pause', () => {
      if (mediaSessionInterval) { clearInterval(mediaSessionInterval); mediaSessionInterval = null; }
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
    });

    this.video.addEventListener('ended', () => {
      if (mediaSessionInterval) { clearInterval(mediaSessionInterval); mediaSessionInterval = null; }
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
    });
  }

  initEventListeners() {
    this.mainWrapper.addEventListener('click', this._handleClick);
    window.addEventListener('resize', this._applyVideoStyles);
    this.video.addEventListener('timeupdate', this._updateSubtitleScroll);
    this.video.addEventListener('seeked', () => this.updateSubtitleScroll(true));

    this.video.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayOverlay();
    });

    this.video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayOverlay();
    });

    if (this.isIOS) {
      this.video.addEventListener('loadedmetadata', () => {
        this.applyVideoStyles();
        this.updateSubtitleScroll(true);
      });

      this.video.addEventListener('canplay', () => {
        this.applyVideoStyles();
      });
    }
  }

  updatePlayOverlay() {
    if (this.playOverlay) {
      this.playOverlay.style.display = this.isPlaying ? 'none' : 'flex';
    }
  }

  updateSubtitleScroll(forceUpdate = false) {
    if (this.video && this.controller) {
      this.controller.updateProgress(this.video.currentTime, this.video.duration);
    }
  }

  render(state) {
    if (!this.subtitleScrollContainer || !this.subtitleDisplay) return;

    if (state.isTimedSubtitles) {
      this.subtitleScrollContainer.classList.add('timed-subtitles-container');
      this.subtitleDisplay.classList.add('timed-subtitles');
      this.subtitleDisplay.innerHTML = state.activeSubtitleText;
      // No transform/scroll logic here — CSS handles positioning
    } else {
      this.subtitleScrollContainer.classList.remove('timed-subtitles-container');
      this.subtitleDisplay.classList.remove('timed-subtitles');

      // Render fallback plain text content only if it changed
      if (this.subtitleDisplay.innerHTML !== state.activeSubtitleText) {
        this.subtitleDisplay.innerHTML = state.activeSubtitleText;
      }

      const containerHeight = this.subtitleScrollContainer.offsetHeight;
      const contentHeight = this.subtitleDisplay.scrollHeight;

      if (contentHeight <= containerHeight) {
        this.subtitleDisplay.style.transform = 'translateY(0)';
        return;
      }

      const maxScroll = Math.max(0, contentHeight - containerHeight);
      const currentScroll = state.scrollRatio * maxScroll;

      this.subtitleDisplay.style.transform = `translateY(-${currentScroll}px)`;
      this.subtitleDisplay.style.transition = `transform ${this.scrollUpdateInterval / 1000}s linear`;
    }
  }

  applyVideoStyles() {
    // Dynamic calculations for scrolling
    this.updateSubtitleScroll(true);
    this.updatePlayOverlay();
  }

  handleClick() {
    if (this.video.paused) {
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
    if (this.unsubscribe) this.unsubscribe();
    clearTimeout(this._fouc_fallback);
    if (this.mainWrapper) {
      this.mainWrapper.removeEventListener('click', this._handleClick);
      this.mainWrapper.remove();
    }
    window.removeEventListener('resize', this._applyVideoStyles);
    if (this.video) {
      this.video.removeEventListener('timeupdate', this._updateSubtitleScroll);
      this.video.removeEventListener('seeked', this._updateSubtitleScroll);
      this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
      this.video.removeEventListener('canplay', this._handleVideoLoaded);
    }
  }
}
