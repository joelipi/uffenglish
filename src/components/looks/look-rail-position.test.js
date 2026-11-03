// The left look rail must sit flush under the top overlay (the div holding the
// progress bar), not at a fixed percentage that overlaps the subtitles. The
// offset is measured in LessonContainer and threaded down to LookControls.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');

const lessonContainer = read('../LessonContainer.jsx');
const webcamPreview = read('../widgets/WebcamPreview.jsx');
const lookControls = read('./LookControls.jsx');

describe('look rail sits under the progress-bar overlay', () => {
    it('measures the top overlay and passes its height to the preview', () => {
        expect(lessonContainer).toContain('const [topOverlayHeightPx, setTopOverlayHeightPx]');
        expect(lessonContainer).toContain('<WebcamPreview topOverlayHeight={topOverlayHeightPx} />');
    });

    it('forwards the height to the look controls', () => {
        expect(webcamPreview).toContain('export default function WebcamPreview({ topOverlayHeight = 0 })');
        expect(webcamPreview).toContain('<LookControls topOffset={topOverlayHeight} />');
    });

    it('positions the rail at that offset instead of a fixed percentage', () => {
        expect(lookControls).toContain('export default function LookControls({ topOffset = 0 })');
        expect(lookControls).toContain('top: topOffset > 0 ? topOffset : styles.rail.top');
    });
});
