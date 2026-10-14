// Friends directory page: heading/subheading/callout copy, directory rows
// (name + picture linked to the public profile, share code), the joint-lesson
// badge reusing the 48h friend-link gate, empty and guest states. Rendered
// with react-dom/client createRoot + act (the repo convention).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
    useUserProfileImpl: vi.fn(() => ({ data: null, isLoading: false })),
    useFriendProfilesImpl: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('../../modules/api/api.js', () => ({
    useUserProfile: (...args) => apiMocks.useUserProfileImpl(...args),
    useFriendProfiles: (...args) => apiMocks.useFriendProfilesImpl(...args),
}));

import Friends from './Friends.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function activeLinks(code) {
    return {
        'friendchain:a': {
            courseId: 'friendchain', courseName: 'Friend Chain',
            recordedLessonId: 'a', lessonId: 'b', shareCode: code,
            addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
        },
    };
}

function expiredLinks(code) {
    return {
        'friendchain:a': {
            courseId: 'friendchain', courseName: 'Friend Chain',
            recordedLessonId: 'a', lessonId: 'b', shareCode: code,
            addedAt: iso(NOW - 49 * HOUR), lessonTitle: 'Ask',
        },
    };
}

const viewer = { $id: 'me', native_language: 'en', friends: ['u1', 'u2'], friend_owners: [] };

function friendRow(id, code, name, links) {
    return { id, share_code: code, display_name: name, profile_picture_url: `https://pics/${id}.jpg`, friend_links: links };
}

describe('Friends directory page', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        apiMocks.useUserProfileImpl.mockReturnValue({ data: viewer, isLoading: false });
        apiMocks.useFriendProfilesImpl.mockReturnValue({ data: [], isLoading: false });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    function renderFriends() {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null, React.createElement(Friends)),
            );
        });
        return root;
    }

    it('renders the heading, subheading, and the no-messaging callout verbatim', () => {
        apiMocks.useFriendProfilesImpl.mockReturnValue({ data: [], isLoading: false });
        root = renderFriends();

        expect(container.querySelector('[data-testid="friends-heading"]').textContent).toBe('Friends');
        expect(container.querySelector('[data-testid="friends-subheading"]').textContent)
            .toBe("This is everyone you've completed at least one lesson with. You both need to complete the same lesson. To add someone as a friend, send them your profile link so they can finish a lesson with you.");
        expect(container.querySelector('[data-testid="friends-callout"]').textContent)
            .toContain('UFF does not have messaging functionality or search directory, by design, to prevent misuse. Contact your friends directly however you normally do (messaging apps, phone, email).');
    });

    it('lists each friend with the name and picture linked to their public profile plus the share code', () => {
        apiMocks.useFriendProfilesImpl.mockReturnValue({
            data: [
                friendRow('u1', 'aaa111', 'Ann A', expiredLinks('aaa111')),
                friendRow('u2', 'bbb222', 'Bo B', expiredLinks('bbb222')),
            ],
            isLoading: false,
        });
        root = renderFriends();

        const rows = Array.from(container.querySelectorAll('[data-testid="friend-row"]'));
        expect(rows).toHaveLength(2);

        const nameLinks = Array.from(container.querySelectorAll('[data-testid="friend-name-link"]'));
        expect(nameLinks.map((a) => a.textContent)).toEqual(['Ann A', 'Bo B']);
        expect(nameLinks[0].getAttribute('href')).toBe('/aaa111');
        expect(nameLinks[1].getAttribute('href')).toBe('/bbb222');

        const picLinks = Array.from(container.querySelectorAll('[data-testid="friend-pic-link"]'));
        expect(picLinks[0].getAttribute('href')).toBe('/aaa111');
        expect(picLinks[1].getAttribute('href')).toBe('/bbb222');

        const pics = Array.from(container.querySelectorAll('[data-testid="friend-pic"]'));
        expect(pics[0].getAttribute('src')).toContain('u1.jpg');
        expect(pics[0].closest('a').getAttribute('href')).toBe('/aaa111');

        expect(Array.from(container.querySelectorAll('[data-testid="friend-share-code"]')).map((s) => s.textContent))
            .toEqual(['aaa111', 'bbb222']);
    });

    it('badges only the friend with an active (joint) lesson', () => {
        apiMocks.useFriendProfilesImpl.mockReturnValue({
            data: [
                friendRow('u1', 'aaa111', 'Ann A', activeLinks('aaa111')),
                friendRow('u2', 'bbb222', 'Bo B', expiredLinks('bbb222')),
            ],
            isLoading: false,
        });
        root = renderFriends();

        const badges = Array.from(container.querySelectorAll('[data-testid="friend-joint-badge"]'));
        expect(badges).toHaveLength(1);
        expect(badges[0].textContent).toBe('Has lessons to do together');
        const rows = Array.from(container.querySelectorAll('[data-testid="friend-row"]'));
        expect(rows[0].querySelector('[data-testid="friend-joint-badge"]')).not.toBeNull();
        expect(rows[1].querySelector('[data-testid="friend-joint-badge"]')).toBeNull();
    });

    it('shows the empty state when the viewer has no friends', () => {
        apiMocks.useUserProfileImpl.mockReturnValue({ data: { $id: 'me', native_language: 'en', friends: [], friend_owners: [] }, isLoading: false });
        apiMocks.useFriendProfilesImpl.mockReturnValue({ data: [], isLoading: false });
        root = renderFriends();

        expect(container.querySelector('[data-testid="friends-list"]')).toBeNull();
        expect(container.querySelector('[data-testid="friends-empty"]').textContent)
            .toContain("You haven't completed a lesson with anyone yet.");
    });

    it('asks guests to log in with a redirect back to /friends', () => {
        apiMocks.useUserProfileImpl.mockReturnValue({ data: { $id: 'guest' }, isLoading: false });
        root = renderFriends();

        expect(container.querySelector('[data-testid="friends-login-required"]')).not.toBeNull();
        const link = container.querySelector('[data-testid="friends-login-link"]');
        expect(link.textContent).toBe('Log in to see your friends.');
        expect(link.getAttribute('href')).toBe('/login?redirect=%2Ffriends');
        expect(container.querySelector('[data-testid="friends-list"]')).toBeNull();
    });

    it('shows the spinner — never the login prompt — while the profile is still loading', () => {
        apiMocks.useUserProfileImpl.mockReturnValue({ data: undefined, isLoading: true });
        root = renderFriends();

        expect(container.querySelector('[data-testid="friends-loading"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="friends-login-required"]')).toBeNull();
        expect(container.querySelector('[data-testid="friends-list"]')).toBeNull();
    });
});
