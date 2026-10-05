import React, { useEffect } from 'react';
import { usePreloader } from '../hooks/usePreloader.js';
import LegalPage from '../components/legal/LegalPage.jsx';
import termsMarkdown from '../../docs/legal/terms-of-service.md?raw';

export default function TermsRoute() {
    const { finishPreloader } = usePreloader();

    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <LegalPage markdown={termsMarkdown} titleKey="legal_terms" />;
}
