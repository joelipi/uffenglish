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
        this.userRevealedIndices = new Set();
        this.speechRevealedIndices = new Set();
        this.autoRevealedIndices = new Set();
        this.unrevealedIndices = [];
        this.speechOverrides = new Map();
        this.extraWrongTokens = [];
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
        const cueText = typeof cue === 'object' ? cue?.en : cue;
        // Separate words (including contractions) from punctuation marks
        this.tokens = cueText.match(/\w+(?:['\u2019]\w+)*|[^\w\s]+/g) || [];
        this.punctuationMap = new Map();
        this.tokens.forEach((token, i) => {
            this.punctuationMap.set(i, /^[^\w]+$/.test(token));
        });
        this._resetRevealState();
    }

    _resetRevealState() {
        this.revealedIndices.clear();
        this.userRevealedIndices.clear();
        this.speechRevealedIndices.clear();
        this.autoRevealedIndices.clear();
        this.speechOverrides.clear();
        this.extraWrongTokens = [];
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
        let revealedNow = 0;
        while (revealedNow < count) {
            if (this.unrevealedIndices.length === 0) {
                // Refill pool with all hidden words that haven't been shown in this cycle
                this.tokens.forEach((_, i) => {
                    if (!this.punctuationMap.get(i) && !this.revealedIndices.has(i)) {
                        this.unrevealedIndices.push(i);
                    }
                });

                // If still empty (e.g. all words are already revealed by the user/speech), we're done
                if (this.unrevealedIndices.length === 0) break;

                this.reShuffleUnrevealed();
            }

            const idx = this.unrevealedIndices.pop();
            this.revealedIndices.add(idx);
            this.autoRevealedIndices.add(idx);
            revealedNow++;
        }
    }

    reShuffleUnrevealed() {
        this.unrevealedIndices = InteractiveVideoStateController.shuffle([...this.unrevealedIndices]);
    }

    _computeSubtitleTokens() {
        const result = [];
        let extraIdx = 0;

        const extrasBefore = new Map();
        this.extraWrongTokens.forEach(t => {
            const pos = t.position !== null && t.position !== undefined ? t.position : this.tokens.length;
            if (!extrasBefore.has(pos)) extrasBefore.set(pos, []);
            extrasBefore.get(pos).push(t);
        });

        this.tokens.forEach((token, i) => {
            if (extrasBefore.has(i)) {
                extrasBefore.get(i).forEach(t => {
                    result.push({
                        index: -(extraIdx + 1),
                        text: t.text,
                        isPunctuation: false,
                        revealed: true,
                        strikethrough: true,
                        clickable: false
                    });
                    extraIdx++;
                });
            }

            const isPunct = this.punctuationMap.get(i);
            const speechOverride = this.speechOverrides.get(i);
            const revealed = this.revealedIndices.has(i) || (speechOverride === 'revealed' || speechOverride === 'strikethrough');
            const strikethrough = speechOverride === 'strikethrough';
            const clickable = !revealed && !isPunct && !strikethrough;

            result.push({ index: i, text: token, isPunctuation: isPunct, revealed, strikethrough, clickable });
        });

        if (extrasBefore.has(this.tokens.length)) {
            extrasBefore.get(this.tokens.length).forEach(t => {
                result.push({
                    index: -(extraIdx + 1),
                    text: t.text,
                    isPunctuation: false,
                    revealed: true,
                    strikethrough: true,
                    clickable: false
                });
                extraIdx++;
            });
        }

        return result;
    }

    revealToken(index) {
        this.revealedIndices.add(index);
        this.userRevealedIndices.add(index);
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
            // Trigger Phase 2: First repetition at 100% speed
            this.isSecondPlay = false;
            this.useSlowSpeeds = false; // Start at 100%
            this.currentSpeedIndex = 0;
            
            // Clear only auto-revealed words
            this.autoRevealedIndices.forEach(idx => {
                if (!this.userRevealedIndices.has(idx) && !this.speechRevealedIndices.has(idx)) {
                    this.revealedIndices.delete(idx);
                    this.unrevealedIndices.push(idx);
                }
            });
            this.autoRevealedIndices.clear();
            this.reShuffleUnrevealed();

            if (this.config.onRepetition) {
                this.config.onRepetition();
            }

            this.setState({
                showOverlay: false,
                isPlaying: true,
                isSlowMode: false,
                playbackRate: 1.0,
                subtitleTokens: this._computeSubtitleTokens()
            });
        }
    }

    applySpeechResult(correctIndices, wrongIndices, extraWrongWords = []) {
        correctIndices.forEach(idx => {
            this.speechOverrides.set(idx, 'revealed');
            this.revealedIndices.add(idx);
            this.speechRevealedIndices.add(idx);
            this.unrevealedIndices = this.unrevealedIndices.filter(i => i !== idx);
        });
        wrongIndices.forEach(idx => {
            this.speechOverrides.set(idx, 'strikethrough');
        });
        this.extraWrongTokens = extraWrongWords.map(w =>
            typeof w === 'string' ? { text: w, position: null } : { text: w.text, position: w.position !== undefined ? w.position : null }
        );
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

    cancelOverlayTimer() {
        if (this._overlayTimer) {
            clearTimeout(this._overlayTimer);
            this._overlayTimer = null;
        }
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
            // If we just finished the 100% repetition post-overlay, now start slow speeds
            if (!this.useSlowSpeeds) {
                this.useSlowSpeeds = true;
                this.currentSpeedIndex = 0;
            } else {
                // Advance speed index only after we are already in slow mode
                this.currentSpeedIndex = (this.currentSpeedIndex + 1) % this.slowSpeeds.length;
            }

            // Hide previous auto-revealed words to make room for new ones.
            // We no longer push them back into unrevealedIndices here; 
            // instead, they stay "used" until the entire cycle finishes and the pool refills.
            this.autoRevealedIndices.forEach(idx => {
                if (!this.userRevealedIndices.has(idx) && !this.speechRevealedIndices.has(idx)) {
                    this.revealedIndices.delete(idx);
                }
            });
            this.autoRevealedIndices.clear();
            this.reShuffleUnrevealed();

            // Use only the count of actual words (excluding punctuation) to determine reveal density
            const wordCount = this.tokens.filter((_, i) => !this.punctuationMap.get(i)).length;
            const revealCount = Math.floor(wordCount / 8) + 1;
            this._revealNextWords(revealCount);

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