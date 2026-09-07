/*
 * The hero: the word "risky" extruded into 3D, rendered white and rippled by
 * the pointer. Scrolling drives a single progress value — the word boils,
 * whirls and bursts into a drifting field of Robinhood Chain memecoins and
 * sparks, which carries the eye into the first section. Draws on a transparent
 * canvas so it sits on the page background rather than carrying its own.
 */
import * as THREE from 'three';
import {
  Fn, positionLocal, normalLocal, positionGeometry,
  uniformArray, uniform, Loop, int, float, vec3,
  length, exp, cos, sin, normalize, transformNormalToView,
} from 'three/tsl';

import { MARK_CONTOURS, MARK_W as ART_W, MARK_H as ART_H, CHEVRONS } from './risky-mark.js';
import { TOKENS } from './tokens.js';

const SCALE = 6 / ART_W;    // the wordmark is 6 world units wide
const DEPTH = 0.34;         // extrusion depth
const BEVEL = 0.016;        // just enough of a rounded edge to catch the key light
const WEAVE = 0.18;         // how far the back chevron of the "s" sits behind the front
const IMPULSES = 12;        // concurrent pointer ripples
const WOBBLE = 0.07;        // ripple displacement, in world units
const SWELL = 0.028;        // idle surface swell, in world units
const EPS = 0.04;           // finite-difference step for the deformed normals

const MARK_W = ART_W * SCALE;
const MARK_H = ART_H * SCALE;
const MARK_SHARE = 0.62;    // share of viewport width it should occupy
const MARK_CENTRE = 0.5;    // where its centre sits, measured from the top

const COIN_R = 0.5;         // coin radius
const COIN_T = 0.15;        // coin thickness

const COINS = TOKENS.length * 2;   // the roster twice over: a fuller burst, each coin appearing on both sides
const SPARKS = 30;

/*
 * Scroll windows, as a share of the hero's scroll height. The burst finishes
 * before the next section starts covering the stage, so it plays out in full.
 */
const MELT = [0.05, 0.34];
const BURST = [0.08, 0.44];
const FADE = [0.72, 0.95];

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const range = (n, [a, b]) => clamp01((n - a) / (b - a));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/* Overshoots slightly, so each piece pops rather than easing limply into place. */
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.44 * (t - 1) ** 2;

