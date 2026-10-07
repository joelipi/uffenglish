import { useEffect, useState } from 'react';
import { confirmEmailToken } from '../../modules/user/email-confirmation.js';

// Drives the /confirm-email page. The link may be opened on any device and the
// visitor may not be signed in, so confirmation goes through the anon
// confirm_email_hash RPC (the token in the URL is the only credential).
export function useConfirmEmailForm({ token } = {}) {
    // 'pending' while the RPC is in flight, then 'confirmed' or 'invalid'.
    const [status, setStatus] = useState('pending');

    useEffect(() => {
        let cancelled = false;
        setStatus('pending');
        confirmEmailToken(token).then((ok) => {
            if (!cancelled) setStatus(ok ? 'confirmed' : 'invalid');
        });
        return () => {
            cancelled = true;
        };
    }, [token]);

    return { status };
}
