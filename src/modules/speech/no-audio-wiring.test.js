// Wiring guards for the no-audio recovery. The behavioural tests cover the
// orchestrator and the adapter; these prove the UI contract is actually
// connected — a message the learner cannot act on was the original bug.
// (stories/087-no-audio-capture)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, p), 'utf8');

function hookBlock(source, hookName, nextHookName) {
    const start = source.indexOf(`${hookName}:`);
    expect(start, `${hookName} is not defined`).toBeGreaterThan(-1);
    const end = source.indexOf(`${nextHookName}:`, start);
    expect(end, `${nextHookName} does not follow ${hookName}`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('no-audio capture wiring', () => {
    const executor = read('../lesson/step-executor-webonly.js');

    it('defines onNoAudioCaptured showing the localized message without a penalty', () => {
        const block = hookBlock(executor, 'onNoAudioCaptured', 'onGibberishDetected');

        expect(block).toContain("Strings.get('error_no_audio_captured'");
        expect(block).toContain('applyNoAudioRecovery(appStore');
        expect(block).not.toContain('deductSpeakingScore');
    });

    it('clears the dead take and returns to the recording UI from the no-audio path', () => {
        const recovery = read('../lesson/no-audio-recovery-logic.js');
        const start = recovery.indexOf('export function applyNoAudioRecovery');
        const end = recovery.indexOf('returnToRecordingPhase(store);', start);
        const body = recovery.slice(start, end + 'returnToRecordingPhase(store);'.length);

        expect(body).toContain('clearRecordedAudioPeaks()');
        expect(body).toContain('clearPlaybackBlob()');
        expect(body).toContain('NO_AUDIO_MESSAGE_TYPE');
        expect(body).not.toContain('deductSpeakingScore');
        expect(recovery).toContain("transitionTo('recording/answering')");
    });

    it('returns the learner to the recording UI from the empty-transcript path', () => {
        const block = hookBlock(executor, 'onStopEarly', 'onNoAudioCaptured');

        expect(block).toContain('returnToRecordingPhase(appStore)');
    });

    it('renders the no-audio message type in the status component', () => {
        const micStatus = read('../../components/widgets/MicStatusText.jsx');
        const iconStart = micStatus.indexOf('function renderIcon');
        const iconEnd = micStatus.indexOf('function colorClass');
        expect(iconStart).toBeGreaterThan(-1);
        expect(iconEnd).toBeGreaterThan(iconStart);

        expect(micStatus.slice(iconStart, iconEnd)).toContain("case 'no-audio':");
        expect(micStatus.slice(iconEnd)).toContain("case 'no-audio':");
    });

    it('classifies the capture before the orchestrator reaches Whisper', () => {
        const orchestrator = read('./speech-orchestrator.js');
        const classify = orchestrator.indexOf('Core.analyzeCapturedAudio(rawAudioData)');
        const transcribe = orchestrator.indexOf('transcribeAudioBuffer(');

        expect(classify).toBeGreaterThan(-1);
        expect(transcribe).toBeGreaterThan(classify);
        expect(orchestrator).toContain('uiHooks.onNoAudioCaptured');
    });
});
