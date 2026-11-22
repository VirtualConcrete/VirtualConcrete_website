// Simpler LEDs for browsers without WebGL 2: the same dots and glow on black.
import { WIDTH, HEIGHT } from './terminal.js';
import { createGlow } from './glow.js';
import { LOOK } from './leds.js';
import { CA_LED } from './ca.js';

const COLOUR = [200, 255, 228];

export function createLeds2d(canvas) {
  const context = canvas.getContext('2d', { alpha: false });
  const { reach, width, height, spread } = createGlow(LOOK.glowRadius);

  // one pixel per LED, stretched smoothly over the panel
  const haze = document.createElement('canvas');
  haze.width = width;
  haze.height = height;
  const hazeContext = haze.getContext('2d', { alpha: false });
  const image = hazeContext.createImageData(width, height);

  return function draw(pixels, { scale, left, top }) {
    const light = spread(pixels);
    for (let i = 0; i < light.length; i++) {
      image.data.set(COLOUR, 4 * i);
      image.data[4 * i + 3] = light[i];
    }
    hazeContext.putImageData(image, 0, 0);

    context.globalAlpha = 1;
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = LOOK.glow;
    context.drawImage(haze, left - reach * scale, top - reach * scale, width * scale, height * scale);

    const radius = 0.4 * scale;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const on = pixels[y * WIDTH + x];
        const received = light[(y + reach) * width + x + reach] / 255;
        if (!on && !received) continue;
        context.globalAlpha = on ? 1 : LOOK.reveal * received;
        context.fillStyle = `rgb(${on === CA_LED ? LOOK.caColour : COLOUR})`;
        context.beginPath();
        context.arc(left + (x + 0.5) * scale, top + (y + 0.5) * scale, radius, 0, 2 * Math.PI);
        context.fill();
      }
    }
  };
}
