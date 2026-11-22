// A one-dimensional cellular automaton behind the hero's text. Each generation enters at
// the top of the screen and pushes the older ones down. It starts from one lit cell in the
// middle, and the row wraps around at the edges.
import { WIDTH, HEIGHT } from './terminal.js';

// The knobs
export const CA = {
  rule: 30, // Wolfram's number: 30, 90, 110...
  generationMs: 80, // one row down every
  margin: 1, // LEDs kept dark around the text, so it stays readable
};

export const CA_LED = 2; // its LEDs in a frame; the text's are 1

const KEEP = 2 * HEIGHT; // generations remembered: the screen, and what scrolls up into it

export function createAutomaton() {
  const generations = Array.from({ length: KEEP }, () => new Uint8Array(WIDTH)); // newest first
  generations[0][WIDTH >> 1] = 1;
  let last = null;

  function grow() {
    const previous = generations[0];
    const next = generations.pop();
    for (let x = 0; x < WIDTH; x++) {
      const left = previous[(x + WIDTH - 1) % WIDTH], right = previous[(x + 1) % WIDTH];
      next[x] = (CA.rule >> ((left << 2) | (previous[x] << 1) | right)) & 1;
    }
    generations.unshift(next);
  }

  function nearText(text, x, y) {
    for (let dy = -CA.margin; dy <= CA.margin; dy++) {
      for (let dx = -CA.margin; dx <= CA.margin; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && text[ny * WIDTH + nx]) return true;
      }
    }
    return false;
  }

  return {
    /** Grows the generations that are due by now. True if there is a new one. */
    tick(now) {
      if (last === null || now - last > 10 * CA.generationMs) last = now; // also back from a hidden tab
      let grew = false;
      while (now - last >= CA.generationMs) {
        grow();
        last += CA.generationMs;
        grew = true;
      }
      return grew;
    },
    /** Grows n generations at once. */
    fill(n) {
      for (let i = 0; i < n; i++) grow();
    },
    /**
     * The text frame with the automaton lit, as CA_LED, in its top `rows` rows, away from the
     * text. step: how many LEDs the screen has scrolled up, the automaton with it.
     */
    over(text, step, rows) {
      const frame = text.slice();
      for (let y = 0; y < Math.min(rows, HEIGHT); y++) {
        const generation = generations[y + step];
        if (!generation) break;
        for (let x = 0; x < WIDTH; x++) {
          if (generation[x] && !nearText(text, x, y)) frame[y * WIDTH + x] = CA_LED;
        }
      }
      return frame;
    },
  };
}
