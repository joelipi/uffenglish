import { useEffect, useRef, useState } from 'react';
import { confirmEmailToken } from '../../modules/user/email-confirmation.js';

// Sentinel so the very first effect run always records a result, even when the
// URL has no token (confirmEmailToken(null) resolves false without an RPC).
const UNSET = Symbol('unset');

// Drives the /confirm-email page. The link may be opened on any device and the
// visitor may not be signed in, so confirmation goes through the anon
// confirm_email_hash RPC (the token in the URL is the only credential).
export function useConfirmEmailForm({ token } = {}) {
    // 'pending' while the RPC is in flight, then 'confirmed' or 'invalid'.
    const [status, setStatus] = useState('pending');

    // The token is single-use, so the RPC must run exactly once. React
    // StrictMode double-invokes effects in development; a plain effect would
    // fire the RPC twice, the second call would find the token already burned
    // and the page would wrongly show "invalid". Memoize the in-flight promise
    // per token and let each effect run subscribe to the same result.
    const confirmedTokenRef = useRef(UNSET);
    const resultRef = useRef(null);

    useEffect(() => {
        if (confirmedTokenRef.current !== token) {
            confirmedTokenRef.current = token;
            resultRef.current = confirmEmailToken(token);
        }
        let cancelled = false;
        resultRef.current.then((ok) => {
            if (!cancelled) setStatus(ok ? 'confirmed' : 'invalid');
        });
        return () => {
            cancelled = true;
        };
    }, [token]);

    return { status };
}
