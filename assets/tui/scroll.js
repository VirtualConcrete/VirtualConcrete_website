// Turns page scrolling into whole LEDs. The hero is pinned for as long as the screen has
// something left to scroll, so only the text moves, never the LEDs; then the page goes on.
//
// A wheel notch or an arrow key is one LED, and so is each event from a trackpad. Touch,
// scrollbar and Page Down keep scrolling natively, rounded to the LED.

const STEP_PX = 12; // page px per LED
const MIN_WHEEL_PX = 4; // smaller wheel movements add up until they make a step
const SETTLE_MS = 600; // how long native scrolling can carry on after a wheel event or key

/** track is the element around the pinned hero, steps the number of LEDs to scroll through. */
export function createScroll(track, steps) {
  const root = document.documentElement;
  const length = steps * STEP_PX;
  track.style.setProperty('--scroll-length', `${length}px`);

  let locked = false;
  let travel = 0;
  // Where wheel and keys left the page. Browsers don't let every wheel event be cancelled,
  // and smooth scrolling from below runs on, so whatever overshoots is put back here.
  let aim = null, settled;

  const jump = (top) => scrollTo({ top, behavior: 'instant' });

  function aimAt(top) {
    aim = top;
    clearTimeout(settled);
    settled = setTimeout(() => { aim = null; }, SETTLE_MS);
  }

  function release() {
    aim = null;
    travel = 0;
  }

  /** Moves count LEDs (-1, 0 or 1) towards direction. False: the page is to scroll as usual. */
  function steer(direction, count) {
    if (direction < 0 && scrollY > length + 1) {
      aimAt(length); // up from below, but no further than the last step
      return false;
    }
    const from = aim ?? scrollY;
    if (direction > 0 && from >= length - 1) {
      release();
      return false;
    }
    const to = Math.min(length, Math.max(0, (Math.round(from / STEP_PX) + count) * STEP_PX));
    aimAt(to);
    jump(to);
    return true;
  }

  addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.shiftKey || e.defaultPrevented) return; // zoom, sideways
    const inPixels = e.deltaMode === 0; // read first, or Firefox gives lines as pixels
    const { deltaX, deltaY } = e;
    if (!deltaY || Math.abs(deltaX) > Math.abs(deltaY)) return;

    let handled = locked;
    if (!locked) {
      const direction = Math.sign(deltaY);
      if (Math.sign(travel) !== direction) travel = 0;
      travel += deltaY;
      const enough = !inPixels || Math.abs(travel) >= MIN_WHEEL_PX;
      if (enough) travel = 0;
      handled = steer(direction, enough ? direction : 0);
    }
    if (handled && e.cancelable) e.preventDefault();
  }, { passive: false });

  addEventListener('keydown', (e) => {
    if (locked || e.defaultPrevented) return;
    const direction = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!direction || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
      release();
    } else if (steer(direction, direction)) {
      e.preventDefault();
    }
  });

  addEventListener('pointerdown', release, { passive: true });
  addEventListener('touchstart', release, { passive: true });

  addEventListener('scroll', () => {
    if (aim === null) return;
    const overshot = scrollY < aim - 1 || (aim < length && scrollY > aim + 1);
    if (overshot) jump(aim);
  }, { passive: true });

  return {
    step: () => Math.min(steps, Math.max(0, Math.round(scrollY / STEP_PX))),
    lock() {
      locked = true;
      root.classList.add('typing');
    },
    unlock() {
      if (!locked) return;
      locked = false;
      root.classList.remove('typing');
    },
  };
}
