// First-person look and move for mouse, touch and keyboard.
import * as THREE from 'three';

const KEYS = { KeyW: [0, 0, 1], ArrowUp: [0, 0, 1], KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0], KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  KeyE: [0, 1, 0], KeyQ: [0, -1, 0] };

export class Navigation {
  constructor(camera, element, bounds) {
    Object.assign(this, { camera, element, bounds, yaw: 0, pitch: 0, changed: true });
    this.keys = new Set();
    this.pointers = new Map();
    camera.rotation.order = 'YXZ';

    element.addEventListener('pointerdown', (e) => {
      element.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    });
    element.addEventListener('pointermove', (e) => this.drag(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      element.addEventListener(type, (e) => this.pointers.delete(e.pointerId));
    }
    element.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.move(0, 0, THREE.MathUtils.clamp(-e.deltaY * 0.004, -0.5, 0.5));
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (!KEYS[e.code] || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, select, dialog')) return;
      e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  drag(e) {
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last[0], dy = e.clientY - last[1];

    if (this.pointers.size === 1) {
      const scale = THREE.MathUtils.degToRad(this.camera.fov) / this.element.clientHeight;
      this.look(this.yaw + dx * scale, this.pitch + dy * scale);
    } else {
      // two fingers: pinch walks forward, dragging strafes
      const other = [...this.pointers].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(last[0] - other[0], last[1] - other[1]);
      const after = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
      this.move(-dx * 0.005, 0, (after - before) * 0.015);
    }
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
  }

  look(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -1.5, 1.5);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.changed = true;
  }

  goTo(position, forward) {
    this.camera.position.fromArray(position);
    const [x, y, z] = forward;
    this.look(Math.atan2(-x, -z), Math.atan2(y, Math.hypot(x, z)));
  }

  move(right, up, forward) {
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const p = this.camera.position;
    p.x += right * cos - forward * sin;
    p.y += up;
    p.z += -right * sin - forward * cos;
    p.clamp(this.bounds.min, this.bounds.max);
    this.changed = true;
  }

  update(dt) {
    for (const key of this.keys) this.move(...KEYS[key].map((v) => v * 2 * dt));
    const changed = this.changed;
    this.changed = false;
    return changed;
  }
}
