/* The hero's LED screen: 64x128, portrait, beside the copy. A one-dimensional cellular automaton
   prints a generation per row at the bottom and the rows above scroll up.
   The LEDs are the first site's title panel (draft_1/assets/tui/leds.js and glow.js):
   the same LOOK, ported here, so that draft 3 stands on its own. The screen's black is the spec's
   --bg-canvas, not #000. No dependencies. */

const W = 64, H = 128; // LEDs across, down
const MARGIN = 2; // dark LEDs around the panel, inside the frame (the CSS aspect-ratio, 68 / 132, counts them)

// The knobs
const CA = {
  rule: 30, // Wolfram's number: 30, 90, 110...
  generationMs: 80, // one new row every
};

// The first site's, as the user tuned them there
const LOOK = {
  litRadius: 0.36, // radius of a lit LED, in pitches
  litColour: [209, 254, 234], // tints the light between the LEDs
  caColour: [214, 235, 255], // the automaton's LEDs: light blue, nearly white
  glowRadius: 12, // how far the light of a lit LED reaches, in LEDs
  glow: 0.055, // brightness of that light between the LEDs
  reveal: 0.02, // brightness the LEDs that are off get on top of the glow
};

const canvas = document.querySelector('.hero-screen .led');
if (canvas) start(canvas);

function start(canvas) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim();
  const base = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);

  /* ---------- The automaton: the screen's rows, oldest at the top ---------- */

  const rows = Array.from({ length: H }, () => new Uint8Array(W));
  rows[0][W >> 1] = 1; // one lit cell, the row wrapping around at the edges
  function step(from, to) {
    for (let x = 0; x < W; x++) {
      const l = from[(x + W - 1) % W], r = from[(x + 1) % W];
      to[x] = (CA.rule >> ((l << 2) | (from[x] << 1) | r)) & 1;
    }
  }
  function grow() {
    const last = rows[H - 1], next = rows.shift(); // the oldest row, reused for the newest
    step(last, next);
    rows.push(next);
  }
  // a screenful to begin with, the first generation at the top, each row computed from the one above
  for (let y = 1; y < H; y++) step(rows[y - 1], rows[y]);

  const pixels = new Uint8Array(W * H);
  const frame = () => {
    rows.forEach((row, y) => pixels.set(row, y * W));
    return pixels;
  };

  /* ---------- The LEDs ---------- */

  let render = null;
  try {
    render = createLeds(canvas, base);
  } catch (error) {
    console.warn(error);
  }
  if (!render) {
    // a canvas that has had a WebGL context can't give a 2D one
    const fresh = canvas.cloneNode();
    canvas.replaceWith(fresh);
    canvas = fresh;
    render = createLeds2d(canvas, base);
  }

  let layout = null;
  const draw = () => layout && render(frame(), layout);

  // each LED a whole number of device pixels, so the dots are even at any zoom
  function fit(width, height) {
    canvas.width = width;
    canvas.height = height;
    const pitch = Math.max(1, Math.floor(Math.min(width / (W + 2 * MARGIN), height / (H + 2 * MARGIN))));
    layout = { pitch, left: Math.floor((width - W * pitch) / 2), top: Math.floor((height - H * pitch) / 2) };
    draw();
  }
  function measure(entries) {
    const dpr = devicePixelRatio;
    const box = canvas.getBoundingClientRect();
    let width = Math.round(box.width * dpr), height = Math.round(box.height * dpr);
    // the exact device-pixel size, when the browser gives one that agrees (Safari doesn't)
    const exact = entries?.[0]?.devicePixelContentBoxSize?.[0];
    if (exact && Math.abs(exact.inlineSize - width) <= 2 && Math.abs(exact.blockSize - height) <= 2) {
      width = exact.inlineSize;
      height = exact.blockSize;
    }
    if (width && height) fit(width, height);
  }
  const resize = new ResizeObserver(measure);
  try {
    resize.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    resize.observe(canvas);
    addEventListener('resize', () => measure()); // zoom changes devicePixelRatio
  }

  /* ---------- Running: only while the screen is in view ---------- */

  if (still) return;
  let inView = false, raf = 0, last = 0;
  function tick(now) {
    raf = 0;
    if (!inView) return;
    if (now - last > 10 * CA.generationMs) last = now; // also back from a hidden tab
    let grew = false;
    while (now - last >= CA.generationMs) {
      grow();
      last += CA.generationMs;
      grew = true;
    }
    if (grew) draw();
    raf = requestAnimationFrame(tick);
  }
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView && !raf) raf = requestAnimationFrame(tick);
  }).observe(canvas);
}

/* ---------- How much light each LED gets from the lit ones around it (glow.js) ---------- */

function createGlow(radius) {
  const reach = Math.ceil(radius);
  const width = W + 2 * reach, height = H + 2 * reach;
  const light = new Uint8Array(width * height);
  const offsets = [], levels = [];
  for (let y = -reach; y <= reach; y++) {
    for (let x = -reach; x <= reach; x++) {
      const fade = 1 - (x * x + y * y) / (radius * radius);
      if (fade <= 0) continue;
      offsets.push(y * width + x);
      levels.push(Math.round(255 * fade * fade));
    }
  }
  function spread(pixels) {
    light.fill(0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!pixels[y * W + x]) continue;
        const centre = (y + reach) * width + x + reach;
        // the nearest lit LED wins, so a lone one reaches as far as a block
        for (let i = 0; i < offsets.length; i++) {
          const at = centre + offsets[i];
          if (light[at] < levels[i]) light[at] = levels[i];
        }
      }
    }
    return light;
  }
  return { reach, width, height, spread };
}

