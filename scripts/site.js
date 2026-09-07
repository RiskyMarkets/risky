/* Page orchestration: shared mark, scroll reveals, and the hero burst. */

import { buildRiskyMark } from './risky-mark.js';
import { initCurveScene } from './curve-scene.js';
import { initFeatures } from './features.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/* ------------------------------------------------------------------ *
 * Reveal on entry.
 * ------------------------------------------------------------------ */
/*
 * A sweep rather than an IntersectionObserver: an observer only reports when the
 * intersection state changes, so a fast scroll or an anchor jump can carry an
 * element in and back out between callbacks and leave it invisible for good.
 * The pending set empties quickly, and the listener detaches with it.
 */
function initReveals() {
  const pending = new Set(document.querySelectorAll('[data-reveal]'));
  if (!pending.size) return;

  let queued = false;

  function sweep() {
    queued = false;
    const limit = window.innerHeight * 0.9;

    pending.forEach((target) => {
      if (target.getBoundingClientRect().top > limit) return;
      target.classList.add('is-visible');
      pending.delete(target);
    });

    if (!pending.size) {
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
    }
  }

  function request() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sweep);
  }

  sweep();
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
}

/*
 * The hero canvas is fixed, so the word stays put while the page scrolls past
 * it. Scroll position becomes the progress of the burst; the mesh smooths it
 * out and does the rest, and the first section rides up over whatever is left.
 */
function initHeroScroll(mesh) {
  const hero = document.getElementById('hero');
  const stage = document.getElementById('heroStage');
  const root = document.documentElement;
  if (!hero || !stage) return;

  let queued = false;
  let hidden = false;

  function apply() {
    queued = false;
    // Progress reaches 1 exactly as the first section finishes covering the stage.
    const progress = clamp(window.scrollY / Math.max(1, hero.offsetHeight), 0, 1);

    if (mesh) mesh.setProgress(progress);
    root.style.setProperty('--hero-fade', clamp(1 - (progress - 0.9) / 0.1, 0, 1).toFixed(3));

    const cta = document.getElementById('heroCta');
    if (cta) {
      // After the burst has played out, not during it.
      const show = clamp((progress - 0.48) / 0.10, 0, 1);
      const hide = clamp((progress - 0.86) / 0.10, 0, 1);
      const visible = show * (1 - hide);
      cta.style.opacity = visible.toFixed(3);
      cta.style.transform = `translate(-50%, -50%) scale(${(0.92 + visible * 0.08).toFixed(3)})`;
      cta.style.pointerEvents = visible > 0.4 ? 'auto' : 'none';
    }

    // The top bar takes over from the centre button once the burst has played out.
    const bar = document.getElementById('topbar');
    if (bar) {
      const on = progress >= 0.86;
      bar.classList.toggle('is-visible', on);
      bar.setAttribute('aria-hidden', on ? 'false' : 'true');
    }

    // Once it is fully covered there is nothing to composite or render.
    const done = progress >= 1;
    if (done !== hidden) {
      hidden = done;
      stage.style.visibility = done ? 'hidden' : '';
      if (mesh) done ? mesh.pause() : mesh.resume();
    }
  }

  apply();
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }, { passive: true });
  window.addEventListener('resize', apply);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
gsap.registerPlugin(MotionPathPlugin);

buildRiskyMark();
initReveals();
initCurveScene();
initFeatures();

/*
 * WebGPU is loaded on its own so an unsupported browser costs us the hero
 * mesh and nothing else. The page still reads and scrolls without it.
 */
const canvas = document.getElementById('heroCanvas');
const loader = document.getElementById('heroLoader');

import('./hero-mesh.js')
  .then(({ initHeroMesh }) => initHeroMesh(canvas))
  .then((mesh) => {
    initHeroScroll(mesh);
    loader.classList.add('is-done');
    setTimeout(() => loader.remove(), 600);
  })
  .catch((error) => {
    console.warn('Hero mesh unavailable:', error);
    canvas.remove();
    loader.remove();
    initHeroScroll(null);
  });
