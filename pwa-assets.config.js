// pwa-assets.config.js
// Icon generation for the installable app (`npm run pwa:assets`).
//
// Source: `public/pwa-icon-source.jpeg`, the app's existing square brand icon
// (the mascot avatar on the brand gradient), copied from
// `src/assets/img/favicons/favicon-192x192.jpeg`. It lives under `public/`
// because `@vite-pwa/assets-generator` writes every icon next to the source
// image, and the manifest needs stable public URLs — Vite would content-hash
// the same file under `src/assets`. Deliberately NOT under `public/assets/**`:
// `public/_headers` serves that prefix `immutable` for a year and these
// filenames are not content-hashed.
//
// `padding: 0` on every type: the source is already a full-bleed, opaque square
// of art, and the padding fill is a single flat colour that would seam against
// the source's own gradient edge. Android's maskable circle crops the outer
// corners, which the centred face survives (the usual treatment for an
// illustrated avatar icon).
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
    headLinkOptions: { preset: 'default' },
    preset: {
        ...minimal2023Preset,
        transparent: { ...minimal2023Preset.transparent, padding: 0 },
        maskable: { ...minimal2023Preset.maskable, padding: 0 },
        apple: { ...minimal2023Preset.apple, padding: 0 },
    },
    images: ['public/pwa-icon-source.jpeg'],
});
