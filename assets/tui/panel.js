// The LED panel on a canvas, for the hero (screen.js) and the nca/ page (nca.js). The canvas
// is drawn at device resolution and each LED is a whole number of device pixels wide, so the
// dots are even, without moire, at any zoom or display scaling.
import { terminal, WIDTH, HEIGHT } from './terminal.js';
import { createLeds } from './leds.js';
import { createLeds2d } from './leds-2d.js';

const MARGIN_Y = 52; // CSS px kept free above and below, for the menu
const MARGIN_X = 2; // LEDs kept free on each side

// with reduced motion: no typing and no blinking
export const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Draws WIDTH x HEIGHT frames on the canvas, centred, as big as fits. beforeDraw(layout, canvas),
 * if given, runs before every draw. The canvas may be swapped for a fresh one: use panel.canvas.
 */
export function createPanel(canvas, beforeDraw) {
  let render;
  try {
    render = createLeds(canvas);
  } catch (error) {
    console.warn(error);
    // a canvas that has had a WebGL context can't give a 2D one
    const fresh = canvas.cloneNode();
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  render ??= createLeds2d(canvas);

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    render = createLeds(canvas);
    draw();
  });

  let pixels = new Uint8Array(WIDTH * HEIGHT);
  let layout = null;

  function draw() {
    if (!layout) return;
    beforeDraw?.(layout, canvas);
    render(pixels, layout);
  }

  function fit(width, height) {
    const dpr = devicePixelRatio;
    canvas.width = width;
    canvas.height = height;
    const room = height - 2 * MARGIN_Y * dpr;
    const scale = Math.max(1, Math.floor(Math.min(width / (WIDTH + 2 * MARGIN_X), room / HEIGHT)));
    layout = {
      scale,
      left: Math.floor((width - WIDTH * scale) / 2),
      top: Math.floor((height - HEIGHT * scale) / 2),
    };
    draw();
  }

  function measure(entries) {
    const dpr = devicePixelRatio;
    const box = canvas.getBoundingClientRect();
    let width = Math.round(box.width * dpr), height = Math.round(box.height * dpr);

    // The exact device-pixel size, which rounding can miss by one. Safari doesn't report it,
    // and emulators report CSS pixels there, so only trust it when it agrees.
    const exact = entries?.[0]?.devicePixelContentBoxSize?.[0];
    if (exact && Math.abs(exact.inlineSize - width) <= 2 && Math.abs(exact.blockSize - height) <= 2) {
      width = exact.inlineSize;
      height = exact.blockSize;
    }
    fit(width, height);
  }

  const observer = new ResizeObserver(measure);
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
    addEventListener('resize', () => measure()); // zoom changes devicePixelRatio
  }

  return {
    canvas,
    get layout() { return layout; },
    show(frame) {
      pixels = frame;
      draw();
    },
    redraw: draw,
  };
}

/** Types text on the panel once, as the firmware would: call tick() every frame until done. */
export function typeText(panel, text) {
  const frames = terminal(text);
  let next = still ? null : frames.next().value; // null once the text is all there
  let origin = performance.now();

  return {
    get done() { return !next; },
    stop() { next = null; },
    tick(now) {
      if (!next) return;
      if (now - origin - next.at > 250) origin = now - next.at; // back from a hidden tab: don't fast-forward
      let frame = null;
      while (next && next.at <= now - origin) {
        frame = next.pixels;
        const { done, value } = frames.next();
        next = done ? null : value;
      }
      if (frame) panel.show(frame);
    },
  };
}
