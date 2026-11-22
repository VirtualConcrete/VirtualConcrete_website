// The nca/ page: the panel types the title once, then dragging over it erases LEDs and a
// neural cellular automaton in a worker grows them back. It was trained on this title
// (nca/train.py, outside the site): retrain it if the title changes.
import { scrollback, CURSOR_BLINK_MS, WIDTH, HEIGHT } from './terminal.js';
import { createPanel, typeText, still } from './panel.js';

const ERASE_RADIUS = 3; // LEDs

const text = document.getElementById('screen-text').textContent.trim();
const { view } = scrollback(text);
const panel = createPanel(document.getElementById('screen'));
const canvas = panel.canvas;
const typing = typeText(panel, text);

const title = view(0, false);
const cursorBlock = view(0, true).map((on, i) => on & !title[i]);
const nca = new Worker(new URL('./nca-worker.js', import.meta.url), { type: 'module' });
nca.postMessage({ type: 'init', target: title, width: WIDTH, height: HEIGHT });
let healing = null; // the automaton's lit LEDs, once something is erased
nca.onmessage = ({ data }) => { healing = data.lit; };

let lastLed = null; // where the stroke being drawn has got to, in LEDs
const canErase = () => !still && typing.done && panel.layout;

function eraseTo(e) {
  const { scale, left, top } = panel.layout;
  const box = canvas.getBoundingClientRect();
  const dpr = canvas.width / box.width;
  const x = ((e.clientX - box.left) * dpr - left) / scale;
  const y = ((e.clientY - box.top) * dpr - top) / scale;
  const [x0, y0] = lastLed ?? [x, y];
  const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0))); // a point every LED
  const points = [];
  for (let i = 1; i <= n; i++) points.push(x0 + ((x - x0) * i) / n, y0 + ((y - y0) * i) / n);
  lastLed = [x, y];
  nca.postMessage({ type: 'erase', points, radius: ERASE_RADIUS });
}

// Fingers too: nothing on this page scrolls
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !canErase()) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  lastLed = null;
  eraseTo(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (lastLed && canvas.hasPointerCapture(e.pointerId) && canErase()) eraseTo(e);
});
canvas.addEventListener('pointerup', () => { lastLed = null; });
canvas.addEventListener('pointercancel', () => { lastLed = null; });

let blinkStart = null, shownCursor = null, healingShown = null;

function showHealing(now) {
  blinkStart ??= now;
  const cursorOn = still || Math.floor((now - blinkStart) / CURSOR_BLINK_MS) % 2 === 0;
  if (cursorOn === shownCursor && healing === healingShown) return;
  shownCursor = cursorOn;
  healingShown = healing;
  panel.show(healing ? healing.map((on, i) => on | (cursorOn & cursorBlock[i])) : view(0, cursorOn));
}

function tick() {
  const now = performance.now();
  typing.tick(now);
  if (typing.done) showHealing(now);
  requestAnimationFrame(tick);
}

tick();
