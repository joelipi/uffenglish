export class simpleVideoPlayer {
  constructor(config) {
    // FOUC fix: inject styles before any DOM work so .d-none rule exists immediately
    this.injectStyles();

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

    this.subtitleDisplay.textContent = this.config.subtitles;
    
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
    if (!this.config.scrollSubtitles || !this.subtitleScrollContainer) return;

    const now = Date.now();
    if (!forceUpdate && now - this.lastScrollUpdate < this.scrollUpdateInterval) return;
    this.lastScrollUpdate = now;

    const containerHeight = this.subtitleScrollContainer.offsetHeight;
    const contentHeight = this.subtitleDisplay.scrollHeight;

    if (contentHeight <= containerHeight) {
      this.subtitleDisplay.style.transform = 'translateY(0)';
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

    this.subtitleDisplay.style.transform = `translateY(-${currentScroll}px)`;
    this.subtitleDisplay.style.transition = forceUpdate ? 'none' : `transform ${this.scrollUpdateInterval / 1000}s linear`;
  }

  applyVideoStyles() {
    this.mainWrapper.style.cssText = '';
    this.videoWrapper.style.cssText = '';
    this.video.style.cssText = '';
    this.subtitleScrollContainer.style.cssText = '';
    this.subtitleDisplay.style.cssText = '';
    if (this.blurOverlay) this.blurOverlay.style.cssText = '';
    if (this.playOverlay) this.playOverlay.style.cssText = '';

    // FOUC fix: if not yet revealed, keep hidden after cssText reset
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
      const maxMobileWidth = Math.min(window.innerWidth * 0.99, 500);
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

    this.blurOverlay.style.position = 'absolute';
    this.blurOverlay.style.bottom = '0';
    this.blurOverlay.style.left = '0';
    this.blurOverlay.style.right = '0';
    this.blurOverlay.style.height = `${minSubtitleHeight}px`;
    this.blurOverlay.style.zIndex = '1';
    this.blurOverlay.style.pointerEvents = 'none';

    if (CSS.supports('backdrop-filter', 'blur(10px)')) {
      this.blurOverlay.style.backdropFilter = 'blur(10px)';
      this.blurOverlay.style.backgroundColor = 'rgba(0,0,0,0.15)';
    } else {
      this.blurOverlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
    }

    this.subtitleScrollContainer.style.position = 'absolute';
    this.subtitleScrollContainer.style.bottom = '0';
    this.subtitleScrollContainer.style.left = '0';
    this.subtitleScrollContainer.style.right = '0';
    this.subtitleScrollContainer.style.height = `${minSubtitleHeight}px`;
    this.subtitleScrollContainer.style.overflow = 'hidden';
    this.subtitleScrollContainer.style.zIndex = '2';

    this.subtitleDisplay.style.position = 'relative';
    this.subtitleDisplay.style.width = '100%';
    this.subtitleDisplay.style.padding = '10px 20px';
    this.subtitleDisplay.style.fontSize = isDesktop ? '1rem' : '1.2rem';
    this.subtitleDisplay.style.color = 'white';
    this.subtitleDisplay.style.textAlign = 'center';
    this.subtitleDisplay.style.boxSizing = 'border-box';
    this.subtitleDisplay.style.lineHeight = '1.3';
    this.subtitleDisplay.style.transition = 'transform 0.1s linear';
    this.subtitleDisplay.style.willChange = 'transform';
    this.subtitleDisplay.style.backgroundColor = 'transparent';

    // Apply config styles again to ensure they override defaults
    if (this.config.subtitleStyles) {
      Object.assign(this.subtitleDisplay.style, this.config.subtitleStyles);
    }

    if (window.innerWidth <= 768) {
      if (!this.config.subtitleStyles?.fontSize) {
        this.subtitleDisplay.style.fontSize = '1.1rem';
      }
    }

    this.playOverlay.style.position = 'absolute';
    this.playOverlay.style.top = '0';
    this.playOverlay.style.left = '0';
    this.playOverlay.style.width = '100%';
    this.playOverlay.style.height = '100%';
    this.playOverlay.style.display = 'flex';
    this.playOverlay.style.alignItems = 'center';
    this.playOverlay.style.justifyContent = 'center';
    this.playOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
    this.playOverlay.style.zIndex = '10';
    this.playOverlay.style.cursor = 'pointer';
    this.playOverlay.style.transition = 'opacity 0.3s ease';

    const iconContainer = this.playOverlay.querySelector('.ivp-play-icon-container');
    if (iconContainer) {
      iconContainer.style.display = 'flex';
      iconContainer.style.alignItems = 'center';
      iconContainer.style.justifyContent = 'center';
      iconContainer.style.width = '120px';
      iconContainer.style.height = '120px';
      iconContainer.style.transition = 'transform 0.2s ease';
    }

    const svgIcon = this.playOverlay.querySelector('svg');
    if (svgIcon) {
      svgIcon.style.width = '100px';
      svgIcon.style.height = '100px';
      svgIcon.style.color = 'white';
      svgIcon.style.filter = 'drop-shadow(0 0 8px rgba(0, 0, 0, 0.7))';
    }

    if (!('ontouchstart' in window)) {
      this.playOverlay.addEventListener('mouseenter', () => {
        if (iconContainer) iconContainer.style.transform = 'scale(1.1)';
      });
      this.playOverlay.addEventListener('mouseleave', () => {
        if (iconContainer) iconContainer.style.transform = 'scale(1)';
      });
    }

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
      .ivp-subtitle-scroll-container {}
      .ivp-subtitles {}
      .ivp-play-overlay {}

      @media (min-width: 768px) {
        .ivp-main-wrapper {
          max-width: 300px;
        }
      }

      @media (max-width: 768px) {
        .ivp-subtitles {
          font-size: 1.6rem !important;
        }
        .ivp-play-icon-container {
          width: 110px !important;
          height: 110px !important;
        }
        .ivp-play-overlay svg {
          width: 110px !important;
          height: 110px !important;
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
    window.removeEventListener('resize', this._applyVideoStyles);
    if (this.video) {
      this.video.removeEventListener('timeupdate', this._updateSubtitleScroll);
      this.video.removeEventListener('seeked', this._updateSubtitleScroll);
      this.video.removeEventListener('loadeddata', this._handleVideoLoaded);
      this.video.removeEventListener('canplay', this._handleVideoLoaded);
    }
  }
}
