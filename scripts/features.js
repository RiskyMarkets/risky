/* Four looping vignettes, one per protocol surface. */

import { TOKENS } from './tokens.js';

const NS = 'http://www.w3.org/2000/svg';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const UP = '#00d95a';
const DOWN = '#ff3d3d';

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

const pathOf = (pts) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/* ------------------------------------------------------------------ *
 * /mint — the curve, running backwards
 *
 * P = m / S^k. Buying mints supply and walks the price down the curve;
 * selling burns it and walks the price back up. The whole protocol is this
 * one picture, so the card just plays it on a loop.
 * ------------------------------------------------------------------ */
const CURVE = {
  k: 0.55,
  sMin: 0.10, sMax: 1.0,
  buyFrom: 0.30, buyTo: 0.86,
  x0: 16, x1: 244,
  yTop: 26, yBot: 150,
};

const spotOf = (s) => s ** -CURVE.k;

function curveXY(s) {
  const { sMin, sMax, x0, x1, yTop, yBot } = CURVE;
  const pMin = spotOf(sMax);
  const pMax = spotOf(sMin);
  const t = (s - sMin) / (sMax - sMin);
  const p = (spotOf(s) - pMin) / (pMax - pMin);
  return { x: x0 + t * (x1 - x0), y: yBot - p * (yBot - yTop) };
}

function cardCurve() {
  const line = document.getElementById('curveLine');
  const area = document.getElementById('curveArea');
  const marker = document.getElementById('curveMarker');
  const trail = document.getElementById('curveTrail');
  const action = document.getElementById('curveAction');
  const price = document.getElementById('curvePrice');

  const pts = [];
  for (let i = 0; i <= 60; i++) {
    pts.push(curveXY(CURVE.sMin + (i / 60) * (CURVE.sMax - CURVE.sMin)));
  }
  const d = pathOf(pts);
  line.setAttribute('d', d);
  area.setAttribute('d', `${d} L${CURVE.x1},170 L${CURVE.x0},170 Z`);

  /* Gridlines, so the drop down the curve has something to be measured against. */
  const grid = document.getElementById('curveCardGrid');
  for (let i = 0; i < 5; i++) {
    const y = CURVE.yTop + (i / 4) * (CURVE.yBot - CURVE.yTop);
    grid.appendChild(svg('line', {
      x1: CURVE.x0, x2: CURVE.x1, y1: y, y2: y,
      stroke: 'rgba(255,255,255,0.06)', 'stroke-width': 1,
    }));
  }

  const state = { s: CURVE.buyFrom };

  function render(side) {
    const { x, y } = curveXY(state.s);
    marker.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    // The trail is the stretch of curve already walked in this direction.
    trail.setAttribute('d', `M${x.toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},170`);
    price.textContent = spotOf(state.s).toFixed(4);
    if (side) {
      const buying = side === 'buy';
      action.textContent = buying ? 'minting → price down' : 'burning → price up';
      action.style.color = buying ? DOWN : UP;
      marker.querySelector('circle').setAttribute('fill', buying ? DOWN : UP);
      price.style.color = buying ? DOWN : UP;
    }
  }

  render('buy');
  if (reduced) return;

  gsap.timeline({ repeat: -1 })
    .call(() => render('buy'))
    .to(state, {
      s: CURVE.buyTo, duration: 2.4, ease: 'power1.inOut',
      onUpdate: () => render(),
    })
    .to({}, { duration: 0.7 })
    .call(() => render('sell'))
    .to(state, {
      s: CURVE.buyFrom, duration: 2.4, ease: 'power1.inOut',
      onUpdate: () => render(),
    })
    .to({}, { duration: 0.7 });
}

/* ------------------------------------------------------------------ *
 * /leverage — spot against the position it carries
 * ------------------------------------------------------------------ */
const LEV = { points: 22, x0: 14, x1: 246, mid: 96, span: 62, multiple: 3.4 };

/* A wobble on a rising trend, so it reads as a real tape rather than a curve. */
function tape() {
  const out = [];
  for (let i = 0; i < LEV.points; i++) {
    const t = i / (LEV.points - 1);
    const drift = 0.12 * t;
    const noise = Math.sin(i * 1.7) * 0.016 + Math.sin(i * 0.55) * 0.011;
    out.push({ t, spot: drift + (i ? noise : 0) });
  }
  return out;
}

