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

    this.widget = document.getElementById('intro-call-widget');
    if (!this.widget) return;

    this.video = this.widget.querySelector('.intro-video');
    this.onClick = this.handleClick.bind(this);
    this.onLoadedData = this.handleLoadedData.bind(this);

    this.initText();
    this.initVideo();
    this.initClick();

    // Hide standard video container to prevent stacking
    const ivp = document.getElementById('ivp-container');
    if (ivp) ivp.classList.add('d-none');
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
      this.handleLoadedData();
    }
  }

  handleLoadedData() {
    this.video.currentTime = 0;
    this.video.pause();

    // Reveal only after frame is painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.widget.classList.remove('d-none');
      });
    });
  }

  initClick() {
    // Keep backwards compatibility by still adding the listener to the widget if the buttons are missed
    this.widget.addEventListener('click', this.onClick);

    const btnAccept = this.widget.querySelector('.intro-btn-accept');
    const btnDecline = this.widget.querySelector('.intro-btn-decline');

    if (btnAccept) {
      btnAccept.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent bubbling to widget click
        this.handleClick(); // Simulate accepting the call
      });
    }

    if (btnDecline) {
      btnDecline.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleClick(); // Same behavior for now
      });
    }
  }

  handleClick() {
    const btn = document.getElementById('continueButton') || document.getElementById('speechButton');
    if (btn) {
      // Rather than just bouncing, if it's the green accept we could just click it.
      // But bouncing the continue button is the standard flow, let's keep it consistent
      // but also directly click it to save the user a tap
      btn.click();

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
