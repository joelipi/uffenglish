import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import CourseMissionDropdown from './CourseMissionDropdown.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function render(container, props) {
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(CourseMissionDropdown, { lang: 'en', ...props }));
    });
    return root;
}

describe('CourseMissionDropdown', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    it('renders nothing without a mission', () => {
        root = render(container, { mission: null });
        expect(container.querySelector('[data-testid="course-mission"]')).toBeNull();
        root.unmount(); root = null;
        root = render(container, { mission: {} });
        expect(container.querySelector('[data-testid="course-mission"]')).toBeNull();
    });

    it('renders one row per present key with the live lesson icons', () => {
        root = render(container, {
            mission: {
                mission: { en: 'Ask' },
                setting: { en: 'Park' },
                roleUser: { en: 'You' },
                roleOther: { en: 'Friend' },
            },
        });
        const dropdown = container.querySelector('[data-testid="course-mission"]');
        expect(dropdown).not.toBeNull();
        expect(dropdown.textContent).toContain('Ask');
        expect(dropdown.textContent).toContain('Park');
        expect(dropdown.textContent).toContain('You');
        expect(dropdown.textContent).toContain('Friend');
        const icons = Array.from(dropdown.querySelectorAll('.mission-label i')).map((i) => i.className);
        expect(icons).toEqual([
            'bi bi-bullseye',
            'bi bi-geo-alt',
            'bi bi-person',
            'bi bi-people',
        ]);
    });

    it('omits missing keys and keeps live row order', () => {
        root = render(container, { mission: { roleOther: { en: 'Friend' }, mission: { en: 'Ask' } } });
        const dropdown = container.querySelector('[data-testid="course-mission"]');
        expect(dropdown.textContent).toContain('Ask');
        expect(dropdown.textContent).toContain('Friend');
        expect(dropdown.querySelectorAll('.mission-label')).toHaveLength(2);
        const icons = Array.from(dropdown.querySelectorAll('.mission-label i')).map((i) => i.className);
        expect(icons).toEqual(['bi bi-bullseye', 'bi bi-people']);
    });

    it('renders future metadata keys with a fallback icon and styled text', () => {
        root = render(container, { mission: { mission: { en: 'Ask' }, voice: { en: 'Audio' } } });
        const dropdown = container.querySelector('[data-testid="course-mission"]');
        expect(dropdown.textContent).toContain('Audio');
        const labels = Array.from(dropdown.querySelectorAll('.mission-label i'));
        expect(labels[labels.length - 1].className).toBe('bi bi-info-circle');
        expect(dropdown.querySelector('.course-meta-text')).not.toBeNull();
        expect(dropdown.querySelector('.course-meta-text').textContent).toContain('Audio');
    });

    it('localizes rows through the same bilingual text as the lesson', () => {
        root = render(container, { lang: 'es', mission: { mission: { en: 'Ask', es: 'Pregunta' } } });
        const dropdown = container.querySelector('[data-testid="course-mission"]');
        expect(dropdown.textContent).toContain('Ask');
        expect(dropdown.textContent).toContain('Pregunta');
    });

    it('starts collapsed and expands on toggle', () => {
        root = render(container, { mission: { mission: { en: 'Ask' } } });
        const dropdown = container.querySelector('[data-testid="course-mission"]');
        expect(dropdown.className).not.toContain('expanded');
        act(() => {
            dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(dropdown.className).toContain('expanded');
        act(() => {
            dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(dropdown.className).not.toContain('expanded');
    });

    it('cancels the card link navigation when toggled inside a course card', () => {
        const anchor = document.createElement('a');
        anchor.setAttribute('href', '/course/friend/lesson/a');
        container.appendChild(anchor);
        const host = document.createElement('div');
        anchor.appendChild(host);
        root = createRoot(host);
        act(() => {
            root.render(React.createElement(CourseMissionDropdown, { lang: 'en', mission: { mission: { en: 'Ask' } } }));
        });
        const dropdown = host.querySelector('[data-testid="course-mission"]');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        act(() => {
            dropdown.dispatchEvent(event);
        });
        expect(event.defaultPrevented).toBe(true);
        expect(dropdown.className).toContain('expanded');
    });
});

describe('course mission dropdown styling', () => {
    it('styles future metadata keys with the live mission text rule', () => {
        const css = readFileSync(path.join(__dirname, '../../assets/css/app.css'), 'utf8');
        const start = css.indexOf('.mission-text,');
        expect(start).toBeGreaterThan(-1);
        const block = css.slice(start, css.indexOf('}', start));
        for (const selector of ['.mission-text', '.setting-text', '.roleUser-text', '.roleOther-text', '.course-meta-text']) {
            expect(block, `missing ${selector}`).toContain(selector);
        }
        for (const declaration of ['color: #fff', 'font-size: 1rem', 'font-weight: 500', 'line-height: 1']) {
            expect(block, `missing ${declaration}`).toContain(declaration);
        }
    });
});
