import React, { useState } from 'react';
import Strings from '../../data/strings.js';
import { useNotifications, useMarkNotificationsRead } from '../../modules/api/api.js';
import { getUnreadCount, listNotifications } from '../../modules/notifications/notification-logic.js';
import NotificationList from './NotificationList.web.jsx';

// Web container for the notification bell. Owns open state and wires the
// inbox query + mark-read mutation to the presentational list. The RN port adds
// NotificationsBell.native.jsx with the same props/testids.

const bellButtonStyle = {
    position: 'relative',
    background: 'none',
    border: 'none',
    color: 'white',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '8px',
    lineHeight: 1,
};

const badgeStyle = {
    position: 'absolute',
    top: '2px',
    right: '0',
    minWidth: '18px',
    height: '18px',
    padding: '0 4px',
    borderRadius: '9px',
    backgroundColor: '#dc3545',
    color: 'white',
    fontSize: '11px',
    fontWeight: 700,
    lineHeight: '18px',
    textAlign: 'center',
};

const panelStyle = {
    position: 'absolute',
    top: '44px',
    right: 0,
    width: '320px',
    // The panel anchors to the bell at the frame's right edge and grows
    // leftward, but #root.video-frame clips overflow (overflow: hidden). On a
    // narrow frame (desktop with OS/browser zoom: frame width is 9/16 of the
    // viewport height and can drop below 320px) an unclamped panel gets its
    // left third cut off. Container units track the FRAME, not the viewport:
    // .video-frame declares container-type: inline-size, so 100cqw is the
    // frame width and the panel always fits with room to spare. (No-cqw
    // browsers drop the declaration and keep today's behavior.)
    maxWidth: 'calc(min(90vw, 100cqw) - 24px)',
    backgroundColor: '#1a3a5a',
    border: '1px solid #2a4a6a',
    borderRadius: '12px',
    padding: '16px',
    zIndex: 1002,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    textAlign: 'left',
};

const headingStyle = {
    margin: '0 0 12px',
    fontSize: '16px',
    fontWeight: 700,
    color: '#ffffff',
};

export default function NotificationsBell({ userId, lang = 'en', compact = false }) {
    const [open, setOpen] = useState(false);
    const { data: notifications } = useNotifications(userId);
    const markRead = useMarkNotificationsRead();
    const unread = getUnreadCount(notifications);
    // Compact mode sits inline in the lesson top bar next to the trophy and
    // streak icons (.stats-container i is 1.1rem): same size, one line.
    const buttonStyle = compact
        ? { ...bellButtonStyle, fontSize: '1.1rem', padding: '0 2px' }
        : bellButtonStyle;

    const handleToggle = () => {
        const next = !open;
        setOpen(next);
        if (next && unread > 0) {
            const ids = listNotifications(notifications)
                .filter((n) => !n.read_at)
                .map((n) => n.id);
            console.log('[notifications] marking read', ids.length);
            markRead.mutate({ userId, ids });
        }
    };

    const handleSelect = () => setOpen(false);

    return (
        <div style={{ position: 'relative' }}>
            <button
                type="button"
                data-testid="notification-bell"
                onClick={handleToggle}
                aria-label={Strings.get('notifications_title', lang)}
                style={buttonStyle}
            >
                <i className="bi bi-bell-fill" />
                {unread > 0 && (
                    <span data-testid="notification-badge" style={badgeStyle}>{unread}</span>
                )}
            </button>
            {open && (
                <div data-testid="notification-panel" style={panelStyle}>
                    <h4 style={headingStyle}>{Strings.get('notifications_title', lang)}</h4>
                    <NotificationList
                        notifications={notifications}
                        lang={lang}
                        onSelect={handleSelect}
                    />
                </div>
            )}
        </div>
    );
}
