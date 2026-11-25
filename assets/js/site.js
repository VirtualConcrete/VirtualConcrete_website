/* Virtual Concrete Studio — draft 3. No dependencies. */

/* ---------- Full-bleed rows: the scrollbar's width, which 100vw counts ---------- */

const html = document.documentElement;
new ResizeObserver(() => html.style.setProperty('--sbw', `${innerWidth - html.clientWidth}px`)).observe(html);

/* ---------- Command bar: the section in view ---------- */

const links = new Map([...document.querySelectorAll('.bar-nav a')].map((a) => [a.hash.slice(1), a]));
const sectionSpy = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    links.forEach((a, id) => {
      if (id === e.target.id) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main > section[id]').forEach((s) => sectionSpy.observe(s));

/* ---------- Opening: under the title, Conway's Life seeded from the title's own letters ---------- */

const CA = {
  cell: 12, // CSS px a cell takes, its 1px line included
  gps: 12, // generations per second, only while the page is scrolled and the opening in view
  still: 0.001, // fewer cells than this share differing from two generations back...
  stillGens: 45, // ...for this many generations (only still lifes and blinkers): a patch of soup
  soup: 18, // that patch, in cells a side, 40% alive
  reduced: 24, // with reduced motion: this generation, standing still
};

const opening = document.querySelector('.opening');
if (opening) {
  const canvas = opening.querySelector('.ca');
  const title = opening.querySelector('.title-plate p');
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const root = getComputedStyle(document.documentElement);
  const token = (name) => root.getPropertyValue(name).trim();
  const ink = {
    line: token('--border-grid'),
    dead: token('--bg-canvas'),
    ghost: token('--bg-elevated'), // died this generation
    live: token('--ink-telemetry'),
    born: token('--accent-optic'), // born this generation
  };

  let cols = 0, rows = 0, pitch = 0, line = 1, grid = null;
  let prev, cur, spare; // generations t-1, t, and the one being written
  let quiet = 0, raf = 0, last = 0, inView = false, builds = 0;

  function step() {
    let moved = 0;
    for (let y = 0; y < rows; y++) {
      const up = ((y + rows - 1) % rows) * cols, mid = y * cols, dn = ((y + 1) % rows) * cols;
      for (let x = 0; x < cols; x++) {
        const l = (x + cols - 1) % cols, r = (x + 1) % cols;
        const n = cur[up + l] + cur[up + x] + cur[up + r] + cur[mid + l] + cur[mid + r]
          + cur[dn + l] + cur[dn + x] + cur[dn + r];
        const v = n === 3 || (n === 2 && cur[mid + x] === 1) ? 1 : 0;
        spare[mid + x] = v;
        if (v !== prev[mid + x]) moved++;
      }
    }
    [prev, cur, spare] = [cur, spare, prev];
    quiet = moved < cols * rows * CA.still ? quiet + 1 : 0;
    if (quiet >= CA.stillGens) {
      soup();
      quiet = 0;
    }
  }

  function soup() {
    const s = Math.min(CA.soup, cols, rows);
    const x0 = Math.floor(Math.random() * cols), y0 = Math.floor(Math.random() * rows);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (Math.random() < 0.4) cur[((y0 + y) % rows) * cols + ((x0 + x) % cols)] = 1;
      }
    }
  }

  function draw() {
    ctx.drawImage(grid, 0, 0);
    const s = pitch - line;
    const paths = { ghost: new Path2D(), live: new Path2D(), born: new Path2D() };
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const now = cur[i], before = prev[i];
        if (!now && !before) continue;
        const p = now ? (before ? paths.live : paths.born) : paths.ghost;
        p.rect(x * pitch + line, y * pitch + line, s, s);
      }
    }
    for (const k in paths) {
      ctx.fillStyle = ink[k];
      ctx.fill(paths[k]);
    }
  }

  // the title as the plate sets it, drawn off screen and read back at every cell's centre
  function seed() {
    const style = getComputedStyle(title);
    const w = title.clientWidth, h = title.clientHeight;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if ('letterSpacing' in g) g.letterSpacing = style.letterSpacing;
    g.fillStyle = ink.live;
    const box = title.getBoundingClientRect();
    for (const span of title.querySelectorAll('span')) {
      const r = span.getBoundingClientRect();
      const text = span.textContent.toUpperCase();
      const m = g.measureText(text);
      // the capitals centred on their line, as CSS sets them
      const y = r.top - box.top + r.height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      g.fillText(text, r.left - box.left, y);
    }
    const alpha = g.getImageData(0, 0, w, h).data;
    const size = pitch / (canvas.width / canvas.clientWidth); // a cell in CSS px
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const sx = Math.floor((x + 0.5) * size), sy = Math.floor((y + 0.5) * size);
        cur[y * cols + x] = sx < w && sy < h && alpha[(sy * w + sx) * 4 + 3] > 127 ? 1 : 0;
      }
    }
    prev.set(cur);
  }

  async function build() {
    const id = ++builds;
    const style = getComputedStyle(title);
    await document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, 'VIRTUALCONCRETESTUDIO');
    if (id !== builds) return; // resized again meanwhile
    const dpr = devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    pitch = Math.max(2, Math.round(CA.cell * dpr));
    line = Math.max(1, Math.round(dpr));
    cols = Math.ceil(w / pitch);
    rows = Math.ceil(h / pitch);
    prev = new Uint8Array(cols * rows);
    cur = new Uint8Array(cols * rows);
    spare = new Uint8Array(cols * rows);

    // the lines and the dead cells, drawn once per size
    grid = document.createElement('canvas');
    grid.width = w;
    grid.height = h;
    const g = grid.getContext('2d');
    g.fillStyle = ink.line;
    g.fillRect(0, 0, w, h);
    g.fillStyle = ink.dead;
    g.beginPath();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.rect(x * pitch + line, y * pitch + line, pitch - line, pitch - line);
    g.fill();

    seed();
    quiet = 0;
    if (reduce.matches) for (let i = 0; i < CA.reduced; i++) step();
    draw();
    wake();
  }

  const running = () => inView && !reduce.matches && scrollY > 0 && grid !== null;
  function tick(t) {
    raf = 0;
    if (!running()) return;
    if (t - last >= 1000 / CA.gps) {
      last = t;
      step();
      draw();
    }
    raf = requestAnimationFrame(tick);
  }
  function wake() {
    if (!raf && running()) raf = requestAnimationFrame(tick);
  }

  addEventListener('scroll', wake, { passive: true });
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    wake();
  }).observe(opening);
  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(build);
  }).observe(canvas);
  reduce.addEventListener('change', build);
}

