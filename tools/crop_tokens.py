#!/usr/bin/env python3
"""
Cut the token avatars out of the DEX Screener screenshots into round PNGs.

Three of the shots are the artwork full-bleed; the rest have chart chrome around
them, so the subject is found, lifted, and re-laid on its own ground.
"""

import glob
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "brand/tokens/source")
OUT = os.path.join(HERE, "brand/tokens")
SIZE = 320

# stamp -> (slug, mode, ground for the re-laid subject, square as a multiple of it)
JOBS = [
    ("9.20.36", "visor-dog",     "full",   None,        1.00),
    ("9.20.47", "amc",           "red",    None,        1.00),
    ("9.21.02", "statue",        "gold",   None,        1.04),
    ("9.21.10", "chrome-letter", "letter", (0, 0, 0),   1.52),
    ("9.21.28", "mushroom",      "letter", "sample",    1.46),
    ("9.21.50", "tg",            "full",   None,        1.00),
    ("9.22.02", "cow",           "full",   None,        1.00),
]

lum = lambda r, g, b: 0.299 * r + 0.587 * g + 0.114 * b


def hits(mode, r, g, b):
    if mode == "red":
        return r > 110 and r - g > 45 and r - b > 45
    if mode == "gold":
        return r > 120 and g > 70 and r - b > 60
    if mode == "letter":
        return lum(r, g, b) > 100
    return True


def find_box(im, mode, step=2):
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(0, h, step):
        for x in range(0, w, step):
            if hits(mode, *px[x, y]):
                xs.append(x)
                ys.append(y)
    if not xs:
        return (0, 0, w, h)
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def centred_square(box, grow):
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0) * grow
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return (round(cx - side / 2), round(cy - side / 2),
            round(cx + side / 2), round(cy + side / 2))


def circle_mask(size):
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
mask = circle_mask(SIZE)

for stamp, slug, mode, ground, grow in JOBS:
    path = glob.glob(os.path.join(SRC, f"{stamp}.png"))[0]
    im = Image.open(path).convert("RGB")
    w, h = im.size

    if ground is not None:
        # Lift the subject off the chart and re-lay it on a clean field.
        box = find_box(im, mode)
        if ground == "sample":
            probe = (max(0, box[0] - 40), max(0, (box[1] + box[3]) // 2))
            ground = im.getpixel(probe)
        subject = im.crop(box)
        if slug == "chrome-letter":
            # A soft luminance key: the letter is bright, the chart behind it is not.
            keyed = subject.convert("RGBA")
            grey = subject.convert("L").point(lambda v: max(0, min(255, (v - 70) * 6)))
            keyed.putalpha(grey)
            subject = Image.new("RGB", subject.size, (0, 0, 0))
            subject.paste(keyed, (0, 0), keyed)
        side = round(max(subject.size) * grow)
        flat = Image.new("RGB", (side, side), tuple(ground))
        flat.paste(subject, ((side - subject.width) // 2, (side - subject.height) // 2))
        art = flat
    else:
        box = centred_square((0, 0, w, h) if mode == "full" else find_box(im, mode), grow)
        art = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), im.getpixel((1, 1)))
        art.paste(im.crop((max(0, box[0]), max(0, box[1]),
                           min(w, box[2]), min(h, box[3]))),
                  (max(0, -box[0]), max(0, -box[1])))

    art = art.resize((SIZE, SIZE), Image.LANCZOS).convert("RGBA")
    art.putalpha(mask)
    art.save(f"{OUT}/{slug}.png")
    print(f"{slug:14} {mode:7} {art.size}")
