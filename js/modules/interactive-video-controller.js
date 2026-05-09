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
        this.revealedIndices = new Set();
        this.unrevealedIndices = [];
        this.speechOverrides = new Map();
        this.slowSpeeds = [0.6, 0.75];
        this.useSlowSpeeds = false;
        this._overlayTimer = null;

        this.currentSpeedIndex = 0;
        this.isFirstPlay = true;
        this.isSecondPlay = false;

        // Reactive UI State
        this.state = {
            isPlaying: false,
            isLoaded: false,
            playbackRate: 1.0,
            subtitleTokens: [],
            showOverlay: false,
            isSlowMode: false
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
        this.punctuationMap = new Map();
        this.tokens.forEach((token, i) => {
            this.punctuationMap.set(i, /^[^\w]+$/.test(token));
        });
        this._resetRevealState();
    }

    _resetRevealState() {
        this.revealedIndices.clear();
        this.speechOverrides.clear();
        if (this._overlayTimer) {
            clearTimeout(this._overlayTimer);
            this._overlayTimer = null;
        }
        this.unrevealedIndices = [];
        this.tokens.forEach((_, i) => {
            if (!this.punctuationMap.get(i)) {
                this.unrevealedIndices.push(i);
            }
        });
        this.reShuffleUnrevealed();
    }

    _revealNextWords(count) {
        if (this.unrevealedIndices.length === 0) {
            this.tokens.forEach((_, i) => {
                if (!this.punctuationMap.get(i) && !this.revealedIndices.has(i)) {
                    this.unrevealedIndices.push(i);
                }
            });
            this.reShuffleUnrevealed();
        }

        const toReveal = Math.min(count, this.unrevealedIndices.length);
        for (let i = 0; i < toReveal; i++) {
            const idx = this.unrevealedIndices.pop();
            this.revealedIndices.add(idx);
        }
    }

    reShuffleUnrevealed() {
        this.unrevealedIndices = InteractiveVideoStateController.shuffle([...this.unrevealedIndices]);
    }

    _computeSubtitleTokens() {
        return this.tokens.map((token, i) => {
            const isPunct = this.punctuationMap.get(i);
            const speechOverride = this.speechOverrides.get(i);
            const revealed = this.revealedIndices.has(i) || (speechOverride === 'revealed' || speechOverride === 'strikethrough');
            const strikethrough = speechOverride === 'strikethrough';
            const clickable = !revealed && !isPunct && !strikethrough;

            return { index: i, text: token, isPunctuation: isPunct, revealed, strikethrough, clickable };
        });
    }

    revealToken(index) {
        this.revealedIndices.add(index);
        this.unrevealedIndices = this.unrevealedIndices.filter(i => i !== index);
        if (this.config.onWordReveal) {
            this.config.onWordReveal(index);
        }
        this.setState({ subtitleTokens: this._computeSubtitleTokens() });
    }

    dismissOverlay() {
        if (this._overlayTimer) {
            clearTimeout(this._overlayTimer);
            this._overlayTimer = null;
        }
        if (this.state.showOverlay) {
            // Trigger phase 2 immediately on dismissal
            this.isSecondPlay = false;
            this.useSlowSpeeds = true;
            this.currentSpeedIndex = 0;
            this.revealedIndices.clear();

            if (this.config.onRepetition) {
                this.config.onRepetition();
            }

            this.setState({
                showOverlay: false,
                isPlaying: true,
                isSlowMode: true,
                playbackRate: this.slowSpeeds[this.currentSpeedIndex],
                subtitleTokens: this._computeSubtitleTokens()
            });
        }
    }

    applySpeechResult(correctIndices, wrongIndices) {
        correctIndices.forEach(idx => {
            this.speechOverrides.set(idx, 'revealed');
            this.revealedIndices.add(idx);
            this.unrevealedIndices = this.unrevealedIndices.filter(i => i !== idx);
        });
        wrongIndices.forEach(idx => {
            this.speechOverrides.set(idx, 'strikethrough');
        });
        this.setState({ subtitleTokens: this._computeSubtitleTokens() });
    }

    // --- Core Actions ---
    play() {
        if (this.isFirstPlay) {
            // Ensure subtitles are cleared on the very first user interaction
            this.setState({ isPlaying: true, subtitleTokens: [] });
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
            this.setState({
                isPlaying: false,
                showOverlay: true,
                subtitleTokens: []
            });
            this._overlayTimer = setTimeout(() => {
                this.dismissOverlay();
            }, 3000);
            return;
        } else if (this.isSecondPlay) {
            // Fallback if not caught by dismiss overlay
            this.dismissOverlay();
            return;
        } else {
            const revealCount = Math.floor(this.tokens.length / 8) + 1;
            this._revealNextWords(revealCount);

            this.currentSpeedIndex = (this.currentSpeedIndex + 1) % this.slowSpeeds.length;

            if (this.config.onRepetition) {
                this.config.onRepetition();
            }
        }

        // Compute New Rates and Text
        const newPlaybackRate = this.useSlowSpeeds ? this.slowSpeeds[this.currentSpeedIndex] : this.config.speeds[this.currentSpeedIndex];
        const newSubtitleTokens = this._computeSubtitleTokens();

        this.setState({
            isPlaying: true, // Auto-play continues on loop
            playbackRate: newPlaybackRate,
            subtitleTokens: newSubtitleTokens
        });
    }
}