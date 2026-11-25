// Plays shows baked by laser_show.py: frames x lasers x 3 bytes, i.e. raw DMX levels.
const base = new URL('../assets/shows/', import.meta.url);
const cache = new Map();

export function loadShow(id) {
  if (!cache.has(id)) {
    const get = async (file, type) => {
      const response = await fetch(new URL(file, base));
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      return response[type]();
    };
    const loading = Promise.all([get(`${id}.json`, 'json'), get(`${id}.bin`, 'arrayBuffer')])
      .then(([meta, data]) => new Show(id, meta, new Uint8Array(data)));
    loading.catch(() => cache.delete(id));
    cache.set(id, loading);
  }
  return cache.get(id);
}

class Show {
  constructor(id, meta, data) {
    Object.assign(this, meta, { id, data });
    this.channels = data.length / meta.frames;
    this.duration = meta.frames / meta.fps;
  }

  /** Writes linear RGB levels for time t into out. Returns true if anything changed. */
  sample(t, out) {
    const at = Math.min(Math.max(t * this.fps, 0), this.frames - 1);
    const frame = Math.floor(at + 1e-6);
    const next = Math.min(frame + 1, this.frames - 1);
    const mix = this.smooth ? Math.max(at - frame, 0) : 0;
    let changed = false;
    for (let c = 0; c < this.channels; c++) {
      const a = this.data[frame * this.channels + c];
      const b = this.data[next * this.channels + c];
      const v = Math.fround((a + (b - a) * mix) / 255);
      if (out[c] !== v) { out[c] = v; changed = true; }
    }
    return changed;
  }
}
