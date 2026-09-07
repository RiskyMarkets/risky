#!/usr/bin/env python3
"""
Trace the artwork in a PNG into simplified polygon contours.

Marching squares with linear interpolation, so edges land between pixels rather
than on a staircase; the outlines then simplify down to very few points without
losing the diagonals or the round caps.
"""

import json
import sys
from PIL import Image

# (TL, TR, BR, BL) inside-ness -> segments as (from_edge, to_edge), edges T R B L.
TABLE = {
    0: [], 15: [],
    1: [("L", "B")], 2: [("B", "R")], 3: [("L", "R")],
    4: [("R", "T")], 6: [("B", "T")], 7: [("L", "T")],
    8: [("T", "L")], 9: [("T", "B")], 11: [("T", "R")],
    12: [("R", "L")], 13: [("R", "B")], 14: [("B", "L")],
}


def band_of(path, use_alpha):
    im = Image.open(path)
    if use_alpha:
        return im.convert("RGBA").split()[3]
    return im.convert("L")


def contours(path, threshold, use_alpha, epsilon):
    band = band_of(path, use_alpha)
    w, h = band.size
    px = band.load()
    # One empty pixel of padding, so shapes touching the edge still close.
    val = lambda x, y: px[x, y] if 0 <= x < w and 0 <= y < h else 0

    cache = {}

    def crossing(ax, ay, bx, by):
        """Where the threshold falls between two lattice samples, cached per edge."""
        key = (ax, ay, bx, by)
        hit = cache.get(key)
        if hit is None:
            va, vb = val(ax, ay), val(bx, by)
            t = 0.5 if va == vb else (threshold - va) / (vb - va)
            t = min(1.0, max(0.0, t))
            hit = (ax + (bx - ax) * t, ay + (by - ay) * t)
            cache[key] = hit
        return hit

    segments = []
    for y in range(-1, h):
        for x in range(-1, w):
            a, b = val(x, y) >= threshold, val(x + 1, y) >= threshold
            c, d = val(x + 1, y + 1) >= threshold, val(x, y + 1) >= threshold
            idx = a * 8 + b * 4 + c * 2 + d

            if idx in (5, 10):
                middle = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4
                inside = middle >= threshold
                if idx == 5:
                    pairs = [("L", "T"), ("R", "B")] if inside else [("L", "B"), ("R", "T")]
                else:
                    pairs = [("T", "R"), ("B", "L")] if inside else [("T", "L"), ("B", "R")]
            else:
                pairs = TABLE[idx]

            if not pairs:
                continue

            edge = {
                "T": lambda: crossing(x, y, x + 1, y),
                "R": lambda: crossing(x + 1, y, x + 1, y + 1),
                "B": lambda: crossing(x, y + 1, x + 1, y + 1),
                "L": lambda: crossing(x, y, x, y + 1),
            }
            for src, dst in pairs:
                segments.append((edge[src](), edge[dst]()))

    # Endpoints on a shared cell edge come from the same cached crossing, so they
    # match exactly and the loops stitch without any tolerance.
    following = {}
    for start, end in segments:
        following.setdefault(start, []).append(end)

    loops = []
    while following:
        begin = next(iter(following))
        loop, node = [begin], begin
        while True:
            outs = following.get(node)
            if not outs:
                break
            nxt = outs.pop()
            if not outs:
                del following[node]
            loop.append(nxt)
            node = nxt
            if node == begin:
                break
        if len(loop) > 8:
            loops.append(loop)

    return [rdp(loop, epsilon) for loop in loops], w, h


def rdp(points, epsilon):
    if len(points) < 3:
        return points
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    span = (dx * dx + dy * dy) ** 0.5

    worst, index = 0.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = (((px - ax) ** 2 + (py - ay) ** 2) ** 0.5 if span == 0
             else abs(dy * px - dx * py + bx * ay - by * ax) / span)
        if d > worst:
            worst, index = d, i

    if worst <= epsilon:
        return [points[0], points[-1]]
    return rdp(points[: index + 1], epsilon)[:-1] + rdp(points[index:], epsilon)


def area(loop):
    total = 0.0
    for i, (x1, y1) in enumerate(loop):
        x2, y2 = loop[(i + 1) % len(loop)]
        total += x1 * y2 - x2 * y1
    return total / 2


if __name__ == "__main__":
    path, threshold, mode, epsilon = sys.argv[1], int(sys.argv[2]), sys.argv[3], float(sys.argv[4])
    sys.setrecursionlimit(200000)

    loops, w, h = contours(path, threshold, mode == "alpha", epsilon)
    loops = [c for c in loops if len(c) > 3 and abs(area(c)) > 30]

    xs = [p[0] for c in loops for p in c]
    ys = [p[1] for c in loops for p in c]
    x0, y0 = min(xs), min(ys)

    out = [[[round(x - x0, 2), round(y - y0, 2)] for x, y in c] for c in loops]
    out.sort(key=lambda c: -abs(area(c)))

    print(json.dumps({
        "width": round(max(xs) - x0, 2), "height": round(max(ys) - y0, 2),
        "contours": out,
        "sizes": [len(c) for c in out],
        "areas": [round(area(c)) for c in out],
    }))
