// Runs the terminal on the hero as a simulated LED panel: types once, then scrolls.
// A cellular automaton (ca.js) runs behind the title, on the title's black only.
import { scrollback, CURSOR_BLINK_MS, WIDTH, HEIGHT } from './terminal.js';
import { createScroll } from './scroll.js';
import { createPanel, typeText, still } from './panel.js';
import { createAutomaton } from './ca.js';

const text = document.getElementById('screen-text').textContent.trim();
const textNext = document.getElementById('screen-text-next').textContent.trim();
const { steps, view, cover } = scrollback(text, textNext);
const track = document.getElementById('hero-track');
const scroll = createScroll(track, steps);

// The title's black (#hero-cover, over the video) ends at an edge that scrolls with the text.
// At step 0 the edge is at least the bottom of the hero, so the title starts on black.
const heroCover = document.getElementById('hero-cover');
const edge = (layout, canvas) => Math.max(layout.top + cover * layout.scale, canvas.height) - scroll.step() * layout.scale;

const panel = createPanel(document.getElementById('screen'), (layout, canvas) => {
  heroCover.style.height = `${Math.max(0, (100 * edge(layout, canvas)) / canvas.height)}%`;
});

const automaton = createAutomaton();
if (still) automaton.fill(HEIGHT); // a screenful at once, standing still

// The text's LEDs, as typed or scrolled; the automaton is added on top when showing them
let lettering = new Uint8Array(WIDTH * HEIGHT);
let changed = true;
const typing = typeText({ show(frame) { lettering = frame; changed = true; } }, text);
let shownStep = -1, shownCursor = false, blinkStart = 0;

function showScrolled(now) {
  const step = scroll.step();
  if (step !== shownStep) blinkStart = now; // solid while it moves
  const cursorOn = still || Math.floor((now - blinkStart) / CURSOR_BLINK_MS) % 2 === 0;
  if (step === shownStep && cursorOn === shownCursor) return;
  shownStep = step;
  shownCursor = cursorOn;
  lettering = view(step, cursorOn);
  changed = true;
}

function tick() {
  const now = performance.now();
  // a menu link, #anchor or restored position has moved the page: the typing is over
  if (scrollY > 0) typing.stop();
  typing.tick(now);
  if (typing.done) {
    scroll.unlock();
    showScrolled(now);
  }
  const inView = track.getBoundingClientRect().bottom > 0;
  const grew = inView && !still && automaton.tick(now);
  const { layout, canvas } = panel;
  if ((changed || grew) && layout) {
    const blackRows = Math.floor((edge(layout, canvas) - layout.top) / layout.scale);
    panel.show(automaton.over(lettering, scroll.step(), blackRows));
    changed = false;
  }
  requestAnimationFrame(tick);
}

if (!typing.done) scroll.lock();
tick();
