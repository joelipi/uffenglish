// tests/recording-persistence.spec.js
// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Recording Persistence', () => {
    let errors = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401'];
                if (!noise.some(n => text.includes(n))) errors.push(text);
            }
        });
    });

    test('text-mode recordings survive a full page reload', async ({ page }) => {
        test.setTimeout(60000);

        const diagLogs = [];
        page.on('console', msg => {
            if (msg.text().includes('[DIAG]')) diagLogs.push(msg.text());
        });

        // Phase 1: navigate, set text mode, save a recording.
        await page.goto('/course/model/lesson/g');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        // Wait for LessonContainer to set activeLessonId from the URL param.
        await page.waitForFunction(() => window.appStore?.getState()?.activeLessonId === 'g', { timeout: 20000 });

        const lessonId = 'g';

        await page.evaluate(async (lid) => {
            const state = window.appStore.getState();
            window.appStore.setState({
                userData: { ...(state.userData || {}), profilePictureUrl: '/assets/img/userprofile.png' },
                isTextMode: true
            });

            const { saveSpeechRecording, clearSpeechRecordingsForLesson, updateSpeechRecording } = await import('/src/modules/storage/storage.js');
            await clearSpeechRecordingsForLesson(lid);
            await saveSpeechRecording(null, {
                lessonId: lid,
                stepIndex: 0,
                userResponse: 'Persistence test answer',
                isTextMode: true,
                duration: 3,
            });
            await updateSpeechRecording(lid, 0, { matchedCue: 'test cue', translation: 'test translation' });
        }, lessonId);

        // Wait for fire-and-forget IDB writes to complete before reloading.
        await page.waitForTimeout(1000);

        // Phase 2: reload the page.
        await page.reload();
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        // Phase 3: verify the recording survived the reload.
        // Wait for loadLessonContent (which calls restoreRecordingsForLesson)
        // to complete by waiting for isLoaded.
        await page.waitForFunction(() => window.appStore?.getState()?.isLoaded, { timeout: 20000 });
        await page.waitForTimeout(500); // Small buffer for async restore to settle.

        const restored = await page.evaluate(async (lid) => {
            const mod = await import('/src/modules/storage/storage.js');
            const { getAllSpeechRecordingsForLesson } = mod;
            const recordings = await getAllSpeechRecordingsForLesson(lid);
            console.log('[DIAG] getAll returned', recordings.length, 'recordings for lesson', lid);
            console.log('[DIAG] recordings:', JSON.stringify(recordings.map(r => ({ id: r.id, stepIndex: r.originalStepIndex, createdAt: r.createdAt, userResponse: r.userResponse }))));
            // Also check total Map entries
            const { listRecordsForLesson } = await import('/src/modules/storage/recordingDb.js');
            const idbRecords = await listRecordsForLesson(lid);
            console.log('[DIAG] IDB records for lesson', lid, ':', idbRecords.length);
            console.log('[DIAG] IDB record IDs:', JSON.stringify(idbRecords.map(r => r.id)));
            // Check if restoreRecordingsForLesson was called by trying to restore now
            const { restoreRecordingsForLesson } = mod;
            await restoreRecordingsForLesson(lid);
            const afterRestore = await getAllSpeechRecordingsForLesson(lid);
            console.log('[DIAG] after manual restore, getAll =', afterRestore.length);
            return recordings.map(r => ({
                stepIndex: r.originalStepIndex,
                userResponse: r.userResponse,
                isTextMode: r.isTextMode,
                duration: r.duration,
                matchedCue: r.matchedCue,
                translation: r.translation,
                hasBlob: !!r.blob,
                size: r.size,
            }));
        }, lessonId);

        if (restored.length === 0) {
            console.error('=== DIAG LOGS ===\n' + diagLogs.join('\n'));
        }
        expect(restored.length).toBe(1);
        expect(restored[0].userResponse).toBe('Persistence test answer');
        expect(restored[0].isTextMode).toBe(true);
        expect(restored[0].duration).toBe(3);
        expect(restored[0].matchedCue).toBe('test cue');
        expect(restored[0].translation).toBe('test translation');

        // Phase 4: Repeat-button equivalent clears it.
        await page.evaluate(async (lid) => {
            const { clearSpeechRecordingsForLesson, getAllSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            await clearSpeechRecordingsForLesson(lid);
            const remaining = await getAllSpeechRecordingsForLesson(lid);
            return remaining.length;
        }).then(len => expect(len).toBe(0));

        if (errors.length > 0) throw new Error(`Console errors:\n${errors.join('\n')}`);
    });

    test('multiple steps survive reload and merge with fresh in-memory recordings', async ({ page }) => {
        test.setTimeout(60000);

        await page.goto('/course/model/lesson/g');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        // Wait for LessonContainer to set activeLessonId from the URL param.
        await page.waitForFunction(() => window.appStore?.getState()?.activeLessonId === 'g', { timeout: 20000 });

        const lessonId = 'g';

        await page.evaluate(async (lid) => {
            const state = window.appStore.getState();
            window.appStore.setState({
                userData: { ...(state.userData || {}), profilePictureUrl: '/assets/img/userprofile.png' },
                isTextMode: true
            });
            const { saveSpeechRecording, clearSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            await clearSpeechRecordingsForLesson(lid);
            // Save steps 0 and 1 (persisted to IDB).
            await saveSpeechRecording(null, { lessonId: lid, stepIndex: 0, userResponse: 'answer 0', isTextMode: true, duration: 3 });
            await saveSpeechRecording(null, { lessonId: lid, stepIndex: 1, userResponse: 'answer 1', isTextMode: true, duration: 3 });
        }, lessonId);

        // Wait for fire-and-forget IDB writes to complete before reloading.
        await page.waitForTimeout(1000);

        // Reload — steps 0 and 1 are now only in IDB.
        await page.reload();
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        // Wait for loadLessonContent (which calls restoreRecordingsForLesson)
        // to complete by waiting for isLoaded.
        await page.waitForFunction(() => window.appStore?.getState()?.isLoaded, { timeout: 20000 });
        await page.waitForTimeout(500); // Small buffer for async restore to settle.

        // Simulate recording step 2 fresh this session (in-memory + IDB).
        await page.evaluate(async (lid) => {
            const { saveSpeechRecording } = await import('/src/modules/storage/storage.js');
            await saveSpeechRecording(null, { lessonId: lid, stepIndex: 2, userResponse: 'answer 2', isTextMode: true, duration: 3 });
        }, lessonId);

        // getAll must merge: steps 0+1 from IDB + step 2 from in-memory.
        const merged = await page.evaluate(async (lid) => {
            const { getAllSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            const recordings = await getAllSpeechRecordingsForLesson(lid);
            return recordings.map(r => ({ stepIndex: r.originalStepIndex, userResponse: r.userResponse }));
        }, lessonId);

        expect(merged.length).toBe(3);
        expect(merged.map(r => r.userResponse)).toEqual(['answer 0', 'answer 1', 'answer 2']);

        if (errors.length > 0) throw new Error(`Console errors:\n${errors.join('\n')}`);
    });
});