/* ---------- Placeholders: an image that isn't there yet leaves the slot showing ---------- */

document.querySelectorAll('img[data-optional]').forEach((img) => {
  if (img.complete && img.naturalWidth === 0) img.remove();
  else img.addEventListener('error', () => img.remove(), { once: true });
});

/* ---------- DumBO stage: colours and notes only while the mouse moves ---------- */

const LIVE_MS = 1600; // the notes stay this long after the mouse stops
const TOUCH_LIVE_MS = 4000; // and this long after a tap
const CAD_Y = 2267.72; // the plates' SVG y is this minus the drawing's Y (see ZOOM_1 source)

async function loadPlate(el) {
  try {
    const res = await fetch(el.dataset.src);
    if (!res.ok) throw new Error(res.status);
    el.innerHTML = await res.text();
  } catch {
    // file:// or a missing file: the plate as a picture, in its own colours, without the reveal
    el.innerHTML = `<img src="${el.dataset.src}" alt="">`;
  }
}

document.querySelectorAll('[data-stage]').forEach((stage) => {
  const view = stage.querySelector('.stage-view');
  const frames = [...stage.querySelectorAll('.frame')];
  const tabs = [...stage.querySelectorAll('[role="tab"]')];
  const plates = [...stage.querySelectorAll('.plate[data-src]')];
  const label = stage.querySelector('.xh-l');
  let timer = 0;

  // callout text at 12-13px on screen: drawing units per screen pixel, as --u
  const scale = () => {
    plates.forEach((p) => {
      const svg = p.querySelector('svg');
      if (svg && p.clientWidth) p.style.setProperty('--u', (svg.viewBox.baseVal.width / p.clientWidth).toFixed(4));
    });
  };
  Promise.all(plates.map(loadPlate)).then(scale);
  new ResizeObserver(scale).observe(view);

  const live = (ms) => {
    stage.classList.add('is-live');
    clearTimeout(timer);
    timer = setTimeout(() => stage.classList.remove('is-live'), ms);
  };
  const rest = () => {
    clearTimeout(timer);
    stage.classList.remove('is-live');
  };

  function show(i) {
    frames.forEach((f, k) => f.classList.toggle('is-active', k === i));
    tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i));
      t.tabIndex = k === i ? 0 : -1;
    });
    view.dataset.kind = frames[i].dataset.kind || 'plate';
    scale();
  }
  show(0);
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(i));
    t.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = (i + step + tabs.length) % tabs.length;
      show(next);
      tabs[next].focus();
    });
  });

  // the crosshair and the drawing's coordinates: plates only, never over the render
  function crosshair(e) {
    const box = view.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    view.style.setProperty('--x', `${x}px`);
    view.style.setProperty('--y', `${y}px`);
    view.classList.toggle('xh-flip', x > box.width - 200);
    const svg = frames.find((f) => f.classList.contains('is-active'))?.querySelector('svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const cx = vb.x + (x / box.width) * vb.width, cy = vb.y + (y / box.height) * vb.height;
    label.textContent = `X ${cx.toFixed(2)}  Y ${(CAD_Y - cy).toFixed(2)}`;
  }

  view.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    crosshair(e);
    live(LIVE_MS);
  });
  view.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    crosshair(e);
    live(TOUCH_LIVE_MS);
  });
  view.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') rest(); });
  // keyboard: the notes show while the stage has focus
  view.addEventListener('focus', () => stage.classList.add('is-live'));
  view.addEventListener('blur', rest);
});

