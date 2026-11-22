// How much light each LED gets from the lit ones around it.
import { WIDTH, HEIGHT } from './terminal.js';

/**
 * spread(pixels) returns width x height bytes: the panel with a margin of `reach` LEDs,
 * each 255 on a lit LED, fading to 0 at `radius` from the nearest one.
 */
export function createGlow(radius) {
  const reach = Math.ceil(radius);
  const width = WIDTH + 2 * reach, height = HEIGHT + 2 * reach;
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
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (!pixels[y * WIDTH + x]) continue;
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