/* Deterministic, so a layout that looks right stays that way across reloads. */
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const hexRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/* Concatenates geometries into one, keeping only position and normal. */
function mergeGeometries(parts) {
  const position = [];
  const normal = [];

  for (const part of parts) {
    const pos = part.attributes.position;
    const nrm = part.attributes.normal;
    const idx = part.index;
    const count = idx ? idx.count : pos.count;

    for (let i = 0; i < count; i++) {
      const v = idx ? idx.getX(i) : i;
      position.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      normal.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
    }
    part.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/*
 * The traced wordmark, extruded. The artwork is y-down and sized in its own
 * pixels, so each contour is flipped and scaled into world units on the way in.
 * The two chevrons of the "s" get their own pass at a different z, which is
 * what makes the mark interlock rather than fuse where they overlap.
 */
function buildWordGeometry() {
  const settings = {
    depth: DEPTH - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 1,       // the contours are already polygons
  };

  const shapeOf = (contour) => new THREE.Shape(
    contour.map(([x, y]) => new THREE.Vector2(
      (x - ART_W / 2) * SCALE,
      (ART_H / 2 - y) * SCALE,
    )),
  );

  const zOf = (index) => {
    if (index === CHEVRONS.back) return -WEAVE / 2;
    if (index === CHEVRONS.front) return WEAVE / 2;
    return 0;
  };

  // One pass per z plane, so shapes sharing a plane still share a draw.
  const planes = new Map();
  MARK_CONTOURS.forEach((contour, index) => {
    const z = zOf(index);
    if (!planes.has(z)) planes.set(z, []);
    planes.get(z).push(shapeOf(contour));
  });

  const parts = [];
  for (const [z, shapes] of planes) {
    const part = new THREE.ExtrudeGeometry(shapes, settings);
    part.translate(0, 0, z - DEPTH / 2);
    parts.push(part);
  }
  return mergeGeometries(parts);
}

/* Stands the cylinder up, so a coin's faces point down +z. */
function buildCoinGeometry() {
  const geometry = new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_T, 56);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/*
 * Paints a matcap: a lit sphere baked into a texture, looked up by view-space
 * normal. Dark body, coloured key light, hot rim at grazing angles.
 */
function buildMatcap(palette, size = 256) {
  const { body, mid, rim: rimColor, spark, cool } = palette;

  const unit = (v) => { const l = Math.hypot(...v); return v.map((n) => n / l); };
  const key = unit([-0.42, 0.55, 0.72]);
  const fill = unit([0.75, -0.2, 0.5]);
  const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let nx = (x / (size - 1)) * 2 - 1;
      let ny = 1 - (y / (size - 1)) * 2;

      // Outside the disc there is no sphere to sample, so clamp to its silhouette.
      if (nx * nx + ny * ny > 1) {
        const a = Math.atan2(ny, nx);
        nx = Math.cos(a) * 0.999;
        ny = Math.sin(a) * 0.999;
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));

      const kd = Math.max(0, nx * key[0] + ny * key[1] + nz * key[2]);
      const fd = Math.max(0, nx * fill[0] + ny * fill[1] + nz * fill[2]);
      const rim = (1 - nz) ** 3.2;
      const spec = kd ** 42;

      let c = mix(body, mid, kd ** 0.9);
      c = c.map((n, i) => n + rimColor[i] * rim * 0.9);
      c = c.map((n, i) => n + cool[i] * fd * 0.22);
      c = c.map((n, i) => n + spark[i] * spec * 0.85);

      const i = (y * size + x) * 4;
      data[i] = Math.min(255, c[0] * 255);
      data[i + 1] = Math.min(255, c[1] * 255);
      data[i + 2] = Math.min(255, c[2] * 255);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* The wordmark: white body, grey shading, blown-out rim. */
const WHITE = {
  body: [0.56, 0.58, 0.63], mid: [1.0, 1.0, 1.0], rim: [1.0, 1.0, 1.0],
  spark: [1.0, 1.0, 1.0], cool: [0.24, 0.28, 0.38],
};
/* Near-neutral, so a coin face texture multiplies through it without tinting. */
const FACE = {
  body: [0.50, 0.52, 0.57], mid: [1.0, 1.0, 1.0], rim: [0.85, 0.88, 0.94],
  spark: [1.0, 1.0, 1.0], cool: [0.42, 0.46, 0.54],
};
const UP = {
  body: [0.02, 0.16, 0.06], mid: [0.05, 0.78, 0.28], rim: [0.55, 1.0, 0.70],
  spark: [0.90, 1.0, 0.94], cool: [0.04, 0.30, 0.14],
};
const DOWN = {
  body: [0.20, 0.03, 0.04], mid: [0.92, 0.16, 0.16], rim: [1.0, 0.60, 0.55],
  spark: [1.0, 0.92, 0.90], cool: [0.28, 0.06, 0.06],
};

/* A token's rim: its brand colour, darkened into a body and lifted at the rim. */
const brandPalette = (hex) => {
  const c = hexRgb(hex);
  return {
    body: c.map((n) => n * 0.20),
    mid: c,
    rim: c.map((n) => Math.min(1, n * 0.35 + 0.55)),
    spark: [1, 1, 1],
    cool: c.map((n) => n * 0.28),
  };
};

/*
 * Where each piece of the burst travels to, and how it tumbles on the way.
 * Destinations are kept as (nx, ny): shares of the half-width and half-height,
 * so the field stretches with the viewport.
 */
function layout(count, seed, opts) {
  const r = rng(seed);
  const parts = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.8;
    const radius = opts.minR + r() * (opts.maxR - opts.minR);
    const squash = 0.78 + r() * 0.34;
    return {
      nx: Math.cos(angle) * radius,
      ny: Math.sin(angle) * radius * squash,
      z: (r() * 2 - 1) * opts.depth,
      scale: opts.minScale + r() * (opts.maxScale - opts.minScale),
      delay: r() * 0.5,
      axis: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(),
      spin: (0.3 + r() * 0.8) * (r() > 0.5 ? 1 : -1),
      phase: r() * Math.PI * 2,
      bob: 0.35 + r() * 0.55,
      tilt: (r() * 2 - 1) * 0.34,
      roll: (r() * 2 - 1) * 0.42,
    };
  });
  if (opts.separate) separate(parts, opts);
  return parts;
}

/*
 * Nudges pieces apart until no two overlap. Works in a frame where one unit is
 * the half-height, with the width stretched by a typical aspect ratio, so a
 * coin's footprint is its world radius over the camera's half-height at z = 0.
 * Pieces are held inside the screen ellipse while they settle.
 */
