import React from 'react';
import Strings from '../../data/strings.js';
import {
    NOTIFICATION_TYPE_FRIEND_RESPONSE,
    listNotifications,
    buildProfileHref,
    formatNotificationDate,
    getNotificationActorName,
    getNotificationActorShareCode,
} from '../../modules/notifications/notification-logic.js';

// Web presentation for the inbox list. All rules (ordering, filtering, URL
// building, date formatting, name fallback) live in notification-logic.js; this
// file only renders. A future NotificationList.native.jsx must implement the
// same props and data-testids.

const listStyle = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '60vh',
    overflowY: 'auto',
};

const itemStyle = {
    backgroundColor: '#0b1a2a',
    border: '1px solid #2a4a6a',
    borderRadius: '10px',
    padding: '12px 14px',
};

const linkStyle = {
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    textDecoration: 'underline',
    display: 'inline-block',
};

const messageStyle = {
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
};

const deadlineStyle = {
    color: '#ffd479',
    fontSize: '13px',
    margin: '6px 0 0',
};

const timestampStyle = {
    display: 'block',
    color: '#6c757d',
    fontSize: '12px',
    marginTop: '6px',
};

const emptyStyle = {
    color: '#adb5bd',
    fontSize: '14px',
    margin: 0,
    padding: '8px 4px',
};

function NotificationItem({ notification, lang, onSelect }) {
    const name = getNotificationActorName(notification) || Strings.get('notifications_someone', lang);
    const message = Strings.get('notifications_friend_response', lang, { name });
    const shareCode = getNotificationActorShareCode(notification);
    const href = shareCode ? buildProfileHref(shareCode) : null;
    const timestamp = formatNotificationDate(notification.created_at, lang);
    const showDeadline = notification.type === NOTIFICATION_TYPE_FRIEND_RESPONSE;

    const handleClick = () => {
        if (onSelect) onSelect(notification);
    };

    return (
        <li data-testid="notification-item" style={itemStyle}>
            {href ? (
                <a data-testid="notification-link" href={href} onClick={handleClick} style={linkStyle}>
                    {message}
                </a>
            ) : (
                <span style={messageStyle}>{message}</span>
            )}
            {showDeadline && (
                <p data-testid="notification-deadline" style={deadlineStyle}>
                    {Strings.get('notifications_respond_deadline', lang)}
                </p>
            )}
            {timestamp && (
                <time data-testid="notification-timestamp" dateTime={notification.created_at} style={timestampStyle}>
                    {timestamp}
                </time>
            )}
        </li>
    );
}

export default function NotificationList({ notifications, lang = 'en', onSelect }) {
    const items = listNotifications(notifications);

    if (items.length === 0) {
        return (
            <p data-testid="notification-empty" style={emptyStyle}>
                {Strings.get('notifications_empty', lang)}
            </p>
        );
    }

    return (
        <ul style={listStyle}>
            {items.map((notification) => (
                <NotificationItem
                    key={notification.id}
                    notification={notification}
                    lang={lang}
                    onSelect={onSelect}
                />
            ))}
        </ul>
    );
}
