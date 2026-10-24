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


# ── Face covers (square-ish, drawn over the face zone) ──────────────────────

def smiley():
    W = H = 512
    px = blank(W, H)
    yellow = (250, 204, 21, 255)
    dark = (40, 30, 10, 255)
    ellipse(px, 256, 256, 246, 246, yellow)
    ellipse(px, 180, 200, 34, 52, dark)
    ellipse(px, 332, 200, 34, 52, dark)
    for i in range(9):  # smile arc
        t = (i / 8.0) * math.pi
        ellipse(px, 256 - 140 * math.cos(t), 300 + 78 * math.sin(t), 20, 20, dark)
    png(os.path.join(ROOT, 'face', 'smiley.png'), W, H, px)


def blank_face():
    W = H = 512
    px = blank(W, H)
    ellipse(px, 256, 256, 250, 250, (24, 24, 30, 255))
    png(os.path.join(ROOT, 'face', 'blank.png'), W, H, px)


def pixel_face():
    W = H = 512
    px = blank(W, H)
    cell = 32
    tones = [(120, 90, 160), (90, 60, 130), (150, 120, 190), (60, 40, 100)]
    for gy in range(0, H, cell):
        for gx in range(0, W, cell):
            # deterministic checker of tones
            idx = (gx // cell * 7 + gy // cell * 13) % len(tones)
            rect(px, gx, gy, gx + cell, gy + cell, (*tones[idx], 255))
    # knock the corners back to a rounded blob
    for gy in range(0, H, cell):
        for gx in range(0, W, cell):
            dx = (gx + cell / 2 - 256) / 256
            dy = (gy + cell / 2 - 256) / 256
            if dx * dx + dy * dy > 1.0:
                for y in range(gy, min(gy + cell, H)):
                    for x in range(gx, min(gx + cell, W)):
                        px[y][x] = (0, 0, 0, 0)
    png(os.path.join(ROOT, 'face', 'pixel.png'), W, H, px)


# ── Upper props (sit above the face zone) ───────────────────────────────────

def witchhat():
    W, H = 560, 360
    px = blank(W, H)
    purple = (124, 58, 237, 255)
    dark = (76, 29, 149, 255)
    gold = (250, 204, 21, 255)
    poly(px, [(280, 10), (400, 268), (160, 268)], purple)
    poly(px, [(280, 10), (400, 268), (280, 268)], dark)
    ellipse(px, 280, 286, 190, 40, dark)
    ellipse(px, 280, 272, 190, 34, purple)
    for (sx, sy, r) in ((250, 140, 18), (315, 205, 13), (215, 220, 10)):
        poly(px, [(sx, sy - r), (sx + r * 0.32, sy - r * 0.32), (sx + r, sy),
                  (sx + r * 0.32, sy + r * 0.32), (sx, sy + r),
                  (sx - r * 0.32, sy + r * 0.32), (sx - r, sy),
                  (sx - r * 0.32, sy - r * 0.32)], gold)
    png(os.path.join(ROOT, 'props', 'witchhat.png'), W, H, px)


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

def cauldron():
    W, H = 720, 320
    px = blank(W, H)
    iron = (46, 46, 56, 255)
    rim = (72, 72, 86, 255)
    brew = (90, 220, 120, 255)
    ellipse(px, 360, 150, 250, 60, rim)
    ellipse(px, 360, 150, 220, 46, brew)
    ellipse(px, 360, 190, 250, 130, iron)
    rect(px, 110, 60, 610, 150, iron)
    for i in range(6):  # bubbles
        ellipse(px, 250 + i * 45, 120 - (i % 3) * 18, 12, 12, (150, 255, 180, 255))
    png(os.path.join(ROOT, 'props', 'cauldron.png'), W, H, px)


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
    for fn in (smiley, blank_face, pixel_face, witchhat, crown, cauldron, desk, frame):
        fn()
