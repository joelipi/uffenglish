export class introBackgroundVideo {
  constructor(config) {
    // FOUC fix: inject styles before any DOM work so .d-none rule exists immediately
    this.injectStyles();

    const defaults = {
      videoUrl: '',
      containerSelector: 'body',
      videoStyles: {}
    };

    this.config = { ...defaults, ...config };
    this.validateInput();
    
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    this.isVideoLoaded = false;

    this.initContainer();
    this.initVideo();
    this.initCallNotification();
    this.addClickHandler();
  }

  validateInput() {
    if (!this.config.videoUrl) throw new Error('videoUrl is required');
    if (!document.querySelector(this.config.containerSelector)) {
      throw new Error('Container element not found');
    }
  }

  initContainer() {
    this.container = document.querySelector(this.config.containerSelector);
    this.mainWrapper = document.createElement('div');
    this.mainWrapper.className = 'intro-video-wrapper';
    this.mainWrapper.style.visibility = 'hidden'; // prevent FOUC

    this.container.style.margin = '0';
    this.container.style.padding = '0';
    this.container.style.overflowX = 'hidden';
    this.container.style.overflowY = 'hidden';
    this.container.appendChild(this.mainWrapper);
  }

  initVideo() {
    this.videoWrapper = document.createElement('div');
    this.videoWrapper.className = 'intro-video-container';
    
    this.video = document.createElement('video');
    this.video.className = 'intro-video';
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('preload', 'auto');
    this.video.setAttribute('crossorigin', 'anonymous');
    this.video.muted = true;
    this.video.src = this.config.videoUrl;

    // Only load first frame, don't play
    this.video.addEventListener('loadeddata', () => {
      this.isVideoLoaded = true;
      this.video.currentTime = 0;
      this.video.pause();
      this.applyVideoStyles();

    // Reveal only after styles are applied and frame is painted
      requestAnimationFrame(() => {
      requestAnimationFrame(() => {
      this.mainWrapper.style.visibility = 'visible';
    });
  });
});

    this.videoWrapper.appendChild(this.video);
    this.mainWrapper.appendChild(this.videoWrapper);
  }

  initCallNotification() {
    this.blurOverlay = document.createElement('div');
    this.blurOverlay.className = 'intro-blur-overlay';
    this.videoWrapper.appendChild(this.blurOverlay);

    this.notificationContent = document.createElement('div');
    this.notificationContent.className = 'intro-notification-content';
    this.notificationContent.innerHTML = `
      <div class="intro-notification-top">
        <div class="intro-call-title">
          <i class="bi bi-camera-video-fill text-white"></i>
          INCOMING VIDEO
        </div>
        <div class="intro-call-subtitle"><span lang="es"><i>VIDEO ENTRANTE</i></span></div>
      </div>
      <div class="intro-notification-bottom">
        <div class="intro-caller-name">Joe Walsh</div>
        <div class="intro-caller-title">English Coach, UFF</div>
      </div>
    `;
    this.videoWrapper.appendChild(this.notificationContent);
  }

  applyVideoStyles() {
    this.mainWrapper.style.cssText = '';
    this.videoWrapper.style.cssText = '';
    this.video.style.cssText = '';
    this.blurOverlay.style.cssText = '';
    this.notificationContent.style.cssText = '';

    // Main wrapper styling
    this.mainWrapper.style.display = 'flex';
    this.mainWrapper.style.flexDirection = 'column';
    this.mainWrapper.style.alignItems = 'center';
    this.mainWrapper.style.justifyContent = 'center';
    this.mainWrapper.style.width = '100%';
    this.mainWrapper.style.margin = '0 auto';

    // Video container styling with animation
    const isDesktop = window.innerWidth > 800;
    const videoWidth = isDesktop ? 300 : Math.min(window.innerWidth * 0.9, 300);
    const videoHeight = videoWidth * (4/3);

    this.videoWrapper.style.width = `${videoWidth}px`;
    this.videoWrapper.style.height = `${videoHeight}px`;
    this.videoWrapper.style.position = 'relative';
    this.videoWrapper.style.overflow = 'hidden';
    this.videoWrapper.style.borderRadius = '12px';
    this.videoWrapper.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.3)';
    this.videoWrapper.style.transform = 'scale(0.95)';
    this.videoWrapper.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
    
    // Add ring animation (shake + pulse)
    this.videoWrapper.classList.add('ringing-animation');

    // Video styling
    this.video.style.position = 'absolute';
    this.video.style.top = '0';
    this.video.style.left = '0';
    this.video.style.width = '100%';
    this.video.style.height = '100%';
    this.video.style.objectFit = 'cover';
    
    // Less dark overlay
    this.blurOverlay.style.position = 'absolute';
    this.blurOverlay.style.top = '0';
    this.blurOverlay.style.left = '0';
    this.blurOverlay.style.width = '100%';
    this.blurOverlay.style.height = '100%';
    this.blurOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; // Less dark
    this.blurOverlay.style.zIndex = '1';
    
    // Notification content styling
    this.notificationContent.style.position = 'absolute';
    this.notificationContent.style.top = '0';
    this.notificationContent.style.left = '0';
    this.notificationContent.style.width = '100%';
    this.notificationContent.style.height = '100%';
    this.notificationContent.style.display = 'flex';
    this.notificationContent.style.flexDirection = 'column';
    this.notificationContent.style.justifyContent = 'space-between';
    this.notificationContent.style.alignItems = 'center';
    this.notificationContent.style.zIndex = '2';
    this.notificationContent.style.color = 'white';
    this.notificationContent.style.textAlign = 'center';
    this.notificationContent.style.padding = '5px';
    this.notificationContent.style.boxSizing = 'border-box';
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap');
      @import url('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css');

      .d-none { display: none !important; }
      
      .intro-video-container {
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      
      .intro-notification-content {
        font-family: 'Plus Jakarta Sans', sans-serif !important;
      }
      
      .intro-notification-top {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-top: 20px;
      }
      
      .intro-notification-bottom {
        display: flex;
        flex-direction: column;
        margin-bottom: 30px;
      }
      
      .intro-call-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 1.2rem;
        font-weight: 700;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      
      .intro-call-subtitle {
        font-size: 0.9rem;
        opacity: 0.9;
        font-style: italic;
      }
      
      .intro-caller-name {
        font-size: 1.4rem;
        font-weight: 700;
        margin-bottom: 5px;
      }
      
      .intro-caller-title {
        font-size: 1rem;
        opacity: 0.8;
      }
      
      /* Ringing animation */
      @keyframes ring-shake {
        0%, 100% { transform: rotate(0) scale(0.95); }
        25% { transform: rotate(-2deg) scale(0.97); }
        50% { transform: rotate(2deg) scale(0.99); }
        75% { transform: rotate(-1deg) scale(0.97); }
      }
      
      @keyframes ring-pulse {
        0%, 100% { box-shadow: 0 0 15px rgba(255, 0, 0, 0.4); }
        50% { box-shadow: 0 0 25px rgba(255, 0, 0, 0.7); }
      }
      
      .ringing-animation {
        animation: ring-shake 0.8s infinite ease-in-out, ring-pulse 1.5s infinite ease-in-out;
      }
      
      @media (max-width: 768px) {
        .intro-call-title {
          font-size: 1.1rem;
        }
        
        .intro-caller-name {
          font-size: 1.3rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  addClickHandler() {
    this.videoWrapper.addEventListener('click', () => {
      alert("Press the webcam button below. Oprime el botón de cámara abajo.");
    });
  }

  destroy() {
    if (this.mainWrapper && this.mainWrapper.parentNode) {
      this.mainWrapper.parentNode.removeChild(this.mainWrapper);
    }
  }
}
