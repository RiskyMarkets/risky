/*
 * The curve, at full size. Reserves flow in and mint ibAssets, which slide
 * *down* the curve; burns carry them back *up*. The spot marker and its price
 * readout ride along with whatever just happened.
 */

import { TOKENS, RESERVE } from './tokens.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const UP = '#00d95a';
const DOWN = '#ff3d3d';

/* P = m / S^k, sampled across the frame. */
const CURVE = {
  k: 0.55,
  sMin: 0.15, sMax: 1.0,
  x0: 150, x1: 1330,
  yTop: 74, yBot: 556,
};

const SPOT = { min: 0.20, max: 0.52, start: 0.30 };

const CONFIG = {
  mint:  { every: [1.5, 2.6], travel: [2.6, 3.6] },
  burn:  { every: [2.6, 4.4], travel: [2.2, 3.2] },
  ticks: { every: [0.14, 0.34], travel: [1.4, 2.4] },
};

// Big enough that the token artwork still reads at scene scale.
const CHIP_R = 31;

const rand = gsap.utils.random;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

const spotOf = (s) => s ** -CURVE.k;
const P_MIN = spotOf(CURVE.sMax);
const P_MAX = spotOf(CURVE.sMin);

function curveXY(s) {
  const { sMin, sMax, x0, x1, yTop, yBot } = CURVE;
  const t = (s - sMin) / (sMax - sMin);
  const p = (spotOf(s) - P_MIN) / (P_MAX - P_MIN);
  return { x: x0 + t * (x1 - x0), y: yBot - p * (yBot - yTop) };
}

/* The path every coin travels along, so the geometry is defined in one place. */
function curvePath(samples = 120) {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    pts.push(curveXY(CURVE.sMin + (i / samples) * (CURVE.sMax - CURVE.sMin)));
  }
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

const sAt = (f) => CURVE.sMin + f * (CURVE.sMax - CURVE.sMin);

/* Where a supply value sits along the path, as a 0-1 fraction for MotionPath. */
const frac = (s) => clamp((s - CURVE.sMin) / (CURVE.sMax - CURVE.sMin), 0, 1);

/*
 * A token rides as its own artwork; the reserve, which has none, rides as a
 * plain lettered disc.
 */
function makeChip(token, radius = CHIP_R) {
  const chip = el('g');
  chip.setAttribute('filter', 'url(#chipShadow)');
  chip.appendChild(el('circle', { r: radius * 2.1, fill: 'url(#chipGlow)' }));
  chip.appendChild(el('circle', { r: radius + 1.5, fill: '#05070a' }));

  if (token.image) {
    // The artwork is already round on a transparent ground, so it needs no clip.
    chip.appendChild(el('image', {
      href: token.image,
      x: -radius, y: -radius, width: radius * 2, height: radius * 2,
    }));
    chip.appendChild(el('circle', {
      r: radius, fill: 'none', stroke: token.color, 'stroke-width': 1.6, opacity: 0.9,
    }));
    return chip;
  }

  chip.appendChild(el('circle', { r: radius, fill: token.color }));
  chip.appendChild(el('circle', {
    r: radius - 1.4, fill: 'none', stroke: 'rgba(5,7,10,0.35)', 'stroke-width': 1.6,
  }));

  const label = el('text', {
    y: radius * 0.34,
    fill: '#05070a',
    'text-anchor': 'middle',
    'font-size': radius * 0.62,
    'font-weight': 800,
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });
  label.textContent = token.ticker ?? '';
  chip.appendChild(label);

  return chip;
}

/* ------------------------------------------------------------------ *
 * Static frame: grid, curve, axes
 * ------------------------------------------------------------------ */
