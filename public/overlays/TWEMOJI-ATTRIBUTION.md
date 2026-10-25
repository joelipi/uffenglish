# Twemoji artwork in this folder

`shades-twemoji.png` and `carnival-twemoji.png` are derived from Twemoji emoji
artwork:

- Twemoji by Twitter, Inc. — licensed under **Creative Commons Attribution 4.0
  International (CC-BY 4.0)**.
- License text: https://github.com/jdecked/twemoji/blob/main/LICENSE-GRAPHICS
- Source, pinned: Twemoji `15.0.3` via jsDelivr
  (`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/svg/`)
  - `shades-twemoji.png` ← `1f453.svg` (eyeglasses)
  - `carnival-twemoji.png` ← `1f3ad.svg` (performing arts, purple mask only)

## Modifications (regeneration: `node scripts/generate-twemoji-overlays.mjs`)

- `shades-twemoji`: the lens `<path>` is reused as a `dest-out` mask, so the
  lenses are fully transparent eye holes and only the Twemoji frame remains.
- `carnival-twemoji`: cropped to the purple mask and two calibrated ellipses
  over the eye band are used as a `dest-out` mask, opening transparent eye
  holes (the original paints closed eye arcs).
- Both are rasterized to PNG with `sharp`; nothing else is altered.
