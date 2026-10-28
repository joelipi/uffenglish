# Twemoji artwork in this folder

The in-app **Emoji** overlay picker also loads the full Twemoji `15.0.3` SVG
collection (all 3,720 files) from the pinned jsDelivr CDN. Those files are used
unmodified; the CC-BY 4.0 attribution below covers them as well.

`shades-twemoji.png` and `carnival-twemoji.png` are derived from Twemoji emoji
artwork:

- Twemoji by Twitter, Inc. — licensed under **Creative Commons Attribution 4.0
  International (CC-BY 4.0)**.
- License text: https://github.com/jdecked/twemoji/blob/main/LICENSE-GRAPHICS
- Source, pinned: Twemoji `15.0.3` via jsDelivr
  (`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/svg/`)
  - `shades-twemoji.png` ← `1f453.svg` (eyeglasses)
  - `carnival-twemoji.png` ← `1f3ad.svg` (performing arts, purple mask only)
  - `alien-twemoji.png` ← `1f47d.svg` (alien)
  - `clown-twemoji.png` ← `1f921.svg` (clown face)
  - `grinning-cat-twemoji.png` ← `1f63a.svg` (grinning cat)
  - `monkey-twemoji.png` ← `1f435.svg` (monkey face)
  - `dog-twemoji.png` ← `1f436.svg` (dog face)
  - `bear-twemoji.png` ← `1f43b.svg` (bear)
  - `crown.png` ← `1f451.svg` (crown)
  - `graduationcap-twemoji.png` ← `1f393.svg` (graduation cap)
  - `tophat-twemoji.png` ← `1f3a9.svg` (top hat)

## Modifications (regeneration: `node scripts/generate-twemoji-overlays.mjs`)

- `shades-twemoji`: the lens `<path>` is reused as a `dest-out` mask, so the
  lenses are fully transparent eye holes and only the Twemoji frame remains.
- `carnival-twemoji`: cropped to the purple mask and two calibrated ellipses
  over the eye band are used as a `dest-out` mask, opening transparent eye
  holes (the original paints closed eye arcs).
- Both are rasterized to PNG with `sharp`; nothing else is altered.

## Bottom bands (`props/*-bottom.png`)

Regeneration: `node scripts/generate-bottom-overlays.mjs`.

Each band is a 1200×400 (3:1) PNG with a fully transparent background, built by
laying several produce emoji side by side on a common floor: varied artwork
heights, a slight tilt, and a few deliberate overlaps so the row reads as a pile
rather than a row of stickers. At 80% of the frame width a 3:1 band is exactly
the bottom 15% of the 9:16 recording frame, which is how the overlay registry
anchors it (`baseWidth: 0.8`, `anchorY: 0.925`).

- `fruits-bottom.png` ← `1f349.svg` (watermelon), `1f34c.svg` (banana),
  `1f34e.svg` (red apple), `1f347.svg` (grapes), `1f353.svg` (strawberry)
- `veggies-bottom.png` ← `1f33d.svg` (ear of maize), `1f955.svg` (carrot),
  `1f966.svg` (broccoli), `1fad1.svg` (bell pepper), `1f345.svg` (tomato)
- `gifts-bottom.png` ← `1f381.svg` (wrapped present), the same parcel four
  times at four sizes and tilts
- `balls-bottom.png` ← `1f3c0.svg` (basketball), `26bd.svg` (soccer ball),
  `1f3c8.svg` (american football), `1f94e.svg` (softball), `1f3d0.svg`
  (volleyball)
- `baked-bottom.png` ← `1f35e.svg` (bread), `1f950.svg` (croissant),
  `1f369.svg` (doughnut), `1f370.svg` (shortcake), `1f9c1.svg` (cupcake),
  `1f968.svg` (pretzel)
- `flowers-bottom.png` ← `1f337.svg` (tulip), `1f339.svg` (rose), `1f33b.svg`
  (sunflower), `1f33a.svg` (hibiscus), `1f338.svg` (cherry blossom),
  `1f33c.svg` (blossom)
- `shrubs-bottom.png` ← `1fab4.svg` (potted plant), `1f33f.svg` (herb),
  `2618.svg` (shamrock), `1f335.svg` (cactus), `1f331.svg` (seedling)
- `office-bottom.png` ← `1fa91.svg` (chair), `1f5c4.svg` (file cabinet),
  `1f5d1.svg` (wastebasket), `1f4da.svg` (books), `1f4c1.svg` (file folder)

Nothing but the emoji artwork is painted: the band has no plate, frame or shadow
behind it.
