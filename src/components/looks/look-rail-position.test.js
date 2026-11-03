// The left look rail must sit flush under the progress-bar row (not at a fixed
// percentage, and not under the mission space that isn't shown on the recording
// preview), and it must paint ABOVE the header blur. The second part is why it
// is rendered at the frame level rather than inside the camera wrapper: that
// wrapper is z-index 30, so a rail inside it can never rise above the blur (34).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');

const lessonContainer = read('../LessonContainer.jsx');
const webcamPreview = read('../widgets/WebcamPreview.jsx');
const lookControls = read('./LookControls.jsx');
const appCss = read('../../assets/css/app.css');

function zIndexOf(selector) {
    const start = appCss.indexOf(selector);
    expect(start, selector).toBeGreaterThan(-1);
    const open = appCss.indexOf('{', start);
    const close = appCss.indexOf('}', open);
    const block = appCss.slice(open, close);
    const match = block.match(/z-index:\s*(\d+)/);
    expect(match, `${selector} z-index`).not.toBeNull();
    return Number(match[1]);
}

describe('look rail position and stacking', () => {
    it('measures the progress-bar row and passes its bottom to the rail', () => {
        expect(lessonContainer).toContain('const [topBarBottomPx, setTopBarBottomPx]');
        expect(lessonContainer).toContain('ref={topBarRef}');
        expect(lessonContainer).toContain('<LookControls topOffset={topBarBottomPx} />');
    });

    it('positions the rail at that offset instead of a fixed percentage', () => {
        expect(lookControls).toContain('export default function LookControls({ topOffset = 0 })');
        expect(lookControls).toContain('top: topOffset > 0 ? topOffset : styles.rail.top');
    });

    it('renders the rail at the frame level, not inside the camera wrapper', () => {
        // The camera wrapper is .pip-container--takeover (z-index 30). A rail
        // inside it inherits that stacking context and can never beat the blur.
        expect(webcamPreview).not.toContain('<LookControls');
        expect(lessonContainer).toContain('{showPreviewTutorial && <LookControls');
    });

    it('gives the rail a z-index above the header blur', () => {
        const blurZ = zIndexOf('.video-header-blur {');
        const railZ = Number((lookControls.match(/zIndex:\s*(\d+)/) || [])[1]);
        expect(railZ).toBeGreaterThan(blurZ);
        // And the camera wrapper really is below the blur, which is why the rail
        // had to move out.
        expect(zIndexOf('.pip-container--takeover {')).toBeLessThan(blurZ);
    });
});

describe('selected rail button has no border', () => {
    it('the applied-state style carries no ring', () => {
        const start = lookControls.indexOf('railBtnActive: {');
        expect(start).toBeGreaterThan(-1);
        const end = lookControls.indexOf('}', start);
        const block = lookControls.slice(start, end);
        expect(block).not.toContain('borderColor');
        expect(block).not.toContain('4ade80');
    });
});
