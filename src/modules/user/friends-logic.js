// modules/user/friends-logic.js
// Pure domain logic for the Friends directory page (`/friends`). A friend is
// anyone the viewer has completed at least one lesson with: the union of the
// friend-credit arrays the record_friend_completion RPC maintains — `friends`
// (completer ids recorded on the owner's row) and `friend_owners` (owner ids
// recorded on the completer's row, private to the viewer). No React, no DOM,
// no store, no data access — fully unit-testable.
//
// The "lessons to do together" badge reuses the profile-visitor-lessons read
// gate directly: a friend has joint lessons when their public `friendLinks`
// map holds at least one entry still inside the 48h window
// (`listActiveFriendLinks`), the same predicate the public profile, the
// Continue resolver, and the countdown all share.

import { listActiveFriendLinks } from './friend-lesson-link-logic.js';

// Ordered, deduped friend user-ids for `profile`: `friends` first (people who
// completed through the viewer's link), then `friend_owners` (people whose
// link the viewer completed through). Blank entries and the viewer's own id
// are dropped; malformed arrays count as empty, never throw.
export function getFriendUserIds(profile) {
    if (!profile || typeof profile !== 'object') return [];
    const selfId = profile.$id ?? profile.id;
    const seen = new Set();
    const ids = [];
    for (const list of [profile.friends, profile.friend_owners]) {
        if (!Array.isArray(list)) continue;
        for (const id of list) {
            if (typeof id !== 'string' || id === '') continue;
            if (id === selfId || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

// Real name for a directory row, mirroring PublicProfile's display rule:
// `display_name`, else "firstName lastName", else ''.
export function getFriendDisplayName(row) {
    if (!row || typeof row !== 'object') return '';
    if (typeof row.display_name === 'string' && row.display_name !== '') return row.display_name;
    const parts = [row.firstName ?? row.first_name, row.lastName ?? row.last_name].filter(
        (p) => typeof p === 'string' && p !== '',
    );
    return parts.join(' ');
}

// Public share code for a directory row (either column casing), or null when
// the row cannot link to a public profile.
export function getFriendShareCode(row) {
    if (!row || typeof row !== 'object') return null;
    const code = row.shareCode ?? row.share_code;
    return typeof code === 'string' && code !== '' ? code : null;
}

// Badge predicate: the friend has at least one lesson the viewer can do with
// them together — an active (< 48h) entry in their public friendLinks map.
export function friendHasJointLessons(friendLinks, nowMs) {
    return listActiveFriendLinks(friendLinks, nowMs).length > 0;
}

// Render-ready directory rows in the viewer's friend order. `friendProfiles`
// are the fetched public rows (or null on fetch failure — fail-open, that
// friend is skipped). Rows without a share code are skipped: without one the
// name and picture cannot link to a public profile. Every row carries
// `hasJointLessons` for the badge.
export function buildFriendsList({ profile, friendProfiles = [], nowMs = Date.now() } = {}) {
    const ids = getFriendUserIds(profile);
    if (ids.length === 0) return [];
    const byId = new Map();
    for (const row of Array.isArray(friendProfiles) ? friendProfiles : []) {
        if (!row || typeof row !== 'object') continue;
        const id = row.id ?? row.$id;
        if (typeof id === 'string' && id !== '' && !byId.has(id)) byId.set(id, row);
    }
    const rows = [];
    for (const id of ids) {
        const row = byId.get(id);
        if (!row) continue;
        const shareCode = getFriendShareCode(row);
        if (!shareCode) continue;
        rows.push({
            id,
            shareCode,
            displayName: getFriendDisplayName(row),
            profilePictureUrl: row.profilePictureUrl ?? row.profile_picture_url ?? null,
            friendLinks: row.friendLinks ?? row.friend_links ?? null,
            hasJointLessons: friendHasJointLessons(row.friendLinks ?? row.friend_links, nowMs),
        });
    }
    return rows;
}
