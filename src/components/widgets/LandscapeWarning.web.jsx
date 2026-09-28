import React, { useEffect, useState } from 'react';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';
import { isLandscape, isMobileUserAgent, shouldWarnLandscape } from '../../modules/utils/orientation.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';

// Read the current viewport + navigator synchronously so the first paint is
// already correct (no landscape->warning flash).
function readOrientation() {
    if (typeof window === 'undefined') {
        return { isMobile: false, landscape: false };
    }
    const nav = window.navigator || {};
    return {
        isMobile: isMobileUserAgent({
            userAgent: nav.userAgent,
            platform: nav.platform,
            maxTouchPoints: nav.maxTouchPoints,
        }),
        landscape: isLandscape(window.innerWidth, window.innerHeight),
    };
}

export default function LandscapeWarning() {
    const [orientation, setOrientation] = useState(readOrientation);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        const handleViewportChange = () => {
            const next = readOrientation();
            setOrientation(next);
            // A return to portrait clears the dismissal, so re-entering
            // landscape later warns again.
            if (!next.landscape) {
                setDismissed(false);
            }
        };

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('orientationchange', handleViewportChange);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('orientationchange', handleViewportChange);
        };
    }, []);

    const lang = useNativeLanguage();
    const warningVisible =
        shouldWarnLandscape({ isMobile: orientation.isMobile, landscape: orientation.landscape }) &&
        !dismissed;

    useEffect(() => {
        console.log(
            `[LandscapeWarning] ${warningVisible ? 'shown' : 'hidden'} ` +
            `(mobile=${orientation.isMobile}, landscape=${orientation.landscape}, dismissed=${dismissed})`
        );
    }, [warningVisible, orientation.isMobile, orientation.landscape, dismissed]);

    if (!warningVisible) {
        return null;
    }

    return (
        <div id="landscape-warning" role="alert" className="landscape-warning">
            <i className="bi bi-exclamation-triangle-fill landscape-warning-icon" aria-hidden="true"></i>
            <p className="landscape-warning-text">
                {Strings.get('rotate_device_portrait', lang)}
            </p>
            <button
                id="landscape-warning-dismiss"
                type="button"
                className="landscape-warning-dismiss"
                aria-label={Strings.get('dismiss', lang)}
                onClick={() => setDismissed(true)}
            >
                <i className="bi bi-x-lg" aria-hidden="true"></i>
            </button>
        </div>
    );
}
