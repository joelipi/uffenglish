// TurnstileCaptcha: the widget must render explicitly via
// window.turnstile.render() (a bare .cf-turnstile div would race the async
// script), getToken() must hand back a FRESH token, and an expired cached token
// must trigger a re-run of the challenge rather than being reused.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import TurnstileCaptcha from './TurnstileCaptcha.web.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let container;

function render(props = {}) {
    const ref = { current: null };
    act(() => {
        host.render(<TurnstileCaptcha {...props} ref={(node) => { ref.current = node; }} />);
    });
    return ref;
}

/** Drive the script-loaded resolution and let the render settle. */
async function flush() {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    host = createRoot(container);
    delete window.turnstile;
});

afterEach(() => {
    act(() => host.unmount());
    container.remove();
    delete window.turnstile;
});

function installTurnstile({ onExecute } = {}) {
    const renderMock = vi.fn(() => 'widget-id-1');
    const execute = vi.fn(() => onExecute?.());
    const reset = vi.fn();
    window.turnstile = { render: renderMock, execute, reset };
    return { renderMock, execute, reset };
}

describe('TurnstileCaptcha', () => {
    it('renders the widget explicitly with the site key and action', async () => {
        const { renderMock } = installTurnstile();
        render();
        await flush();

        expect(renderMock).toHaveBeenCalledTimes(1);
        const [el, config] = renderMock.mock.calls[0];
        expect(el).toBe(container.firstChild.firstChild);
        expect(config.sitekey).toMatch(/^0x4AAAA/);
        expect(config.action).toBe('signup');
    });

    it('returns the cached token without re-running the challenge', async () => {
        installTurnstile();
        const ref = render();
        await flush();

        await act(async () => {
            window.turnstile.render.mock.calls[0][1].callback('token-A');
        });

        await expect(ref.current.getToken()).resolves.toBe('token-A');
        expect(window.turnstile.execute).not.toHaveBeenCalled();
    });

    it('re-runs the challenge when there is no cached token', async () => {
        installTurnstile();
        const ref = render();
        await flush();

        let resolveToken;
        const pending = ref.current.getToken();
        await flush();
        expect(window.turnstile.execute).toHaveBeenCalledWith('widget-id-1');

        await act(async () => {
            window.turnstile.render.mock.calls[0][1].callback('token-B');
        });
        resolveToken = pending;

        await expect(resolveToken).resolves.toBe('token-B');
    });

    it('re-runs the challenge after the cached token expires', async () => {
        installTurnstile();
        const ref = render();
        await flush();

        const config = window.turnstile.render.mock.calls[0][1];
        await act(async () => { config.callback('token-C'); });
        await expect(ref.current.getToken()).resolves.toBe('token-C');
        expect(window.turnstile.execute).not.toHaveBeenCalled();

        await act(async () => { config['expired-callback'](); });
        const pending = ref.current.getToken();
        await flush();
        expect(window.turnstile.execute).toHaveBeenCalledWith('widget-id-1');

        await act(async () => { config.callback('token-D'); });
        await expect(pending).resolves.toBe('token-D');
    });

    it('rejects a pending getToken() when the widget errors', async () => {
        installTurnstile();
        const ref = render();
        await flush();

        const pending = ref.current.getToken();
        // Attach the handler BEFORE the rejection fires, so the rejected promise
        // is never briefly unhandled.
        const assertion = expect(pending).rejects.toThrow(/human verification failed/i);
        await flush();
        await act(async () => {
            window.turnstile.render.mock.calls[0][1]['error-callback']();
        });

        await assertion;
    });

    it('surfaces a load failure instead of hanging the form', async () => {
        // window.turnstile never appears: the poll must time out, not spin.
        vi.useFakeTimers();
        try {
            const onError = vi.fn();
            render({ onError });
            await act(async () => { await vi.advanceTimersByTimeAsync(16000); });

            expect(onError).toHaveBeenCalled();
            expect(container.querySelector('[role="alert"]')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears the cached token on unmount', async () => {
        installTurnstile();
        const ref = render();
        await flush();

        const config = window.turnstile.render.mock.calls[0][1];
        await act(async () => { config.callback('token-E'); });
        await expect(ref.current.getToken()).resolves.toBe('token-E');

        act(() => host.unmount());

        // A fresh mount starts with no token, so it must re-run the challenge
        // rather than reusing the unmounted instance's cached one.
        const fresh = document.createElement('div');
        document.body.appendChild(fresh);
        const freshHost = createRoot(fresh);
        const ref2 = { current: null };
        try {
            act(() => {
                freshHost.render(
                    <TurnstileCaptcha ref={(node) => { ref2.current = node; }} />
                );
            });
            await flush();

            const pending = ref2.current.getToken();
            await flush();
            expect(window.turnstile.execute).toHaveBeenCalledWith('widget-id-1');
            // The second render has its own config object — firing the first
            // (unmounted) widget's callback would leave this one hanging.
            const freshConfig = window.turnstile.render.mock.calls[1][1];
            await act(async () => { freshConfig.callback('token-F'); });
            await expect(pending).resolves.toBe('token-F');
        } finally {
            act(() => freshHost.unmount());
            fresh.remove();
        }
    });
});
