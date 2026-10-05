import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import LegalPage from '../components/legal/LegalPage.jsx';
import privacyMarkdown from '../../docs/legal/privacy-policy.md?raw';

export default function PrivacyRoute() {
    const { finishPreloader } = usePreloader();

    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <LegalPage markdown={privacyMarkdown} titleKey="legal_privacy" />;
}
