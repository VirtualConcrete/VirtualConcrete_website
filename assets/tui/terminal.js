// Port of the auto_text firmware (src/main.cpp) for the 128x64 HUB75 panel:
// same font, layout, word wrap, hyphenation, scroll and cursor. Differences: the
// firmware shows a word at a time, here it is typed letter by letter; and the firmware
// starts over, here the text is typed once and can then be scrolled, see scrollback(),
// to a second text in a smaller font.
// Names and structure follow main.cpp so the two are easy to keep in step.
//
// There is no DOM and no timer here: terminal() yields the frames the panel would show,
// each with the millisecond at which it appears.
import { FONT } from './font.js';
import { FONT as FONT_SMALL } from './font-8x16.js';

export const WIDTH = 128;
export const HEIGHT = 64;

// Look
const LINE_HEIGHT_TYPED = 21;
const LINE_HEIGHT_SCROLLED = 16;
const BLANK_LINE_BETWEEN_PARAGRAPHS = true;

// Timing, ms
const THINK_MS = 1500;
const LETTER_MIN_MS = 30; // between keystrokes: letters, spaces, hyphens, line breaks
const LETTER_MAX_MS = 140;
const STALL_PERCENT = 7;
const STALL_MIN_MS = 350;
const STALL_MAX_MS = 1000;
const CLAUSE_PAUSE_MS = 120;
const SENTENCE_PAUSE_MS = 400;
const SCROLL_MS = 180;
export const CURSOR_BLINK_MS = 530;
const FLIP_SETTLE_MS = 20;

const MIN_SPLIT = 3;
const MAX_WORD = 64;

// Layout, derived from the font
function layoutFor(FONT, LINE_HEIGHT) {
  const INK_WIDTH = FONT.inkRight - FONT.inkLeft + 1;
  const INK_HEIGHT = FONT.inkBottom - FONT.inkTop + 1;
  const CAP_HEIGHT = FONT.capBottom - FONT.capTop + 1;
  const COLS = Math.floor((WIDTH - INK_WIDTH) / FONT.width) + 1;
  const ROWS = Math.floor((HEIGHT - INK_HEIGHT) / LINE_HEIGHT) + 1;
  const ORIGIN_X = Math.trunc((WIDTH - ((COLS - 1) * FONT.width + INK_WIDTH)) / 2) - FONT.inkLeft;
  const ORIGIN_Y = Math.trunc((HEIGHT - ((ROWS - 1) * LINE_HEIGHT + CAP_HEIGHT)) / 2) - FONT.capTop;

  const digits = Math.ceil(FONT.width / 4);
  const glyphs = new Map(Object.entries(FONT.glyphs).map(([cp, hex]) => [
    Number(cp),
    Array.from({ length: FONT.height }, (_, r) => parseInt(hex.substr(r * digits, digits), 16)),
  ]));
  const glyphFor = (cp) => glyphs.get(cp) ?? glyphs.get(0x3f); // '?'

  return {
    FONT, LINE_HEIGHT, INK_WIDTH, CAP_HEIGHT, COLS, ROWS, ORIGIN_X, ORIGIN_Y,
    glyphFor, SPACE: glyphFor(0x20), HYPHEN: glyphFor(0x2d),
  };
}

const TYPED = layoutFor(FONT, LINE_HEIGHT_TYPED); // as on the panel
const SCROLLED = layoutFor(FONT_SMALL, LINE_HEIGHT_SCROLLED);

const CLOSING_MARKS = new Set(['"', "'", ')', ']', '’', '”', '»']);

function* readWords(text, glyphFor) {
  let glyphs = [], last = '', newParagraph = false, continuation = false;

  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0) break;
    if (cp === 0xfeff || cp === 0xad) continue; // invisible, and not a word break

    if (cp <= 0x20 || cp === 0x7f) {
      if (glyphs.length) {
        yield { glyphs, last, newParagraph, continuation };
        glyphs = []; last = ''; newParagraph = false;
      }
      continuation = false;
      if (ch === '\n') newParagraph = true;
      continue;
    }
    if (glyphs.length === MAX_WORD) {
      yield { glyphs, last, newParagraph, continuation };
      glyphs = []; last = ''; newParagraph = false; continuation = true;
    }
    glyphs.push(glyphFor(cp));
    if (!CLOSING_MARKS.has(ch)) last = ch;
  }
  if (glyphs.length) yield { glyphs, last, newParagraph, continuation };
}

