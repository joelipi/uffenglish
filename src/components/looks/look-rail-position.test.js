// The left look rail must sit flush under the progress-bar row, not at a
// fixed percentage (or under the mission space) that pushes it into the
// subtitles. The offset is measured in LessonContainer and threaded down to
// LookControls.
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
    it('measures the progress-bar row and passes its bottom to the preview', () => {
        expect(lessonContainer).toContain('const [topBarBottomPx, setTopBarBottomPx]');
        expect(lessonContainer).toContain('ref={topBarRef}');
        expect(lessonContainer).toContain('<WebcamPreview railTop={topBarBottomPx} />');
    });

    it('forwards the height to the look controls', () => {
        expect(webcamPreview).toContain('export default function WebcamPreview({ railTop = 0 })');
        expect(webcamPreview).toContain('<LookControls topOffset={railTop} />');
    });

    it('positions the rail at that offset instead of a fixed percentage', () => {
        expect(lookControls).toContain('export default function LookControls({ topOffset = 0 })');
        expect(lookControls).toContain('top: topOffset > 0 ? topOffset : styles.rail.top');
    });
});
