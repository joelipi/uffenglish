/**
 * Platform-Agnostic Video Logic Controller
 * Manages pure state (playing, loaded, scroll math) completely separated from the DOM/React Native UI.
 */
export class VideoStateController {
    constructor(config = {}) {
        this.config = {
            scrollSpeed: 1.0,
            scrollSubtitles: true,
            ...config
        };

        this.state = {
            isPlaying: false,
            isLoaded: false,
            scrollRatio: 0
        };

        this.subscribers = new Set();
    }

    // --- State Subscriptions ---
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    _notify() {
        this.subscribers.forEach(callback => callback(this.state));
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this._notify();
    }

    // --- Core Actions ---
    play() {
        this.setState({ isPlaying: true });
    }

    pause() {
        this.setState({ isPlaying: false });
    }

    setLoaded() {
        if (!this.state.isLoaded) {
            this.setState({ isLoaded: true });
        }
    }

    updateProgress(currentTime, duration) {
        if (!this.config.scrollSubtitles) return;

        // On Android, duration is overridden to NaN via Object.defineProperty
        // in disableMediaSession() to suppress the media notification.
        // This intentionally prevents subtitle scrolling on Android — accepted tradeoff.
        if (!duration || duration <= 0 || isNaN(duration)) return;

        const scrollRatio = Math.max(0, Math.min(0.95, (currentTime / duration) * this.config.scrollSpeed));
        this.setState({ scrollRatio });
    }
}