const defaultRandom = (n) => Math.floor(Math.random() * n);

/** Lights lines, moved up by scrollPx whole LEDs, and the cursor if given, in WIDTH x HEIGHT bytes. */
function paint(layout, lines, scrollPx, cursor, pixels = new Uint8Array(WIDTH * HEIGHT)) {
  const { FONT, LINE_HEIGHT, INK_WIDTH, CAP_HEIGHT, COLS, ORIGIN_X, ORIGIN_Y } = layout;
  const set = (x, y) => {
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) pixels[y * WIDTH + x] = 1;
  };

  lines.forEach((line, r) => {
    const y = ORIGIN_Y + r * LINE_HEIGHT - scrollPx;
    line.forEach((glyph, c) => {
      const x = ORIGIN_X + c * FONT.width;
      glyph.forEach((bits, gy) => {
        for (let gx = 0; gx < FONT.width; gx++) {
          if (bits & (1 << (FONT.width - 1 - gx))) set(x + gx, y + gy);
        }
      });
    });
  });

  if (cursor && cursor.col < COLS) {
    const x = ORIGIN_X + cursor.col * FONT.width + FONT.inkLeft;
    const y = ORIGIN_Y + cursor.row * LINE_HEIGHT - scrollPx + FONT.capTop;
    for (let dy = 0; dy < CAP_HEIGHT; dy++) {
      for (let dx = 0; dx < INK_WIDTH; dx++) set(x + dx, y + dy);
    }
  }
  return pixels;
}

/**
 * Types the text once, as { at, phase, pixels } frames; phase is 'think', 'type' or 'scroll'.
 * Returns { lines, cursor }: everything typed, including what scrolled off.
 * random(n) returns an integer in 0..n-1, like Arduino's.
 */
