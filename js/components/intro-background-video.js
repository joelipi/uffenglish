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
    if (!this.video) return;
    this.onClick = this.handleClick.bind(this);
    this.onLoadedData = this.handleLoadedData.bind(this);

    this.initText();
    this.initVideo();
    this.initClick();
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
    this.video.addEventListener('loadeddata', this.onLoadedData);
    this.video.src = this.config.videoUrl;

    if (this.video.readyState >= 2) {
      this.handleLoadedData();
    }
  }

  handleLoadedData() {
    this.video.currentTime = 0;
    this.video.pause();
  }

  initClick() {
    this.widget.addEventListener('click', this.onClick);
  }

  handleClick() {
    const btn = document.getElementById('micBtn');
    if (btn) {
      btn.classList.remove('btn-bounce');
      void btn.offsetWidth;
      btn.classList.add('btn-bounce');

      setTimeout(() => {
        btn.classList.remove('btn-bounce');
      }, 1000);
    }
  }

  destroy() {
    if (this.widget) {
      this.widget.removeEventListener('click', this.onClick);
    }
    if (this.video) {
      this.video.removeEventListener('loadeddata', this.onLoadedData);
      this.video.pause();
      this.video.src = '';
    }
  }
}
