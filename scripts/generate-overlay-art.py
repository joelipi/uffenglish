#!/usr/bin/env python3
"""Generate placeholder prop art for the recording-look spike (stories/091).

Deliberately crude on purpose: these exist so the owner can see a prop sitting at
a fixed position while they frame their own face. Original shapes, no third-party
art, no licence questions. PNG only (the repo forbids committed jpg/mp4 under
public/).
"""
import struct
import zlib
import math
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'overlays')


def png(path, width, height, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a) tuples."""
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
    with open(path, 'wb') as fh:
        fh.write(data)
    print(f'{os.path.basename(path)} {width}x{height} {len(data)} bytes')


def blank(width, height):
    return [[(0, 0, 0, 0) for _ in range(width)] for _ in range(height)]


def blend(px, x, y, color, alpha=1.0):
    if 0 <= y < len(px) and 0 <= x < len(px[0]):
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


def fill_rect(px, x0, y0, x1, y1, color):
    for y in range(max(0, y0), min(len(px), y1)):
        for x in range(max(0, x0), min(len(px[0]), x1)):
            blend(px, x, y, color)


def fill_ellipse(px, cx, cy, rx, ry, color):
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            dx = (x - cx) / rx if rx else 0
            dy = (y - cy) / ry if ry else 0
            if dx * dx + dy * dy <= 1.0:
                blend(px, x, y, color)


def fill_polygon(px, points, color):
    ys = [p[1] for p in points]
    for y in range(int(min(ys)), int(max(ys)) + 1):
        xs = []
        for i in range(len(points)):
            x1, y1 = points[i]
            x2, y2 = points[(i + 1) % len(points)]
            if (y1 <= y < y2) or (y2 <= y < y1):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            for x in range(int(math.floor(xs[i])), int(math.ceil(xs[i + 1])) + 1):
                blend(px, x, y, color)


def make_hat():
    """A wizard-ish party hat hanging from the top edge, centred."""
    W, H = 720, 420
    px = blank(W, H)
    purple = (124, 58, 237, 255)
    dark = (76, 29, 149, 255)
    gold = (250, 204, 21, 255)
    # Cone: tip at the very top centre, flaring to the brim.
    fill_polygon(px, [(360, 4), (470, 250), (250, 250)], purple)
    # Shading down one side.
    fill_polygon(px, [(360, 4), (470, 250), (360, 250)], dark)
    # Brim.
    fill_ellipse(px, 360, 262, 140, 34, dark)
    fill_ellipse(px, 360, 254, 140, 30, purple)
    # Stars.
    for (sx, sy, r) in ((330, 120, 15), (390, 175, 11), (300, 195, 9)):
        fill_polygon(px, [(sx, sy - r), (sx + r * 0.3, sy - r * 0.3),
                          (sx + r, sy), (sx + r * 0.3, sy + r * 0.3),
                          (sx, sy + r), (sx - r * 0.3, sy + r * 0.3),
                          (sx - r, sy), (sx - r * 0.3, sy - r * 0.3)], gold)
    png(os.path.join(OUT, 'hat.png'), W, H, px)


def make_desk():
    """A desk / table edge across the bottom of the frame."""
    W, H = 720, 300
    px = blank(W, H)
    wood = (124, 84, 51, 255)
    wood_dark = (86, 57, 34, 255)
    wood_top = (156, 110, 70, 255)
    # Top surface (a slight perspective trapezoid), then the front face.
    fill_polygon(px, [(0, 40), (720, 40), (720, 300), (0, 300)], wood)
    fill_polygon(px, [(0, 40), (720, 40), (720, 60), (0, 60)], wood_top)
    for y in range(60, 300, 46):
        fill_rect(px, 0, y, 720, y + 3, wood_dark)
    # A mug, because an empty desk reads as a bug.
    fill_rect(px, 540, 0, 610, 40, (232, 232, 236, 255))
    fill_ellipse(px, 575, 2, 35, 10, (210, 210, 216, 255))
    for i in range(8):
        fill_ellipse(px, 545 + i * 9, 40 + (i % 2) * 2, 5, 4, (232, 232, 236, 255))
    png(os.path.join(OUT, 'desk.png'), W, H, px)


def make_frame():
    """A soft border that hides the edges of the room."""
    W, H = 720, 1280
    px = blank(W, H)
    edge = (18, 20, 34, 235)
    glow = (60, 70, 120, 90)
    band = 92
    for y in range(H):
        for x in range(W):
            d = min(x, y, W - 1 - x, H - 1 - y)
            if d < band:
                t = 1.0 - (d / band)
                blend(px, x, y, edge, min(1.0, t * 1.6))
            elif d < band * 1.9:
                t = 1.0 - ((d - band) / (band * 0.9))
                blend(px, x, y, glow, t * 0.5)
    png(os.path.join(OUT, 'frame.png'), W, H, px)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    make_hat()
    make_desk()
    make_frame()