/* ---------- The LEDs with WebGL 2 (leds.js) ---------- */

const vec3 = (rgb) => `vec3(${rgb.map((v) => (v / 255).toFixed(4)).join(', ')})`;
const num = (v) => Number(v).toFixed(5);

/** Returns null without WebGL 2. Throws if the shader can't be built. */
function createLeds(canvas, base) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) return null;

  const vertex = `#version 300 es
void main() {
  gl_Position = vec4(vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0, 0.0, 1.0);
}`;
  const fragment = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D leds; // r: lit, g: light from the LEDs around
uniform vec2 origin;    // top left of the panel, device px
uniform float pitch;    // device px per LED
uniform vec2 canvas;
uniform float reach;    // LEDs of margin around the panel in the texture
out vec4 fragColor;

float inside(float distance, float softness) {
  return 1.0 - smoothstep(-softness, softness, distance);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, canvas.y - gl_FragCoord.y);
  vec2 p = (screen - origin) / pitch; // in LEDs

  vec3 tint = ${vec3(LOOK.litColour)};
  float light = texture(leds, (p + reach) / vec2(textureSize(leds, 0))).g;
  vec3 colour = ${vec3(base)} + tint * ${num(LOOK.glow)} * light;
  if (p.x >= 0.0 && p.y >= 0.0 && p.x < ${num(W)} && p.y < ${num(H)}) {
    float d = length(fract(p) - 0.5);
    float body = inside(d - ${num(LOOK.litRadius)}, max(0.055, 0.6 / pitch));
    vec2 led = texelFetch(leds, ivec2(p) + int(reach), 0).rg;
    colour = mix(colour + tint * ${num(LOOK.reveal)} * led.g * body, ${vec3(LOOK.caColour)}, led.r * body);
  }
  fragColor = vec4(colour, 1.0);
}`;

  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const logs = gl.getAttachedShaders(program).map((shader) => gl.getShaderInfoLog(shader));
    throw new Error(`LED shader: ${gl.getProgramInfoLog(program)} ${logs.join(' ')}`);
  }
  gl.useProgram(program);
  const uniform = (name) => gl.getUniformLocation(program, name);
  const at = { origin: uniform('origin'), pitch: uniform('pitch'), canvas: uniform('canvas') };

  const { reach, width, height, spread } = createGlow(LOOK.glowRadius);
  gl.uniform1f(uniform('reach'), reach);

  const texels = new Uint8Array(width * height * 2);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  // linear for the glow: texelFetch reads single LEDs regardless
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, width, height, 0, gl.RG, gl.UNSIGNED_BYTE, texels);

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

  return function draw(pixels, { pitch, left, top }) {
    if (gl.isContextLost()) return;
    const light = spread(pixels);
    for (let i = 0; i < light.length; i++) {
      const x = (i % width) - reach, y = Math.floor(i / width) - reach;
      texels[2 * i] = x >= 0 && x < W && y >= 0 && y < H && pixels[y * W + x] ? 255 : 0;
      texels[2 * i + 1] = light[i];
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RG, gl.UNSIGNED_BYTE, texels);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(at.origin, left, top);
    gl.uniform1f(at.pitch, pitch);
    gl.uniform2f(at.canvas, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

/* ---------- Without WebGL 2: the same dots and glow, simpler (leds-2d.js) ---------- */

function createLeds2d(canvas, base) {
  const context = canvas.getContext('2d', { alpha: false });
  const { reach, width, height, spread } = createGlow(LOOK.glowRadius);
  const haze = document.createElement('canvas');
  haze.width = width;
  haze.height = height;
  const hazeContext = haze.getContext('2d', { alpha: false });
  const image = hazeContext.createImageData(width, height);

  return function draw(pixels, { pitch, left, top }) {
    const light = spread(pixels);
    for (let i = 0; i < light.length; i++) {
      image.data.set(LOOK.litColour, 4 * i);
      image.data[4 * i + 3] = light[i];
    }
    hazeContext.putImageData(image, 0, 0);

    context.globalAlpha = 1;
    context.fillStyle = `rgb(${base})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = LOOK.glow;
    context.drawImage(haze, left - reach * pitch, top - reach * pitch, width * pitch, height * pitch);

    context.fillStyle = `rgb(${LOOK.caColour})`;
    const radius = LOOK.litRadius * pitch;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const on = pixels[y * W + x];
        const received = light[(y + reach) * width + x + reach] / 255;
        if (!on && !received) continue;
        context.globalAlpha = on ? 1 : LOOK.reveal * received;
        context.beginPath();
        context.arc(left + (x + 0.5) * pitch, top + (y + 0.5) * pitch, radius, 0, 2 * Math.PI);
        context.fill();
      }
    }
  };
}