export function* terminal(text, random = defaultRandom, layout = TYPED) {
  const { LINE_HEIGHT, COLS, ROWS, glyphFor, SPACE, HYPHEN } = layout;
  const lines = Array.from({ length: ROWS + 1 }, () => []);
  const above = []; // lines that scrolled off
  let cursorRow = 0, cursorCol = 0;
  let now = 0, lastFlip = -FLIP_SETTLE_MS;

  function render(phase, scrollPx, cursorOn) {
    now = Math.max(now, lastFlip + FLIP_SETTLE_MS);
    const rowsToDraw = scrollPx > 0 ? ROWS + 1 : ROWS;
    const cursor = cursorOn ? { row: cursorRow, col: cursorCol } : null;
    const pixels = paint(layout, lines.slice(0, rowsToDraw), scrollPx, cursor);
    lastFlip = now;
    return { at: now, phase, pixels };
  }

  function* holdBlinking(phase, ms) {
    const start = now;
    let on = true;
    for (;;) {
      const elapsed = now - start;
      if (elapsed >= ms) return;
      yield render(phase, 0, on);
      now += Math.min(CURSOR_BLINK_MS, ms - elapsed);
      on = !on;
    }
  }

  function* newLine() {
    if (cursorRow + 1 < ROWS) {
      cursorRow++;
      cursorCol = 0;
      lines[cursorRow] = [];
      yield* keystroke();
      return;
    }
    lines[ROWS] = [];
    cursorRow = ROWS;
    cursorCol = 0;

    const start = now;
    for (;;) {
      const elapsed = now - start;
      if (elapsed >= SCROLL_MS) break;
      // fround: the firmware does this in single precision
      let t = Math.fround(elapsed / SCROLL_MS);
      t = Math.fround(Math.fround(t * t) * Math.fround(3 - Math.fround(2 * t)));
      const px = Math.trunc(Math.fround(Math.fround(t * LINE_HEIGHT) + 0.5));
      yield render('scroll', Math.max(1, px), true);
    }
    above.push(lines[0]);
    for (let r = 0; r < ROWS; r++) lines[r] = lines[r + 1].slice();
    cursorRow = ROWS - 1;
    yield* keystroke();
  }

  function* keystroke() {
    yield render('type', 0, true);
    now += LETTER_MIN_MS + random(LETTER_MAX_MS + 1 - LETTER_MIN_MS);
  }

  function* type(glyph) {
    lines[cursorRow][cursorCol++] = glyph;
    yield* keystroke();
  }

  function* placeWord(word) {
    const { glyphs, continuation } = word;
    let next = 0;
    let space = cursorCol > 0 && !continuation;

    for (;;) {
      const remaining = glyphs.length - next;
      const room = COLS - cursorCol - (space ? 1 : 0);

      if (remaining <= room) {
        if (space) yield* type(SPACE);
        while (next < glyphs.length) yield* type(glyphs[next++]);
        return;
      }
      if (remaining <= COLS) { // ordinary word wrap
        yield* newLine();
        space = false;
        continue;
      }
      // too long for any line: hyphenate, without leaving a stub
      let head = Math.min(room - 1, remaining - MIN_SPLIT);
      if (head < MIN_SPLIT && cursorCol > 0) {
        yield* newLine();
        space = false;
        continue;
      }
      head = Math.max(head, 1);
      if (space) yield* type(SPACE);
      for (let i = 0; i < head; i++) yield* type(glyphs[next++]);
      yield* type(HYPHEN);
      yield* newLine();
      space = false;
    }
  }

  // hesitation after a word, on top of the last keystroke's delay
  function wordPause({ last }) {
    let ms = 0;
    if (random(100) < STALL_PERCENT) ms += STALL_MIN_MS + random(STALL_MAX_MS + 1 - STALL_MIN_MS);
    if (['.', '!', '?', '…'].includes(last)) ms += SENTENCE_PAUSE_MS;
    else if ([',', ';', ':', '—'].includes(last)) ms += CLAUSE_PAUSE_MS;
    return ms;
  }

  yield* holdBlinking('think', THINK_MS);

  let count = 0;
  for (const word of readWords(text, glyphFor)) {
    if (word.newParagraph && count > 0) {
      yield* newLine();
      if (BLANK_LINE_BETWEEN_PARAGRAPHS) yield* newLine();
    }
    yield* placeWord(word);
    count++;
    now += wordPause(word);
  }

  return {
    lines: [...above, ...lines.slice(0, cursorRow + 1)],
    cursor: { row: above.length + cursorRow, col: cursorCol },
  };
}

// what typing the text leaves behind, so that it wraps just the same
function typed(text, layout) {
  const frames = terminal(text, () => 0, layout);
  for (;;) {
    const { done, value } = frames.next();
    if (done) return value;
  }
}

/**
 * The screen as text leaves it, with next, if given, a blank line below it, in the smaller font.
 * steps is how many LEDs it scrolls; view(step, cursorOn) is the screen that many LEDs along.
 */
export function scrollback(text, next = '') {
  const { lines: all, cursor } = typed(text, TYPED);
  const offScreen = Math.max(0, all.length - TYPED.ROWS);
  const lines = all.slice(offScreen);
  const end = { row: cursor.row - offScreen, col: cursor.col };
  const nextLines = typed(next, SCROLLED).lines;

  // The step at which next has the screen to itself. Until then it is that many LEDs lower.
  const gap = BLANK_LINE_BETWEEN_PARAGRAPHS ? 1 : 0;
  const nextAt = (TYPED.ROWS + gap) * TYPED.LINE_HEIGHT;

  // Where the title's black ends, in LEDs at step 0: halfway between its last line and next
  const titleBottom = TYPED.ORIGIN_Y + TYPED.FONT.capTop + (TYPED.ROWS - 1) * TYPED.LINE_HEIGHT + TYPED.CAP_HEIGHT;
  const nextTop = nextAt + SCROLLED.ORIGIN_Y + SCROLLED.FONT.capTop;

  return {
    cover: Math.round((titleBottom + nextTop) / 2),
    steps: nextAt + Math.max(0, nextLines.length - SCROLLED.ROWS) * SCROLLED.LINE_HEIGHT,
    view(step, cursorOn) {
      const pixels = paint(TYPED, lines, step, cursorOn ? end : null);
      return paint(SCROLLED, nextLines, step - nextAt, null, pixels);
    },
  };
}
