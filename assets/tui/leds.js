// Draws a 128x64 frame as the LEDs of a HUB75 panel: lit dots, whose light faintly reveals the dark ones around them.
// In a frame 0 is off, CA_LED is the automaton's colour (ca.js), anything else the text's.
import { WIDTH, HEIGHT } from './terminal.js';
import { createGlow } from './glow.js';
import { CA_LED } from './ca.js';

// The knobs
export const LOOK = {
  litRadius: 0.36, // radius of a lit LED, in pitches
  litColour: [209, 254, 234],
  caColour: [214, 235, 255], // the cellular automaton's LEDs: light blue, nearly white
  glowRadius: 12, // how far the light of a lit LED reaches, in LEDs
  glow: 0.055, // brightness of that light between the LEDs
  reveal: 0.02, // brightness the LEDs that are off get on top of the glow
};

const vec3 = (rgb) => `vec3(${rgb.map((v) => (v / 255).toFixed(4)).join(', ')})`;
const num = (v) => Number(v).toFixed(5);

const vertexSource = `#version 300 es
void main() {
  gl_Position = vec4(vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D leds; // r: text on, g: light from the LEDs around, b: automaton on
uniform vec2 origin;   // top left of the panel, device px
uniform float pitch;   // device px per LED
uniform vec2 canvas;
uniform float reach; // LEDs of margin around the panel in the texture
out vec4 fragColor;

float inside(float distance, float softness) {
  return 1.0 - smoothstep(-softness, softness, distance);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, canvas.y - gl_FragCoord.y);
  vec2 p = (screen - origin) / pitch; // in LEDs

  vec3 text = ${vec3(LOOK.litColour)};
  float light = texture(leds, (p + reach) / vec2(textureSize(leds, 0))).g;
  vec3 colour = text * ${num(LOOK.glow)} * light;
  if (p.x >= 0.0 && p.y >= 0.0 && p.x < ${num(WIDTH)} && p.y < ${num(HEIGHT)}) {
    float d = length(fract(p) - 0.5);
    float body = inside(d - ${num(LOOK.litRadius)}, max(0.055, 0.6 / pitch));
    vec3 led = texelFetch(leds, ivec2(p) + int(reach), 0).rgb;
    vec3 ledColour = mix(text, ${vec3(LOOK.caColour)}, led.b);
    colour = mix(colour + text * ${num(LOOK.reveal)} * led.g * body, ledColour, max(led.r, led.b) * body);
  }
  fragColor = vec4(colour, 1.0);
}`;

/** Returns null without WebGL 2. Throws if the shader can't be built. */
export function createLeds(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) return null;

  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
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

  const texels = new Uint8Array(width * height * 3);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  // linear for the glow: texelFetch reads single LEDs regardless
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, texels);

  let uploaded = null;

  function upload(pixels) {
    const light = spread(pixels);
    for (let i = 0; i < light.length; i++) {
      const x = (i % width) - reach, y = Math.floor(i / width) - reach;
      const on = x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? pixels[y * WIDTH + x] : 0;
      texels[3 * i] = on && on !== CA_LED ? 255 : 0;
      texels[3 * i + 1] = light[i];
      texels[3 * i + 2] = on === CA_LED ? 255 : 0;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGB, gl.UNSIGNED_BYTE, texels);
    uploaded = pixels;
  }

  return function draw(pixels, { scale, left, top }) {
    if (gl.isContextLost()) return;
    if (pixels !== uploaded) upload(pixels);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(at.origin, left, top);
    gl.uniform1f(at.pitch, scale);
    gl.uniform2f(at.canvas, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
