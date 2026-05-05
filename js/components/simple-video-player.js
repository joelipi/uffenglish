class SimpleVideoPlayerUI {
  constructor(containerSelector) {
    this.containerSelector = containerSelector;
    this.elements = {};
  }

  validateContainer() {
    if (!document.querySelector(this.containerSelector)) {
      throw new Error('Container element not found');
    }
  }

  createDOM(config) {
    const container = document.querySelector(this.containerSelector);

    const mainWrapper = document.createElement('div');
    mainWrapper.className = 'ivp-main-wrapper';
    mainWrapper.style.visibility = 'hidden';
    container.style.margin = '0';
    container.style.padding = '0';
    container.style.overflowX = 'hidden';
    container.appendChild(mainWrapper);

    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'ivp-video-wrapper';

    const video = document.createElement('video');
    video.className = 'ivp-video';
    video.setAttribute('playsinline', '');
    video.setAttribute('disableRemotePlayback', '');
    video.setAttribute('preload', 'metadata');
    video.setAttribute('crossorigin', 'anonymous');
    video.muted = true;
    video.src = config.videoUrl;

    videoWrapper.appendChild(video);
    mainWrapper.appendChild(videoWrapper);

    const blurOverlay = document.createElement('div');
    blurOverlay.className = 'ivp-blur-overlay';
    videoWrapper.appendChild(blurOverlay);

    const subtitleScrollContainer = document.createElement('div');
    subtitleScrollContainer.className = 'ivp-subtitle-scroll-container';

    const subtitleDisplay = document.createElement('div');
    subtitleDisplay.className = 'ivp-subtitles';

    subtitleScrollContainer.appendChild(subtitleDisplay);
    videoWrapper.appendChild(subtitleScrollContainer);

    subtitleDisplay.textContent = config.subtitles;
    if (config.subtitleStyles) {
      Object.assign(subtitleDisplay.style, config.subtitleStyles);
    }

    const playOverlay = document.createElement('div');
    playOverlay.className = 'ivp-play-overlay';
    playOverlay.innerHTML = `
      <div class="ivp-play-icon-container">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </div>
    `;
    videoWrapper.appendChild(playOverlay);

    this.elements = {
      container,
      mainWrapper,
      videoWrapper,
      video,
      blurOverlay,
      subtitleScrollContainer,
      subtitleDisplay,
      playOverlay
    };

    return this.elements;
  }

  reveal() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.elements.mainWrapper) {
          this.elements.mainWrapper.style.visibility = 'visible';
        }
      });
    });
  }

  setPoster(posterUrl) {
    if (this.elements.video) {
      this.elements.video.setAttribute('poster', posterUrl);
    }
  }

  updatePlayOverlay(isPlaying) {
    if (this.elements.playOverlay) {
      this.elements.playOverlay.style.display = isPlaying ? 'none' : 'flex';
    }
  }

  getSubtitleMetrics() {
    if (!this.elements.subtitleScrollContainer || !this.elements.subtitleDisplay) {
      return { containerHeight: 0, contentHeight: 0 };
    }
    return {
      containerHeight: this.elements.subtitleScrollContainer.offsetHeight,
      contentHeight: this.elements.subtitleDisplay.scrollHeight
    };
  }

  updateSubtitleScroll(currentScroll, forceUpdate, interval) {
    if (this.elements.subtitleDisplay) {
      this.elements.subtitleDisplay.style.transform = `translateY(-${currentScroll}px)`;
      this.elements.subtitleDisplay.style.transition = forceUpdate ? 'none' : `transform ${interval / 1000}s linear`;
    }
  }

  resetSubtitleScroll() {
    if (this.elements.subtitleDisplay) {
      this.elements.subtitleDisplay.style.transform = 'translateY(0)';
    }
  }

  destroy() {
    if (this.elements.mainWrapper) {
      this.elements.mainWrapper.remove();
    }
  }
}

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

    this.ui = new SimpleVideoPlayerUI(this.config.containerSelector);
    this.ui.validateContainer();

    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.lastScrollUpdate = 0;
    this.scrollUpdateInterval = 100;
    this.scrollPosition = 0;
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.isAndroid = /Android/.test(navigator.userAgent);
    this.isPlaying = false;
    this.isVideoLoaded = false;

    // Build DOM
    this.elements = this.ui.createDOM(this.config);
    this.video = this.elements.video; // provide direct access for API compat
    this.mainWrapper = this.elements.mainWrapper;

    // Store bound references
    this._handleVideoLoaded = this.handleVideoLoaded.bind(this);
    this._applyVideoStyles = this.applyVideoStyles.bind(this);
    this._updateSubtitleScroll = this.updateSubtitleScroll.bind(this);
    this._handleClick = this.handleClick.bind(this);

    this.initVideoLogic();
    this.ui.updatePlayOverlay(this.isPlaying);
    setTimeout(() => this.updateSubtitleScroll(true), 200);
    this.initEventListeners();
  }

  validateInput() {
    if (!this.config.videoUrl) throw new Error('videoUrl is required');
    if (!this.config.subtitles) throw new Error('subtitles is required');
  }

  initVideoLogic() {
    if (this.isAndroid) this.disableMediaSession();

    this.video.addEventListener('loadeddata', this._handleVideoLoaded);
    this.video.addEventListener('canplay', this._handleVideoLoaded);

    this._fouc_fallback = setTimeout(() => {
      if (!this.isVideoLoaded) this.reveal();
    }, 3000);

    if (this.isIOS) {
      this.ui.setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');

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
          this.ui.setPoster(canvas.toDataURL('image/jpeg', 0.8));
        } catch (error) {
          this.ui.setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
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

      setTimeout(() => {
        if (document.body.contains(tempVideo)) {
          cleanupTempVideo();
          this.applyVideoStyles();
          this.updateSubtitleScroll(true);
        }
      }, 2000);
    }
  }

  reveal() {
    if (this.isVideoLoaded) return;
    this.isVideoLoaded = true;
    clearTimeout(this._fouc_fallback);
    this.ui.reveal();
  }

  handleVideoLoaded() {
    if (this.isVideoLoaded) return;
    this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
    this.video.removeEventListener('canplay', this._handleVideoLoaded);
    this.reveal();
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
            try { navigator.mediaSession.setActionHandler(action, null); } catch (e) {}
          });
        } catch (error) {}
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
          } catch (e) {}
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
      this.ui.updatePlayOverlay(this.isPlaying);
    });

    this.video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.ui.updatePlayOverlay(this.isPlaying);
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

  updateSubtitleScroll(forceUpdate = false) {
    if (!this.config.scrollSubtitles) return;

    const now = Date.now();
    if (!forceUpdate && now - this.lastScrollUpdate < this.scrollUpdateInterval) return;
    this.lastScrollUpdate = now;

    const { containerHeight, contentHeight } = this.ui.getSubtitleMetrics();

    if (contentHeight <= containerHeight) {
      this.ui.resetSubtitleScroll();
      return;
    }

    let scrollRatio;
    if (this.video.duration && this.video.duration > 0) {
      scrollRatio = Math.min(0.95, this.video.currentTime / this.video.duration * this.config.scrollSpeed);
    } else {
      scrollRatio = this.scrollPosition;
    }

    scrollRatio = Math.max(0, Math.min(0.95, scrollRatio));
    this.scrollPosition = scrollRatio;

    const maxScroll = contentHeight - containerHeight;
    const currentScroll = scrollRatio * maxScroll;

    this.ui.updateSubtitleScroll(currentScroll, forceUpdate, this.scrollUpdateInterval);
  }

  applyVideoStyles() {
    this.updateSubtitleScroll(true);
    this.ui.updatePlayOverlay(this.isPlaying);
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
    clearTimeout(this._fouc_fallback);
    if (this.mainWrapper) {
      this.mainWrapper.removeEventListener('click', this._handleClick);
    }
    window.removeEventListener('resize', this._applyVideoStyles);
    if (this.video) {
      this.video.removeEventListener('timeupdate', this._updateSubtitleScroll);
      this.video.removeEventListener('seeked', this._updateSubtitleScroll);
      this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
      this.video.removeEventListener('canplay', this._handleVideoLoaded);
    }
    this.ui.destroy();
  }
}