function cardLeverage() {
  const rows = tape();
  const spotLine = document.getElementById('spotLine');
  const levLine = document.getElementById('levLine');
  const levArea = document.getElementById('levArea');
  const head = document.getElementById('levHead');
  const spotOut = document.getElementById('spotPct');
  const levOut = document.getElementById('levPct');

  const toXY = (row, gain) => ({
    x: LEV.x0 + row.t * (LEV.x1 - LEV.x0),
    y: LEV.mid - gain * LEV.span * 3.4,
  });

  const spotPts = rows.map((row) => toXY(row, row.spot));
  const levPts = rows.map((row) => toXY(row, row.spot * LEV.multiple));

  const spotD = pathOf(spotPts);
  const levD = pathOf(levPts);
  spotLine.setAttribute('d', spotD);
  levLine.setAttribute('d', levD);
  levArea.setAttribute('d', `${levD} L${LEV.x1},${LEV.mid} L${LEV.x0},${LEV.mid} Z`);

  const bars = document.getElementById('levBars');
  rows.forEach((row, i) => {
    const { x } = toXY(row, 0);
    const h = 10 + ((Math.sin(i * 2.1) + 1) / 2) * 16 + i * 0.9;
    bars.appendChild(svg('rect', {
      x: x - 3.5, y: 170 - h, width: 7, height: h, rx: 1.5, fill: 'url(#levBarGrad)',
    }));
  });

  const last = rows.at(-1).spot;
  const write = (spot) => {
    const sign = (n) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
    spotOut.textContent = sign(spot);
    levOut.textContent = sign(spot * LEV.multiple);
  };

  if (reduced) {
    gsap.set(head, { x: levPts.at(-1).x, y: levPts.at(-1).y });
    write(last);
    return;
  }

  const counter = { spot: 0 };
  const length = levLine.getTotalLength();
  const spotLength = spotLine.getTotalLength();

  gsap.timeline({ repeat: -1, repeatDelay: 0.3 })
    .from(bars.children, {
      scaleY: 0, transformOrigin: '50% 100%', duration: 0.5,
      stagger: 0.035, ease: 'power2.out',
    })
    .fromTo(spotLine,
      { strokeDasharray: spotLength, strokeDashoffset: spotLength },
      { strokeDashoffset: 0, duration: 2.4, ease: 'none' }, 0.2)
    .fromTo(levLine,
      { strokeDasharray: length, strokeDashoffset: length },
      { strokeDashoffset: 0, duration: 2.4, ease: 'none' }, 0.2)
    .fromTo(levArea, { opacity: 0 }, { opacity: 1, duration: 1.4 }, 0.6)
    .fromTo(head,
      { opacity: 0 },
      {
        opacity: 1, duration: 2.4, ease: 'none',
        motionPath: { path: '#levLine', autoRotate: false },
      }, 0.2)
    .to(counter, {
      spot: last, duration: 2.4, ease: 'none',
      onUpdate: () => write(counter.spot),
    }, 0.2)
    /* Hold the finished tape, then clear quickly so the loop is barely felt. */
    .to({}, { duration: 2.6 })
    .to([spotLine, levLine, levArea, head, ...bars.children], { opacity: 0, duration: 0.45 });
}

/* ------------------------------------------------------------------ *
 * /markets — the memecoins with a curve open against them
 * ------------------------------------------------------------------ */
function tokenChip(token) {
  const chip = document.createElement('div');
  chip.className = 'chip chip--token';
  chip.style.setProperty('--ring', token.color);

  const art = document.createElement('img');
  art.src = token.image;
  art.alt = '';
  art.loading = 'lazy';
  chip.appendChild(art);
  return chip;
}

/*
 * The whole roster, once, in a different order per row: a rail that ran longer
 * than the roster would show the same coin twice in one pass, and rails that
 * were only rotations of each other read as one wall moving at three speeds.
 */
function scatterRow(seed) {
  const row = [...TOKENS];
  let s = seed;
  for (let i = row.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [row[i], row[j]] = [row[j], row[i]];
  }
  return row;
}

function cardMarkets() {
  const rows = [
    { id: 'railA', items: scatterRow(1), secs: 34, back: false },
    { id: 'railB', items: scatterRow(2), secs: 40, back: true },
    { id: 'railC', items: scatterRow(5), secs: 30, back: false },
  ];

  rows.forEach(({ id, items, secs, back }) => {
    const rail = document.getElementById(id);
      /* Two identical passes so a -50% shift loops seamlessly; the seam is
       always off the card, so no token is ever on screen twice. */
    for (let pass = 0; pass < 2; pass++) {
      items.forEach((token) => rail.appendChild(tokenChip(token)));
    }
    if (reduced) return;

    if (back) gsap.fromTo(rail, { xPercent: -50 }, { xPercent: 0, duration: secs, ease: 'none', repeat: -1 });
    else gsap.to(rail, { xPercent: -50, duration: secs, ease: 'none', repeat: -1 });
  });
}

/* ------------------------------------------------------------------ *
 * /stake — every mint, burn and LP move pays the stakers
 * ------------------------------------------------------------------ */
const RAILS = [
  { d: 'M -14,64 L 274,14',   label: 'mint', per: 5.4 },
  { d: 'M -14,146 L 274,96',  label: 'burn', per: 6.2 },
  { d: 'M -14,228 L 274,178', label: 'LP',   per: 7.0 },
];

function cardStake() {
  const railHost = document.getElementById('feeRails');
  const coinHost = document.getElementById('feeCoins');

  RAILS.forEach((rail, i) => {
    railHost.appendChild(svg('path', {
      d: rail.d,
      fill: 'none',
      stroke: 'rgba(0,217,90,0.26)',
      'stroke-width': 1.25,
      'stroke-dasharray': '4 8',
    }));

    const label = svg('text', {
      x: 208, y: 14 + i * 82 - 12,
      fill: 'rgba(255,255,255,0.42)',
      'font-size': 11,
      'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    });
    label.textContent = rail.label;
    railHost.appendChild(label);

    /* Two fees per rail, evenly spaced along the loop. */
    for (let n = 0; n < 2; n++) {
      const coin = svg('g');
      coin.appendChild(svg('circle', { r: 13.5, fill: '#06140b' }));
      coin.appendChild(svg('circle', { r: 12.9, fill: 'none', stroke: UP, 'stroke-width': 1.1 }));
      const glyph = svg('text', {
        x: 0, y: 4,
        fill: UP,
        'font-size': 12,
        'font-weight': 600,
        'text-anchor': 'middle',
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
      });
      glyph.textContent = 'ƒ';
      coin.appendChild(glyph);
      coinHost.appendChild(coin);

      const tween = gsap.to(coin, {
        duration: rail.per,
        ease: 'none',
        repeat: -1,
        motionPath: { path: rail.d, autoRotate: false },
      });
      tween.progress(n / 2);
      if (reduced) tween.pause();
    }
  });
}

export function initFeatures() {
  if (!document.getElementById('curveLine')) return;

  cardCurve();
  cardLeverage();
  cardMarkets();
  cardStake();
}