function buildFrame() {
  const d = curvePath();
  document.getElementById('ibcCurve').setAttribute('d', d);
  document.getElementById('curveStroke').setAttribute('d', d);
  document.getElementById('curveFill')
    .setAttribute('d', `${d} L${CURVE.x1},${CURVE.yBot + 60} L${CURVE.x0},${CURVE.yBot + 60} Z`);

  const grid = document.getElementById('curveGrid');
  for (let i = 0; i <= 5; i++) {
    const y = CURVE.yTop + (i / 5) * (CURVE.yBot - CURVE.yTop);
    grid.appendChild(el('line', {
      x1: CURVE.x0 - 60, x2: CURVE.x1 + 70, y1: y, y2: y,
      stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 1,
    }));
  }
  for (let i = 0; i <= 6; i++) {
    const x = CURVE.x0 + (i / 6) * (CURVE.x1 - CURVE.x0);
    grid.appendChild(el('line', {
      x1: x, x2: x, y1: CURVE.yTop - 40, y2: CURVE.yBot + 60,
      stroke: 'rgba(255,255,255,0.05)', 'stroke-width': 1,
    }));
  }

  const axes = document.getElementById('curveAxes');
  const label = (x, y, text, anchor = 'start', fill = 'rgba(255,255,255,0.32)') => {
    const node = el('text', {
      x, y, fill, 'text-anchor': anchor,
      'font-size': 21, 'letter-spacing': '0.12em',
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    });
    node.textContent = text;
    axes.appendChild(node);
    return node;
  };
  label(CURVE.x0 - 58, CURVE.yTop - 14, 'PRICE');
  label(CURVE.x1 + 60, CURVE.yBot + 52, 'SUPPLY', 'end');

  /*
   * The rule of the place, spelled out in the corner the curve leaves empty.
   * One text node per line so the parts flow instead of being hand-spaced.
   */
  const rule = (y, action, arrow, effect, color) => {
    const line = label(CURVE.x1, y, '', 'end');
    const part = (text, fill) => {
      const span = el('tspan', { fill });
      span.textContent = text;
      line.appendChild(span);
    };
    part(`${action}  `, 'rgba(255,255,255,0.34)');
    part(`${arrow} `, color);
    part(effect, color);
  };
  rule(104, 'MINT', '↓', 'PRICE DOWN', DOWN);
  rule(146, 'BURN', '↑', 'PRICE UP', UP);
}

/* ------------------------------------------------------------------ *
 * Spot marker
 * ------------------------------------------------------------------ */
const spot = { s: SPOT.start };

function renderSpot() {
  spot.s = clamp(spot.s, SPOT.min, SPOT.max);
  const { x, y } = curveXY(spot.s);

  document.getElementById('spotMark').setAttribute('transform', `translate(${x} ${y})`);
  document.getElementById('spotGuide').setAttribute('d',
    `M${CURVE.x0 - 60},${y.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}`);

  const readout = document.getElementById('spotPrice');
  readout.setAttribute('y', (y - 16).toFixed(1));
  readout.textContent = spotOf(spot.s).toFixed(4);
}

/* A mint pushes supply out and the price down; a burn does the reverse. */
function nudge(delta) {
  gsap.to(spot, {
    s: clamp(spot.s + delta, SPOT.min, SPOT.max),
    duration: 1.1,
    ease: 'power2.out',
    onUpdate: renderSpot,
  });
}

function flash(color) {
  const { x, y } = curveXY(spot.s);
  const ring = el('circle', { cx: x, cy: y, r: 14, fill: color, opacity: 0.9 });
  document.getElementById('layerFlash').appendChild(ring);

  gsap.to(ring, {
    duration: 0.6, ease: 'power2.out',
    attr: { r: 96 }, opacity: 0,
    onComplete: () => ring.remove(),
  });

  gsap.fromTo('#spotDot',
    { scale: 1 },
    { scale: 1.5, duration: 0.14, yoyo: true, repeat: 1, transformOrigin: '50% 50%', ease: 'power2.out' });
}

/* ------------------------------------------------------------------ *
 * Flows
 * ------------------------------------------------------------------ */
const live = new Set();

function track(item) {
  live.add(item);
  return item;
}

let tokenCursor = 0;
const nextToken = () => TOKENS[tokenCursor++ % TOKENS.length];

/*
 * A mint: reserve arrives at the spot, and the ibAsset it buys slides down the
 * curve as the price it just paid for stops being available.
 */
function mint() {
  const token = nextToken();
  const entry = curveXY(spot.s);
  const chip = makeChip(RESERVE);
  document.getElementById('layerFlow').appendChild(chip);

  const from = { x: CURVE.x0 - 120, y: entry.y + rand(120, 260) };
  const tl = gsap.timeline({ onComplete() { live.delete(tl); } });
  track(tl);

  tl.fromTo(chip,
    { x: from.x, y: from.y, scale: 0.75, opacity: 0 },
    {
      x: entry.x, y: entry.y, scale: 1, opacity: 1,
      duration: rand(1.5, 2.1), ease: 'power2.inOut',
    })
    .add(() => {
      flash(DOWN);
      nudge(rand(0.03, 0.07));
      slide(token, 'down');
      chip.remove();
    });

  return tl;
}

/* A burn: the ibAsset climbs back up the curve and leaves as reserve. */
function burn() {
  const token = nextToken();
  slide(token, 'up');
  return null;
}

/*
 * Rides the curve away from (or into) the spot. Down is a mint pushing price
 * lower; up is a burn pulling it back. `near` is the spot for live trades, and
 * an arbitrary point for the ones seeded to fill the curve on first sight.
 */
