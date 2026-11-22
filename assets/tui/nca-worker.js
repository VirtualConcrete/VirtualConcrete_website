// Runs the nca/ page's neural cellular automaton off the main thread: the title repairs itself
// where a visitor has erased it. The weights come from nca/train.py, outside the site.
//
// Every LED is a cell of CHANNELS numbers; channel 0 is its light, lit above 0.5, the rest
// are hidden. At each step a random half of the cells update from their 3x3 neighbourhood,
// with the same arithmetic as NCA.step in train.py. Outside the panel is zero.
//
// In:  { type: 'init', target, width, height }   target: the title, width x height bytes
//      { type: 'erase', points: [x, y, ...], radius }   in LEDs, from the top left corner
// Out: { lit }   the lit LEDs, after an erase and after every step until it settles
import { NCA } from './nca-weights.js';

const STEPS_PER_SECOND = 30; // at most: a step takes ~17 ms on a recent laptop
const SETTLED_STEPS = 90; // the LEDs unchanged this long: stop until the next erase
const MAX_STEPS = 3000; // and stop this long after an erase anyway

const C = NCA.channels, HIDDEN = NCA.hidden, SEEN = 3 * C; // channels: a multiple of 4, for step()

function floats(base64) {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  return new Float32Array(bytes.buffer); // little-endian, like every browser's platform
}
const w1 = floats(NCA.w1), b1 = floats(NCA.b1), w2 = floats(NCA.w2);
// w2 transposed, hidden x channels, to add up only the hidden units that are on
const w2t = new Float32Array(HIDDEN * C);
for (let c = 0; c < C; c++) for (let j = 0; j < HIDDEN; j++) w2t[j * C + c] = w2[c * HIDDEN + j];

// State with a border of zero cells, so neighbours never need a bounds check
let W, H, ROW, target, state, next, lit;
let steps = 0, quiet = 0, timer = null;
const cell = (x, y) => ((y + 1) * (W + 2) + x + 1) * C;

function reset() {
  clearTimeout(timer);
  timer = null;
  state = new Float32Array((W + 2) * (H + 2) * C);
  next = new Float32Array(state.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) state[cell(x, y)] = target[y * W + x];
  lit = Uint8Array.from(target);
}

const seen = new Float32Array(SEEN), dx = new Float32Array(C);

function step() {
  // locals, and four running sums: about twice as fast in V8
  const s = state, nx = next, W1 = w1, B1 = b1, W2T = w2t, fire = NCA.fireRate;
  nx.set(s);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.random() >= fire) continue;
      const o = cell(x, y);
      for (let c = 0, i = o, k = 0; c < C; c++, i++, k += 3) {
        const nw = s[i - ROW - C], n = s[i - ROW], ne = s[i - ROW + C];
        const w = s[i - C], e = s[i + C];
        const sw = s[i + ROW - C], so = s[i + ROW], se = s[i + ROW + C];
        seen[k] = s[i];
        seen[k + 1] = (ne - nw + 2 * (e - w) + se - sw) / 8;
        seen[k + 2] = (sw - nw + 2 * (so - n) + se - ne) / 8;
      }
      dx.fill(0);
      for (let j = 0, r = 0; j < HIDDEN; j++) {
        let a0 = B1[j], a1 = 0, a2 = 0, a3 = 0;
        for (let k = 0; k < SEEN; k += 4, r += 4) {
          a0 += W1[r] * seen[k];
          a1 += W1[r + 1] * seen[k + 1];
          a2 += W1[r + 2] * seen[k + 2];
          a3 += W1[r + 3] * seen[k + 3];
        }
        const a = a0 + a1 + a2 + a3;
        if (a <= 0) continue;
        for (let c = 0, t = j * C; c < C; c++, t++) dx[c] += W2T[t] * a;
      }
      for (let c = 0; c < C; c++) nx[o + c] = s[o + c] + dx[c];
    }
  }
  [state, next] = [next, state];
}

/** Reads the lights off the state; true if any changed. */
function readLit() {
  let changed = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const on = state[cell(x, y)] > 0.5 ? 1 : 0;
      if (on !== lit[y * W + x]) changed = true;
      lit[y * W + x] = on;
    }
  }
  return changed;
}

const send = () => postMessage({ lit: lit.slice() });

function run() {
  const began = performance.now();
  step();
  steps++;
  quiet = readLit() ? 0 : quiet + 1;
  send();
  timer = quiet < SETTLED_STEPS && steps < MAX_STEPS
    ? setTimeout(run, Math.max(0, 1000 / STEPS_PER_SECOND - (performance.now() - began)))
    : null;
}

function erase(points, radius) {
  const r2 = radius * radius;
  for (let p = 0; p < points.length; p += 2) {
    const px = points[p], py = points[p + 1];
    const x0 = Math.max(0, Math.floor(px - radius)), x1 = Math.min(W - 1, Math.ceil(px + radius));
    const y0 = Math.max(0, Math.floor(py - radius)), y1 = Math.min(H - 1, Math.ceil(py + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 <= r2) state.fill(0, cell(x, y), cell(x, y) + C);
      }
    }
  }
  readLit();
  send();
  steps = 0;
  quiet = 0;
  timer ??= setTimeout(run, 1000 / STEPS_PER_SECOND);
}

onmessage = ({ data }) => {
  if (data.type === 'init') {
    ({ width: W, height: H, target } = data);
    ROW = (W + 2) * C;
    reset();
  } else if (data.type === 'erase') {
    erase(data.points, data.radius);
  }
};
