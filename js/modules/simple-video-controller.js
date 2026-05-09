/**
 * Platform-Agnostic Video Logic Controller
 * Manages pure state (playing, loaded, scroll math) completely separated from the DOM/React Native UI.
 */
export class SimpleVideoStateController {
    constructor(config = {}) {
        this.config = {
            scrollSpeed: 1.0,
            scrollSubtitles: true,
            ...config
        };

        this.state = {
            isPlaying: false,
            isLoaded: false,
            scrollRatio: 0,
            isTimedSubtitles: false,
            timedSubtitles: [],       // Array of { start: Number, end: Number, text: String }
            activeSubtitleText: ''    // Current subtitle string to display; empty string between cues
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

    // --- Subtitles ---
    _timeToSeconds(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length < 3) return 0;

        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        const secondsParts = parts[2].split(/[,.]/);
        const seconds = parseInt(secondsParts[0], 10);
        const milliseconds = secondsParts.length > 1 ? parseInt(secondsParts[1], 10) : 0;

        return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
    }

    initSubtitles(text) {
        if (!text || typeof text !== 'string') {
            return;
        }

        if (text.indexOf('-->') === -1) {
            this.setState({ isTimedSubtitles: false, activeSubtitleText: text });
            return;
        }

        const parsed = [];
        const blocks = text.split(/\r?\n\s*\r?\n/);

        for (const block of blocks) {
            const lines = block.split(/\r?\n/);
            const timeLineIndex = lines.findIndex(line => line.indexOf('-->') !== -1);
            if (timeLineIndex === -1) continue;

            const timeLine = lines[timeLineIndex];
            const textLines = lines.slice(timeLineIndex + 1);
            const textContent = textLines.join('<br>');

            const timeParts = timeLine.split('-->');
            const startStr = timeParts[0].trim();
            const endStr = timeParts[1].trim();

            const start = this._timeToSeconds(startStr);
            const end = this._timeToSeconds(endStr);

            if (isNaN(start) || isNaN(end)) continue;

            parsed.push({ start, end, text: textContent });
        }

        this.setState({ isTimedSubtitles: parsed.length > 0, timedSubtitles: parsed, activeSubtitleText: '' });
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
        const updates = {};

        if (this.config.scrollSubtitles && duration && duration > 0 && !isNaN(duration)) {
            updates.scrollRatio = Math.max(0, Math.min(0.95, (currentTime / duration) * this.config.scrollSpeed));
        }

        if (this.state.isTimedSubtitles) {
            let foundText = '';
            for (let i = 0; i < this.state.timedSubtitles.length; i++) {
                const sub = this.state.timedSubtitles[i];
                if (currentTime >= sub.start && currentTime <= sub.end) {
                    foundText = sub.text;
                    break;
                }
            }
            if (foundText !== this.state.activeSubtitleText) {
                updates.activeSubtitleText = foundText;
            }
        }

        if (Object.keys(updates).length > 0) {
            this.setState(updates);
        }
    }
}