function slide(token, direction, near = frac(spot.s)) {
  const down = direction === 'down';
  const chip = makeChip(token, CHIP_R * rand(0.85, 1.05));
  document.getElementById('layerFlow').appendChild(chip);

  const far = clamp(near + rand(down ? 0.22 : 0.20, down ? 0.50 : 0.44), 0, 1);
  const duration = rand(...(down ? CONFIG.mint.travel : CONFIG.burn.travel));

  const streak = el('path', {
    fill: 'none',
    stroke: down ? DOWN : UP,
    'stroke-width': 3,
    'stroke-linecap': 'round',
    opacity: 0.5,
  });
  const a = down ? near : far;
  const b = down ? far : near;
  streak.setAttribute('d', `M${curveXY(sAt(a)).x},${curveXY(sAt(a)).y} L${curveXY(sAt(b)).x},${curveXY(sAt(b)).y}`);
  document.getElementById('layerStreaks').appendChild(streak);

  const tl = gsap.timeline({
    onComplete() { live.delete(tl); chip.remove(); streak.remove(); },
  });
  track(tl);

  tl.fromTo(chip,
    { scale: down ? 0.5 : 0.9, opacity: 0 },
    {
      scale: 1, duration, ease: down ? 'power2.out' : 'power2.in',
      motionPath: {
        path: '#ibcCurve',
        start: down ? near : far,
        end: down ? far : near,
        autoRotate: false,
      },
    })
    .to(chip, { duration: 0.25, opacity: 1, ease: 'power2.out' }, 0)
    .fromTo(streak, { opacity: 0 }, { duration: 0.3, opacity: 0.5 }, 0)
    .to(streak, { duration: duration * 0.6, opacity: 0, ease: 'power2.in' }, duration * 0.4)
    .to(chip, { duration: duration * 0.3, opacity: 0, ease: 'power2.in' }, duration * 0.7);

  // A burn ends where it began, so settle the price back up on arrival.
  if (!down) {
    tl.add(() => { flash(UP); nudge(-rand(0.03, 0.06)); }, duration * 0.92);
  }

  return tl;
}

/* Ticks: the tape either side of the curve, red drifting down, green up. */
function tick() {
  const rising = Math.random() < 0.5;
  const startX = rand(CURVE.x0 - 70, CURVE.x1 + 50);
  const startY = rand(CURVE.yTop - 30, CURVE.yBot + 40);
  const distance = rand(90, 230) * (rising ? -1 : 1);
  const duration = rand(...CONFIG.ticks.travel);

  const mark = el('rect', {
    x: -2, y: 0, width: 4, height: rand(18, 52), rx: 2,
    fill: rising ? UP : DOWN,
  });
  document.getElementById('layerTicks').appendChild(mark);
  gsap.set(mark, { x: startX, y: startY, opacity: 0 });

  const tl = gsap.timeline({ onComplete() { live.delete(tl); mark.remove(); } });
  track(tl);

  tl.to(mark, { duration, y: startY + distance, ease: 'power1.out' })
    .to(mark, { duration: duration * 0.25, opacity: rand(0.3, 0.7), ease: 'none' }, 0)
    .to(mark, { duration: duration * 0.5, opacity: 0, ease: 'power2.in' }, duration * 0.5);

  return tl;
}

function spotPulse() {
  gsap.to('#spotHalo', {
    duration: 2.1, scale: 1.35, opacity: 0.35,
    ease: 'sine.inOut', yoyo: true, repeat: -1, transformOrigin: '50% 50%',
  });
  gsap.to('#curveGlow', {
    duration: 3.4, opacity: 0.75, ease: 'sine.inOut', yoyo: true, repeat: -1,
  });
}

let running = true;

function loop(fn, [min, max]) {
  const tick = () => {
    if (running) fn();
    gsap.delayedCall(rand(min, max), tick);
  };
  gsap.delayedCall(rand(min, max), tick);
}

/* Trades already in flight, spread along the curve, so it is never first seen empty. */
function seed() {
  for (let i = 0; i < 4; i++) slide(nextToken(), 'down', rand(0.10, 0.60)).progress(rand(0.15, 0.8));
  for (let i = 0; i < 3; i++) slide(nextToken(), 'up', rand(0.16, 0.66)).progress(rand(0.15, 0.7));
}

export function initCurveScene() {
  const scene = document.getElementById('scene');
  if (!scene) return;

  buildFrame();
  renderSpot();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (let i = 0; i < 4; i++) slide(nextToken(), 'down', rand(0.10, 0.60)).progress(rand(0.25, 0.7)).pause();
    for (let i = 0; i < 3; i++) slide(nextToken(), 'up', rand(0.16, 0.66)).progress(rand(0.25, 0.7)).pause();
    return;
  }

  spotPulse();
  seed();

  loop(mint, CONFIG.mint.every);
  loop(burn, CONFIG.burn.every);
  loop(tick, CONFIG.ticks.every);

  new IntersectionObserver((entries) => {
    running = entries[0].isIntersecting;
    live.forEach((item) => (running ? item.resume() : item.pause()));
  }, { threshold: 0 }).observe(scene);
}