function separate(parts, opts) {
  const ASPECT = 1.7;
  const HALF_H = 6 * Math.tan((35 / 2) * Math.PI / 180);   // camera at z = 6, fov 35
  const footprint = (p) => (COIN_R * p.scale / HALF_H) * (opts.padding ?? 1.15);
  const pts = parts.map((p) => ({ x: p.nx * ASPECT, y: p.ny, r: footprint(p) }));
  for (let iter = 0; iter < 240; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const need = a.r + b.r;
        if (d >= need) continue;
        if (d < 1e-4) { dx = Math.cos(i * 2.399); dy = Math.sin(i * 2.399); d = 1; }
        const push = (need - d) / 2 / d;
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
        moved = true;
      }
    }
    // Keep everything inside the screen ellipse, slightly past the edge is fine.
    pts.forEach((p) => {
      const ex = p.x / (ASPECT * opts.maxR), ey = p.y / opts.maxR;
      const e = Math.hypot(ex, ey);
      if (e > 1) { p.x /= e; p.y /= e; }
    });
    if (!moved) break;
  }
  parts.forEach((p, i) => { p.nx = pts[i].x / ASPECT; p.ny = pts[i].y; });
}

export async function initHeroMesh(canvas) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  const whiteMatcap = buildMatcap(WHITE);
  const markGeometry = buildWordGeometry();

  const material = new THREE.MeshMatcapNodeMaterial({ matcap: whiteMatcap });
  const logo = new THREE.Mesh(markGeometry, material);
  scene.add(logo);

  // Each impulse is a ripple expanding from where the pointer crossed the mesh.
  const impulsePos = Array.from({ length: IMPULSES }, () => new THREE.Vector3());
  const impulseAge = new Array(IMPULSES).fill(1e3);
  const impulseStr = new Array(IMPULSES).fill(0);

  const uPos = uniformArray(impulsePos);
  const uAge = uniformArray(impulseAge);
  const uStr = uniformArray(impulseStr);
  const uWobble = uniform(WOBBLE);

  const ripple = Fn(([p]) => {
    const sum = float(0).toVar();
    Loop({ start: int(0), end: int(IMPULSES), type: 'int' }, ({ i }) => {
      const age = uAge.element(i);
      const strength = uStr.element(i);
      const origin = uPos.element(i);

      const dist = length(p.sub(origin));
      const front = dist.sub(age.mul(0.4));          // ring travelling outwards
      const band = exp(front.mul(front).mul(-6));    // only near the ring
      const wave = cos(dist.mul(9).sub(age.mul(11)));
      const decay = exp(age.mul(-2.6));

      sum.addAssign(wave.mul(band).mul(decay).mul(strength));
    });
    return sum;
  });

  /*
   * A flat extrusion gives every front-facing pixel the same normal, so without
   * this the face would shade as one dead slab. The swell keeps the letters
   * alive, and uMelt drives it up into a full boil just before they come apart.
   */
  const uTime = uniform(0);
  const uMelt = uniform(0);
  const swell = (p) => sin(p.x.mul(2.6).add(uTime.mul(0.8)))
    .mul(sin(p.y.mul(2.2).sub(uTime.mul(0.6))))
    .mul(float(SWELL).mul(uMelt.mul(7).add(1)));

  const displace = (p) => ripple(p).mul(uWobble).add(swell(p));
  const radial = normalize(positionGeometry);
  material.positionNode = positionLocal.add(radial.mul(displace(positionGeometry)));

  // The displacement happens on the GPU, so re-derive normals from its gradient.
  material.normalNode = Fn(() => {
    const p = positionGeometry;
    const dx = displace(p.add(vec3(EPS, 0, 0))).sub(displace(p.add(vec3(-EPS, 0, 0))));
    const dy = displace(p.add(vec3(0, EPS, 0))).sub(displace(p.add(vec3(0, -EPS, 0))));
    const dz = displace(p.add(vec3(0, 0, EPS))).sub(displace(p.add(vec3(0, 0, -EPS))));
    const gradient = vec3(dx, dy, dz).mul(float(1 / (2 * EPS)));
    return transformNormalToView(normalize(normalLocal.sub(gradient.mul(0.7))));
  })();

  /* ---------------------------------------------------------------- *
   * The burst: memecoins and sparks.
   * ---------------------------------------------------------------- */
  const coinGeometry = buildCoinGeometry();
  const faceGeometry = new THREE.CircleGeometry(COIN_R * 0.995, 56);
  const faceMatcap = buildMatcap(FACE);
  const loader = new THREE.TextureLoader();

  /*
   * A coin is a blank in the token's own colour with its artwork on the face.
   * Texturing the cylinder's own cap would be one mesh fewer, but those UVs are
   * wound around the axis and come out transposed; a circle carries a plain
   * planar mapping instead. The reverse stays blank — coins only ever lean a
   * little out of the camera plane, so it is never in shot.
   */
  /* The roster is shorter than the burst, so each token's pair is made once. */
  const dressing = new Map();

  function materialsFor(token) {
    let pair = dressing.get(token.id);
    if (pair) return pair;

    const texture = loader.load(token.image);
    texture.colorSpace = THREE.SRGBColorSpace;

    pair = [
      new THREE.MeshMatcapNodeMaterial({
        matcap: buildMatcap(brandPalette(token.color)), transparent: true,
      }),
      new THREE.MeshMatcapNodeMaterial({
        matcap: faceMatcap, map: texture, transparent: true,
      }),
    ];
    dressing.set(token.id, pair);
    return pair;
  }

  function buildCoin(token) {
    const [rim, face] = materialsFor(token);

    const front = new THREE.Mesh(faceGeometry, face);
    front.position.z = COIN_T / 2 + 0.002;

    const coin = new THREE.Group();
    coin.add(new THREE.Mesh(coinGeometry, rim), front);
    // Coins are placed far outside the geometry's own bounds.
    coin.children.forEach((part) => { part.frustumCulled = false; });
    coin.userData.materials = [rim, face];
    return coin;
  }

  // Repeat the roster until every slot in the burst is filled.
  const coins = Array.from({ length: COINS }, (_, i) => buildCoin(TOKENS[i % TOKENS.length]));

  const sparkGeometry = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  const sparkMat = (palette) => new THREE.MeshMatcapNodeMaterial({
    matcap: buildMatcap(palette), transparent: true,
  });
  const upSparks = new THREE.InstancedMesh(sparkGeometry, sparkMat(UP), SPARKS / 2);
  const downSparks = new THREE.InstancedMesh(sparkGeometry, sparkMat(DOWN), SPARKS / 2);

  const swarm = [...coins, upSparks, downSparks];
  swarm.forEach((mesh) => {
    // Pieces are placed far outside the base geometry's bounds.
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
  });

  /* Every material in the burst fades together at the end of the scroll. */
  const fading = new Set();
  swarm.forEach((mesh) => {
    (mesh.userData.materials ?? [mesh.material]).forEach((m) => fading.add(m));
  });

  /* From just off the centre out to the edge: a field across the whole screen, densest in the middle. */
  const coinPlan = layout(COINS, 29, { minR: 0.18, maxR: 1.12, depth: 1.2, minScale: 0.60, maxScale: 1.00, separate: true, padding: 1.2 });
  const upPlan = layout(SPARKS / 2, 47, { minR: 0.24, maxR: 1.10, depth: 1.8, minScale: 0.4, maxScale: 1.2 });
  const downPlan = layout(SPARKS / 2, 83, { minR: 0.24, maxR: 1.10, depth: 1.8, minScale: 0.4, maxScale: 1.2 });

  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scl = new THREE.Vector3();

  let visibleHeight = MARK_H / 0.3;

  function placeSwarm(progress, elapsed) {
    const burst = range(progress, BURST);
    const drift = range(progress, [BURST[1], 1]);
    const opacity = 1 - range(progress, FADE);
    const live = burst > 0.001 && opacity > 0.001;

    swarm.forEach((mesh) => { mesh.visible = live; });
    fading.forEach((m) => { m.opacity = opacity; });
    if (!live) return;

    const halfH = visibleHeight / 2;
    const halfW = halfH * camera.aspect;
    const baseY = logo.position.y;
    const spread = 1 + drift * 0.24;
    const rise = drift * halfH * 0.12;

    /* Staggered starts, but every piece still lands as the window closes. */
    const place = (part) => {
      const t = clamp01((burst - part.delay * 0.45) / (1 - part.delay * 0.45));
      const reach = easeOut(t) * spread;
      const wander = t * 0.09;

      pos.set(
        part.nx * halfW * reach
          + Math.sin(elapsed * part.bob + part.phase) * wander,
        baseY + part.ny * halfH * reach
          + Math.cos(elapsed * part.bob * 0.8 + part.phase) * wander + rise * t,
        part.z * reach,
      );
      scl.setScalar(Math.max(0, part.scale * easeOutBack(t)));
      return t;
    };

    coins.forEach((coin, i) => {
      const part = coinPlan[i];
      place(part);
      /*
       * Coins rock rather than tumble. A full turn would carry the ticker
       * upside down half the time, and reading them is the point.
       */
      euler.set(
        Math.sin(elapsed * part.bob * 0.7 + part.phase) * part.tilt,
        Math.cos(elapsed * part.bob * 0.5 + part.phase) * part.tilt,
        part.roll + Math.sin(elapsed * part.bob * 0.6 + part.phase) * 0.3,
      );
      coin.position.copy(pos);
      coin.quaternion.setFromEuler(euler);
      coin.scale.copy(scl);
    });

    const writeSparks = (mesh, parts) => {
      parts.forEach((part, i) => {
        const t = place(part);
        quat.setFromAxisAngle(part.axis, elapsed * part.spin * 2 + part.phase);
        scl.multiplyScalar(0.9 + Math.sin(elapsed * 3 + part.phase) * 0.1 * t);
        mtx.compose(pos, quat, scl);
        mesh.setMatrixAt(i, mtx);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };

    writeSparks(upSparks, upPlan);
    writeSparks(downSparks, downPlan);
  }

  /* ---------------------------------------------------------------- *
   * Pointer ripples
   * ---------------------------------------------------------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let lastPoint = null;
  let lastSpawn = 0;

  function spawn(point, strength) {
    // Recycle the oldest ripple.
    let slot = 0;
    for (let i = 1; i < IMPULSES; i++) {
      if (impulseAge[i] > impulseAge[slot]) slot = i;
    }
    impulsePos[slot].copy(point);
    impulseAge[slot] = 0;
    impulseStr[slot] = strength;
  }

  function onPointerMove(event) {
    if (!logo.visible) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hit = raycaster.intersectObject(logo, false)[0];
    if (!hit) { lastPoint = null; return; }

    const now = performance.now();
    if (now - lastSpawn < 30) return;

    const local = logo.worldToLocal(hit.point.clone());
    const speed = lastPoint ? local.distanceTo(lastPoint) : 0.05;
    spawn(local, THREE.MathUtils.clamp(speed * 8, 0.4, 0.8));

    lastSpawn = now;
    lastPoint = local.clone();
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;

    const aspect = w / h;

    // A wordmark is width-bound...
    let visibleWidth = MARK_W / MARK_SHARE;
    visibleHeight = visibleWidth / aspect;

    // ...unless the frame is tall enough that the word starts to look lost in
    // it, in which case cap the vertical room and re-derive the width.
    const roomiest = MARK_H / 0.16;
    if (visibleHeight > roomiest) {
      visibleHeight = roomiest;
      visibleWidth = visibleHeight * aspect;
    }

    // On a phone that cap would pull the frame in tighter than the word itself,
    // so it can never crop: the word gets the width it needs and no less.
    const tightest = MARK_W / 0.86;
    if (visibleWidth < tightest) {
      visibleWidth = tightest;
      visibleHeight = visibleWidth / aspect;
    }

    camera.aspect = aspect;
    camera.position.z = visibleHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    camera.updateProjectionMatrix();

    logo.position.y = (0.5 - MARK_CENTRE) * visibleHeight;

    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);

  const timer = new THREE.Timer();
  let running = false;
  let elapsed = 0;
  let progress = 0;
  let target = 0;

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);

    const dt = Math.min(timer.update().getDelta(), 0.05);
    elapsed += dt;
    for (let i = 0; i < IMPULSES; i++) impulseAge[i] += dt;
    uTime.value = elapsed;

    // Chase the scroll rather than snap to it: the burst reads as motion, not as
    // a slider being dragged.
    progress += (target - progress) * (1 - Math.exp(-dt * 7));

    const melt = range(progress, MELT);
    const scale = 1 - easeInOut(melt);
    uMelt.value = melt;
    logo.visible = scale > 0.002;
    logo.scale.setScalar(Math.max(0.002, scale));

    // A sway rather than a spin: the word has to stay readable. Once it starts
    // melting it whirls away instead.
    logo.rotation.y = Math.sin(elapsed * 0.32) * 0.2 + melt * Math.PI * 1.1;
    logo.rotation.x = Math.sin(elapsed * 0.24) * 0.1;
    logo.rotation.z = melt * 0.6;

    placeSwarm(progress, elapsed);

    renderer.render(scene, camera);
  }

  function resume() {
    if (running) return;
    running = true;
    timer.update();
    frame();
  }

  await renderer.init();
  resize();
  resume();

  return {
    pause: () => { running = false; },
    resume,
    setProgress: (p) => { target = clamp01(p); },
  };
}
