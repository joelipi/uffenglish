export class IntroBackgroundVideoUI {
  constructor(config, onLoadedData, onClick) {
    this.widget = document.getElementById('intro-call-widget');
    if (!this.widget) return;

    this.video = this.widget.querySelector('.intro-video');
    this.onClick = onClick;
    this.onLoadedData = onLoadedData;
    this.config = config;

    this.initText();
    this.initVideo();
    this.initClick();

    // Hide standard video containers to prevent stacking
    ['#ivp-container', '#simple-ivp-container'].forEach(selector => {
      const el = document.querySelector(selector);
      if (el) el.classList.add('d-none');
    });
  }

  initText() {
    const title = document.getElementById('intro-title');
    if (title) title.textContent = this.config.title;

    const subtitle = document.getElementById('intro-subtitle');
    if (subtitle) subtitle.textContent = this.config.subtitle;

    const name = document.getElementById('intro-name');
    if (name) name.textContent = this.config.name;

    const role = document.getElementById('intro-role');
    if (role) role.textContent = this.config.role;
  }

  initVideo() {
    // Attach listener before setting src to catch immediate loads
    this.video.addEventListener('loadeddata', this.onLoadedData);
    this.video.src = this.config.videoUrl;
    
    // If the video is already cached and loaded
    if (this.video.readyState >= 2) {
      this.onLoadedData();
    }
  }

  pauseVideo() {
    if (this.video) {
      this.video.pause();
    }
  }

  resetVideoTime() {
    if (this.video) {
      this.video.currentTime = 0;
    }
  }

  showWidget() {
    if (this.widget) {
      this.widget.classList.remove('d-none');
    }
  }

  initClick() {
    this.widget.addEventListener('click', this.onClick);
  }

  bounceButton() {
    const btn = document.getElementById('continueButton') || document.getElementById('speechButton');
    if (btn) {
      btn.classList.remove('btn-bounce');
      void btn.offsetWidth; // trigger reflow
      btn.classList.add('btn-bounce');
      
      setTimeout(() => {
        btn.classList.remove('btn-bounce');
      }, 1000);
    }
  }

  destroy() {
    if (this.widget) {
      this.widget.classList.add('d-none');
      this.widget.removeEventListener('click', this.onClick);
    }
    if (this.video) {
      this.video.removeEventListener('loadeddata', this.onLoadedData);
      this.video.pause();
      this.video.src = '';
    }
  }
}

export class introBackgroundVideo {
  constructor(config) {
    const defaults = {
      videoUrl: '',
      title: 'INCOMING VIDEO',
      subtitle: 'VIDEO ENTRANTE',
      name: 'Joe Walsh',
      role: 'English Coach, UFF'
    };

    this.config = { ...defaults, ...config };
    if (!this.config.videoUrl) throw new Error('videoUrl is required');

    this.onClick = this.handleClick.bind(this);
    this.onLoadedData = this.handleLoadedData.bind(this);

    // Initialize UI if we are in a browser environment
    if (typeof document !== 'undefined') {
      this.ui = new IntroBackgroundVideoUI(this.config, this.onLoadedData, this.onClick);
    }
  }

  handleLoadedData() {
    if (this.ui) {
      this.ui.resetVideoTime();
      this.ui.pauseVideo();
    }

    // Reveal only after frame is painted
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this.ui) {
            this.ui.showWidget();
          }
        });
      });
    }
  }

  handleClick() {
    if (this.ui) {
      this.ui.bounceButton();
    }
  }

  destroy() {
    if (this.ui) {
      this.ui.destroy();
    }
  }
}
