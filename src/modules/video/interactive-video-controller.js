// modules/interactive-video-controller.js

import { getCueText } from '../utils/utils.js';

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

        this.currentSpeedIndex = 0;
        this.isFirstPlay = true;
        this.isSecondPlay = false;
        this.hasStartedPlaying = false;

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
        const cueText = getCueText(cue);
        this.tokens = cueText.match(/\w+(?:['\u2019]\w+)*|[^\w\s]+/g) || [];
        this.punctuationMap = new Map();
        this.tokens.forEach((token, i) => {
            this.punctuationMap.set(i, /^[^\w]+$/.test(token));
        });
        this._resetRevealState();
    }

    // Re-tokenize the controller to a specific cue text (e.g. the best-matching
    // variant of an array cue, chosen once the user has spoken). Clears prior
    // reveal/speech state and refreshes the rendered subtitle tokens.
    setCueText(cueText) {
        this.initTokens(cueText);
        this.setState({ subtitleTokens: this._computeSubtitleTokens() });
    }

    _resetRevealState() {
        this.revealedIndices.clear();
        this.userRevealedIndices.clear();
        this.speechRevealedIndices.clear();
        this.autoRevealedIndices.clear();
        this.speechOverrides.clear();
        this.extraWrongTokens = [];
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
                this.tokens.forEach((_, i) => {
                    if (!this.punctuationMap.get(i) && !this.revealedIndices.has(i)) {
                        this.unrevealedIndices.push(i);
                    }
                });

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

    dismissOverlay({ replay = true } = {}) {
        if (this.state.showOverlay) {
            this.isSecondPlay = false;
            this.useSlowSpeeds = false; 
            this.currentSpeedIndex = 0;
            
            this.autoRevealedIndices.forEach(idx => {
                if (!this.userRevealedIndices.has(idx) && !this.speechRevealedIndices.has(idx)) {
                    this.revealedIndices.delete(idx);
                    this.unrevealedIndices.push(idx);
                }
            });
            this.autoRevealedIndices.clear();
            this.reShuffleUnrevealed();

            this.setState({
                showOverlay: false,
                isPlaying: replay,
                isSlowMode: false,
                playbackRate: 1.0,
                subtitleTokens: replay ? this._computeSubtitleTokens() : []
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

        // Once speech results are applied, the controller is past the first-play
        // state. Without this, if handleLoop() fires (video ends after wrong-answer
        // replay) it would see isFirstPlay===true, show the "Understand 100%?" overlay,
        // and hard-wipe subtitleTokens with an empty array.
        this.isFirstPlay = false;

        this.setState({ subtitleTokens: this._computeSubtitleTokens() });
    }

    // --- Core Actions ---
    play() {
        this.setState({ isPlaying: true });
    }

    pause() {
        this.setState({ isPlaying: false });
    }

    destroy() {
        this.subscribers.clear();
        this.config.onRepetition = null;
        this.config.onWordReveal = null;
    }

    setLoaded() {
        if (!this.state.isLoaded) {
            this.setState({ isLoaded: true });
        }
    }

    handleLoop() {
        if (this.isFirstPlay) {
            this.isFirstPlay = false;
            this.isSecondPlay = true;
            this.setState({
                isPlaying: false,
                showOverlay: true,
                subtitleTokens: []
            });
            return;
        } else if (this.isSecondPlay) {
            this.dismissOverlay();
            return;
        } else {
            if (!this.useSlowSpeeds) {
                this.useSlowSpeeds = true;
                this.currentSpeedIndex = 0;
            } else {
                this.currentSpeedIndex = (this.currentSpeedIndex + 1) % this.slowSpeeds.length;
            }

            this.autoRevealedIndices.forEach(idx => {
                if (!this.userRevealedIndices.has(idx) && !this.speechRevealedIndices.has(idx)) {
                    this.revealedIndices.delete(idx);
                }
            });
            this.autoRevealedIndices.clear();
            this.reShuffleUnrevealed();

            const wordCount = this.tokens.filter((_, i) => !this.punctuationMap.get(i)).length;
            const revealCount = Math.floor(wordCount / 8) + 1;
            this._revealNextWords(revealCount);

            if (this.config.onRepetition) {
                this.config.onRepetition();
            }
        }

        const newPlaybackRate = this.useSlowSpeeds ? this.slowSpeeds[this.currentSpeedIndex] : this.config.speeds[this.currentSpeedIndex];
        const newSubtitleTokens = this._computeSubtitleTokens();

        this.setState({
            isPlaying: true, 
            isSlowMode: this.useSlowSpeeds,
            playbackRate: newPlaybackRate,
            subtitleTokens: newSubtitleTokens
        });
    }
}