#!/usr/bin/env python3
"""Generate placeholder overlay art for the look controls (stories/092).

Crude on purpose: these exist so the flow and the slot positions can be tested.
Original shapes, no third-party art, no licence questions. PNG only (the repo
forbids committed jpg/jpeg/mp4 under public/).

Layout matches the registry in src/modules/looks/recording-looks-logic.js:
  public/overlays/face/<slug>.png   — covers the face zone
  public/overlays/props/<slug>.png  — above the face / lower scene
"""
import struct
import zlib
import os
import math

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'overlays')


def png(path, width, height, pixels):
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        out = struct.pack('>I', len(data)) + tag + data
        return out + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(data)
    print(f'{os.path.relpath(path, ROOT)} {width}x{height} {len(data)}B')


def blank(w, h):
    return [[(0, 0, 0, 0) for _ in range(w)] for _ in range(h)]


def blend(px, x, y, color, alpha=1.0):
    if not (0 <= y < len(px) and 0 <= x < len(px[0])):
        return
    r, g, b, a = px[y][x]
    sr, sg, sb, sa = color
    sa = sa * alpha / 255.0
    if sa <= 0:
        return
    na = sa + a / 255.0 * (1 - sa)
    if na <= 0:
        return
    nr = (sr * sa + r * (a / 255.0) * (1 - sa)) / na
    ng = (sg * sa + g * (a / 255.0) * (1 - sa)) / na
    nb = (sb * sa + b * (a / 255.0) * (1 - sa)) / na
    px[y][x] = (int(nr), int(ng), int(nb), int(na * 255))


def rect(px, x0, y0, x1, y1, color):
    for y in range(max(0, y0), min(len(px), y1)):
        for x in range(max(0, x0), min(len(px[0]), x1)):
            blend(px, x, y, color)


def ellipse(px, cx, cy, rx, ry, color):
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx = (x - cx) / rx if rx else 9
            dy = (y - cy) / ry if ry else 9
            if dx * dx + dy * dy <= 1.0:
                blend(px, x, y, color)


def poly(px, pts, color):
    ys = [p[1] for p in pts]
    for y in range(int(min(ys)), int(max(ys)) + 1):
        xs = []
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            if (y1 <= y < y2) or (y2 <= y < y1):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            for x in range(int(math.floor(xs[i])), int(math.ceil(xs[i + 1])) + 1):
                blend(px, x, y, color)


def rounded_rect(px, x0, y0, x1, y1, r, color, alpha=1.0):
    for y in range(int(y0) - 1, int(y1) + 1):
        for x in range(int(x0) - 1, int(x1) + 1):
            dx = max(x0 + r - x, 0, x - (x1 - r))
            dy = max(y0 + r - y, 0, y - (y1 - r))
            if dx * dx + dy * dy <= r * r:
                blend(px, x, y, color, alpha)


def clear_rounded_rect(px, x0, y0, x1, y1, r):
    for y in range(int(y0) - 1, int(y1) + 1):
        for x in range(int(x0) - 1, int(x1) + 1):
            dx = max(x0 + r - x, 0, x - (x1 - r))
            dy = max(y0 + r - y, 0, y - (y1 - r))
            if dx * dx + dy * dy <= r * r and 0 <= y < len(px) and 0 <= x < len(px[0]):
                px[y][x] = (0, 0, 0, 0)


def clear_ellipse(px, cx, cy, rx, ry):
    """Knock a fully transparent hole (the mask's eye openings)."""
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if not (0 <= y < len(px) and 0 <= x < len(px[0])):
                continue
            dx = (x - cx) / rx if rx else 9
            dy = (y - cy) / ry if ry else 9
            if dx * dx + dy * dy <= 1.0:
                px[y][x] = (0, 0, 0, 0)