/* ---------- Videos: [data-autoplay] plays while in view (not with reduced motion); PLAY / PAUSE ---------- */

const still = matchMedia('(prefers-reduced-motion: reduce)');
const playing = new IntersectionObserver((entries) => {
  entries.forEach(({ target: video, isIntersecting }) => {
    if (isIntersecting && !video.dataset.held && !still.matches) video.play().catch(() => {});
    else if (!isIntersecting) video.pause();
  });
}, { threshold: 0.25 });
document.querySelectorAll('video[data-autoplay]').forEach((video) => playing.observe(video));

document.querySelectorAll('[data-play]').forEach((button) => {
  const video = document.getElementById(button.getAttribute('aria-controls'));
  if (!video) return;
  const label = () => { button.textContent = video.paused ? 'Play' : 'Pause'; };
  // a pause from the button holds until the button plays it again; scrolling doesn't restart it
  button.addEventListener('click', () => {
    if (video.paused) {
      delete video.dataset.held;
      video.play().catch(label);
    } else {
      video.dataset.held = '1';
      video.pause();
    }
  });
  video.addEventListener('play', label);
  video.addEventListener('pause', label);
});

/* ---------- Feasibility form ---------- */

const form = document.getElementById('contact-form');
if (form) {
  const status = form.querySelector('.form-status');
  const say = (text, kind = '') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    if (data.get('website')) { // the honeypot: only bots fill it
      form.reset();
      say('Richiesta inviata.', 'ok');
      return;
    }
    const endpoint = form.dataset.endpoint;
    if (!endpoint) {
      say('Endpoint non ancora configurato: la richiesta non è stata inviata.', 'warn');
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    say('Invio in corso…');
    try {
      const res = await fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(res.status);
      form.reset();
      say('Richiesta inviata. Vi risponderemo a breve.', 'ok');
    } catch {
      say('Invio non riuscito. Riprova o scrivici direttamente.', 'warn');
    } finally {
      button.disabled = false;
    }
  });
}
