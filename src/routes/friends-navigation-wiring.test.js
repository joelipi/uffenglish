import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the Friends page wiring: the route must precede the
// /:shareCode catch-all (or `friends` reads as a share code), the hamburger
// menu must link it, and the guest-modal static list must know it (or the
// modal misclassifies it as a public profile).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const routes = read('./routes.jsx');
const homeScreen = read('../components/homescreen/HomeScreen.jsx');
const guestModalLogic = read('../modules/user/guest-modal-logic.js');

describe('Friends route registration', () => {
    it("declares /friends before the /:shareCode catch-all", () => {
        const friendsAt = routes.indexOf("path: '/friends'");
        const catchAllAt = routes.indexOf("path: '/:shareCode'");
        expect(friendsAt).toBeGreaterThan(-1);
        expect(catchAllAt).toBeGreaterThan(friendsAt);
    });

    it('renders the FriendsRoute element at /friends', () => {
        const at = routes.indexOf("path: '/friends'");
        const block = routes.slice(at, at + 200);
        expect(block).toContain('FriendsRoute');
    });
});

describe('Friends hamburger menu link', () => {
    it('links the menu Friends entry at /friends', () => {
        const menuAt = homeScreen.indexOf("Strings.get('home_friends'");
        expect(menuAt).toBeGreaterThan(-1);
        const linkAt = homeScreen.lastIndexOf('<Link', menuAt);
        const menuBlock = homeScreen.slice(linkAt, menuAt);
        expect(menuBlock).toContain('to="/friends"');
    });
});

describe('Friends guest-modal classification', () => {
    it('lists /friends as a static single-segment route', () => {
        expect(guestModalLogic).toContain("'/friends'");
    });
});
