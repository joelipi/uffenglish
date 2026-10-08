// src/components/avatar-cors.test.js
// Supabase-hosted user avatars are cross-origin. The production site is
// cross-origin isolated with COEP: require-corp (set by a Cloudflare Transform
// Rule on the apex — the repo's public/_headers says credentialless, but the
// apex response wins), and Supabase Storage returns `access-control-allow-origin: *`
// but NO `Cross-Origin-Resource-Policy`. A plain (no-cors) <img> is therefore
// blocked by the browser:
//   net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
// and the avatar renders as a broken image even though the file is a valid JPEG.
// Requesting it as CORS (`crossOrigin="anonymous"`) succeeds because Supabase
// allows the origin, so every <img> that can render a remote user avatar must
// carry that attribute.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');

// One JSX <img ... /> tag, spanning newlines. Scoped to the tag so a whole-file
// `toContain` cannot be satisfied by an unrelated occurrence.
const IMG_TAG = /<img\b[\s\S]*?\/>/g;

function avatarImgTag(file, srcMarker) {
    const tags = read(file).match(IMG_TAG) || [];
    return tags.find((tag) => tag.includes(srcMarker));
}

// [file, the src expression that marks the remote-avatar <img>]
const REMOTE_AVATAR_IMGS = [
    ['profile/PublicProfile.jsx', 'src={profilePic}'],
    ['profile/UserProfile.jsx', 'src={profilePic}'],
    ['chat/UserBubble.jsx', 'src={src}'],
    ['chat/VideoBubble.jsx', 'src={src}'],
];

describe('remote user avatars load under COEP require-corp', () => {
    it.each(REMOTE_AVATAR_IMGS)('%s avatar <img> sets crossOrigin="anonymous"', (file, marker) => {
        const tag = avatarImgTag(file, marker);
        expect(tag, `no <img ${marker}> found in ${file}`).toBeTruthy();
        expect(tag).toContain('crossOrigin="anonymous"');
    });
});
