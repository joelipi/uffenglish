// modules/interactive-video-controller.js

/**
 * Platform-Agnostic Interactive Video Logic Controller
 * Manages pure state (masked subtitles, playback rates, loop counts) separated from the DOM.
 */
export class InteractiveVideoStateController {
    constructor(config = {}) {
        this.config = {
            cue: '',
            speeds: [0.75, 0.6, 1],
            ...config
        };

        // Internal Logic State
        this.tokens = [];
        this.originalIndices = [];
        this.shuffledIndices = [];
        this.currentRevealStart = 0;
        this.currentSpeedIndex = 0;
        this.isFirstPlay = true;
        this.isSecondPlay = false;

        // Reactive UI State
        this.state = {
            isPlaying: false,
            isLoaded: false,
            playbackRate: 1.0,
            subtitleText: ''
        };

        this.subscribers = new Set();

        if (this.config.cue) {
            this.initTokens(this.config.cue);
        }
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

    // --- Internal Text Logic ---
    static shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    initTokens(cue) {
        this.tokens = cue.split(/\s+/);
        this.originalIndices = Array.from({ length: this.tokens.length }, (_, i) => i);
        this.shuffledIndices = InteractiveVideoStateController.shuffle([...this.originalIndices]);
    }

    _computeSubtitleText() {
        if (this.isFirstPlay || this.isSecondPlay) {
            return '';
        }

        const revealCount = Math.floor(this.tokens.length / 8) + 1;
        const currentIndices = this.shuffledIndices.slice(
            this.currentRevealStart,
            this.currentRevealStart + revealCount
        );

        return this.tokens
            .map((token, index) => currentIndices.includes(index) ? token : token.replace(/[\p{L}\p{N}]/gu, '_'))
            .join(' ');
    }

    // --- Core Actions ---
    play() {
        if (this.isFirstPlay) {
            // Ensure subtitles are cleared on the very first user interaction
            this.setState({ isPlaying: true, subtitleText: '' });
        } else {
            this.setState({ isPlaying: true });
        }
    }

    pause() {
        this.setState({ isPlaying: false });
    }

    setLoaded() {
        if (!this.state.isLoaded) {
            this.setState({ isLoaded: true });
        }
    }

    handleLoop() {
        // Advance State Logic
        if (this.isFirstPlay) {
            this.isFirstPlay = false;
            this.isSecondPlay = true;
        } else if (this.isSecondPlay) {
            this.isSecondPlay = false;
            this.currentSpeedIndex = 0;
            this.currentRevealStart = 0;
        } else {
            const revealCount = Math.floor(this.tokens.length / 8) + 1;
            this.currentRevealStart += revealCount;

            if (this.currentRevealStart >= this.shuffledIndices.length) {
                this.shuffledIndices = InteractiveVideoStateController.shuffle([...this.originalIndices]);
                this.currentRevealStart = 0;
            }
            this.currentSpeedIndex = (this.currentSpeedIndex + 1) % this.config.speeds.length;
        }

        // Compute New Rates and Text
        const newPlaybackRate = (this.isFirstPlay || this.isSecondPlay) ? 1.0 : this.config.speeds[this.currentSpeedIndex];
        const newSubtitleText = this._computeSubtitleText();

        this.setState({
            isPlaying: true, // Auto-play continues on loop
            playbackRate: newPlaybackRate,
            subtitleText: newSubtitleText
        });
    }
}