# Regenerating the wordmark

`scripts/risky-mark.js` is generated from `brand/risky-wordmark.png` — the logo
artwork on a black background. If the logo changes, retrace it:

```bash
python3 tools/trace_mark.py brand/risky-wordmark.png 40 lum 0.45 > /tmp/mark.json
```

The arguments are the source, the luminance threshold that separates the mark
from the background, whether to read `lum`inance or `alpha`, and the simplify
tolerance in source pixels. The result is a set of closed contours in reading
order; paste them into `MARK_CONTOURS`, and update `MARK_W` / `MARK_H` and the
`CHEVRONS` indices (the two overlapping pieces that stand in for the "s").

`favicon.svg` is those two chevrons on their own.

# Regenerating the token artwork

`brand/tokens/*.png` are the round avatars the coins, chips and curve scene all
use. They are cut from the DEX Screener screenshots kept in
`brand/tokens/source/` by:

```bash
python3 tools/crop_tokens.py
```

Three of the shots are the artwork full-bleed; the rest have chart chrome
around them, so the script finds the subject, lifts it onto its own ground, and
masks everything to a circle with a transparent surround. That transparency is
what lets the same file drop onto a 3D coin, a CSS chip and an SVG `<image>`
with no further masking. `JOBS` at the top of the script maps each screenshot to
its slug and cut; add a row there for a new token.

Each token's `color` in `scripts/tokens.js` is the signature colour sampled from
its artwork — the most common reasonably-saturated shade in it.