def render_aa(W, H, draw, scale=4):
    """Draw supersampled, then box-downsample to W x H.

    The primitives above are hard-edged, which reads as pixel junk at 512 px;
    sampling 4x per axis and averaging gives clean curves and, crucially, clean
    transparent eye holes (a hole with a ragged edge looks like a bug).
    """
    px = blank(W * scale, H * scale)
    draw(px, scale)
    out = blank(W, H)
    n = scale * scale
    for y in range(H):
        for x in range(W):
            r = g = b = a = 0
            for sy in range(scale):
                row = px[y * scale + sy]
                for sx in range(scale):
                    pr, pg, pb, pa = row[x * scale + sx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            if a == 0:
                out[y][x] = (0, 0, 0, 0)
                continue
            out[y][x] = (int(r / a), int(g / a), int(b / a), int(a / n))
    return out


# ── Face covers (square-ish, drawn over the face zone) ──────────────────────


def carnival_mask():
    """Venetian-style domino mask with genuinely transparent eye holes.

    Original geometry (no third-party art, no attribution): a symmetric band
    that tapers to the tips and dips at the nose bridge, with a gold rim built
    by construction (gold silhouette, velvet inset) and two eye openings
    cleared to alpha 0 so the learner's own eyes show through.
    """
    W, H = 560, 360
    purple = (86, 44, 128, 255)
    purple_hi = (128, 74, 186, 255)
    gold = (232, 194, 92, 255)

    def draw(px, s):
        cx = W * s / 2.0
        half_max = 96 * s
        cy = 180 * s
        for x in range(W * s):
            u = (x - cx) / (W * s / 2.0)
            half = half_max * (1 - 0.55 * u * u)
            if half < 5 * s:
                continue
            notch = 24 * s * math.exp(-((u / 0.16) ** 2))
            top = cy - half + notch
            bottom = cy + half
            for y in range(int(top), int(bottom) + 1):
                blend(px, x, y, gold)
            inset = 11 * s
            if bottom - top > 2 * inset:
                for y in range(int(top + inset), int(bottom - inset)):
                    blend(px, x, y, purple)
                    # soft sheen along the top of the velvet
                    if y < top + inset + 34 * s:
                        blend(px, x, y, purple_hi, 0.16)
        # eye openings: a gold ring, then a real hole
        for side in (-1, 1):
            ex = cx + side * 112 * s
            ey = 184 * s
            ellipse(px, ex, ey, 70 * s, 47 * s, gold)
            clear_ellipse(px, ex, ey, 60 * s, 37 * s)
        # centre jewel + side studs
        poly(px, [(int(cx), int(92 * s)), (int(cx + 15 * s), int(110 * s)),
                  (int(cx), int(128 * s)), (int(cx - 15 * s), int(110 * s))], gold)
        for side in (-1, 1):
            for i in range(3):
                ellipse(px, cx + side * (150 + i * 22) * s, 108 * s, 5 * s, 5 * s, gold)

    png(os.path.join(ROOT, 'face', 'carnival.png'), W, H, render_aa(W, H, draw))


# ── Upper props (sit above the face zone) ───────────────────────────────────

def crown():
    W, H = 560, 300
    px = blank(W, H)
    gold = (240, 190, 40, 255)
    dark = (170, 120, 20, 255)
    poly(px, [(60, 250), (100, 60), (190, 160), (280, 40), (370, 160), (460, 60), (500, 250)], gold)
    rect(px, 60, 236, 500, 272, dark)
    ellipse(px, 280, 120, 24, 24, (220, 60, 60, 255))
    png(os.path.join(ROOT, 'props', 'crown.png'), W, H, px)


# ── Lower props (bottom of the frame) ───────────────────────────────────────

def desk():
    W, H = 720, 300
    px = blank(W, H)
    wood = (124, 84, 51, 255)
    wood_dark = (86, 57, 34, 255)
    wood_top = (156, 110, 70, 255)
    poly(px, [(0, 40), (720, 40), (720, 300), (0, 300)], wood)
    poly(px, [(0, 40), (720, 40), (720, 62), (0, 62)], wood_top)
    for y in range(62, 300, 46):
        rect(px, 0, y, 720, y + 3, wood_dark)
    png(os.path.join(ROOT, 'props', 'desk.png'), W, H, px)


def frame():
    W, H = 720, 1280
    px = blank(W, H)
    edge = (18, 20, 34, 230)
    glow = (60, 70, 120, 90)
    band = 96
    for y in range(H):
        for x in range(W):
            d = min(x, y, W - 1 - x, H - 1 - y)
            if d < band:
                blend(px, x, y, edge, min(1.0, (1.0 - d / band) * 1.7))
            elif d < band * 1.9:
                blend(px, x, y, glow, (1.0 - (d - band) / (band * 0.9)) * 0.5)
    png(os.path.join(ROOT, 'props', 'frame.png'), W, H, px)


if __name__ == '__main__':
    for fn in (carnival_mask, crown, desk, frame):
        fn()
