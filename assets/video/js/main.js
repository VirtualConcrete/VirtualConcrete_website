import * as THREE from 'three';
import { GLTFLoader } from '../lib/three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from '../lib/three/addons/loaders/DRACOLoader.js';
import { createBeams } from './beams.js';
import { Glare } from './glare.js';
import { Navigation } from './navigation.js';
import { loadShow } from './show.js';

// URL options: ?show=neon  ?view=2  ?t=3.5 (starts paused)  ?quality=high|low  ?clean (no interface)
const SHOWS = {
  noise_gb_smooth: 'Drift',
  bars_random: 'Bars',
  sweep_fade: 'Sweep, trails',
  sweep: 'Sweep',
  noise_gb: 'Noise',
  neon: 'Neon',
};
const SAFE_FLASHES_PER_SECOND = 3; // WCAG 2.3.1
const HIGH_DETAIL_WITHIN = 4; // metres from a copy of the scan

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const high = params.has('quality') ? params.get('quality') === 'high' : !touch;
const asset = (path) => new URL(`../assets/${path}`, import.meta.url).href;

async function start() {
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.AgXToneMapping;

  const draco = new DRACOLoader().setDecoderPath(new URL('../lib/three/draco/', import.meta.url).href);
  const gltf = new GLTFLoader().setDRACOLoader(draco);

  const [layout, near, far, props, texture] = await Promise.all([
    fetch(asset('scene.json')).then((r) => r.json()),
    gltf.loadAsync(asset(high ? 'scan_high.glb' : 'scan_mid.glb')),
    gltf.loadAsync(asset(high ? 'scan_mid.glb' : 'scan_low.glb')),
    gltf.loadAsync(asset('props.glb')),
    new THREE.TextureLoader().loadAsync(
      asset(high && renderer.capabilities.maxTextureSize >= 4096 ? 'scan_4096.webp' : 'scan_2048.webp')),
  ]);
  draco.dispose();

  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  // The room is lit only by a uniform world, so albedo x world is all the lighting there is.
  const scanMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const sheen = { value: 0 }; // what Principled's specular adds at roughness 1 under a uniform world
  scanMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.sheen = sheen;
    shader.fragmentShader = `uniform float sheen;\n${shader.fragmentShader}`
      .replace('#include <opaque_fragment>', 'outgoingLight += sheen;\n#include <opaque_fragment>');
  };
  const barMaterial = new THREE.MeshBasicMaterial();
  const panelMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  function setRoomLight(amount) {
    const light = layout.ambient * 70 ** amount;
    scanMaterial.color.setScalar(light);
    sheen.value = light * 0.025;
    barMaterial.color.setScalar(light * 0.8);
    panelMaterial.color.setScalar(light * 0.07);
  }
  setRoomLight(0);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  props.scene.traverse((o) => {
    if (o.isMesh) o.material = o.name.startsWith('Plane') ? panelMaterial : barMaterial;
  });
  scene.add(props.scene);

  const scanMesh = (file) => {
    let found;
    file.scene.updateMatrixWorld(true);
    file.scene.traverse((o) => { if (o.isMesh) found = o; });
    return found.geometry.applyMatrix4(found.matrixWorld);
  };
  const nearGeometry = scanMesh(near), farGeometry = scanMesh(far);
  nearGeometry.computeBoundingBox();

  // 21 copies of one bay (Blender's Array modifiers), sharing geometry on the GPU
  const extent = new THREE.Box3();
  const bays = layout.copies.map((offset) => {
    const position = new THREE.Vector3(...offset);
    const box = nearGeometry.boundingBox.clone().translate(position);
    extent.union(box);
    const meshes = [nearGeometry, farGeometry].map((geometry) => {
      const mesh = new THREE.Mesh(geometry, scanMaterial);
      mesh.position.copy(position);
      scene.add(mesh);
      return mesh;
    });
    return { box, meshes };
  });

  const beams = createBeams(layout.beams);
  scene.add(beams.mesh);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 120);
  const nav = new Navigation(camera, canvas, new THREE.Box3(
    new THREE.Vector3(extent.min.x + 0.5, 0.2, extent.min.z + 0.5),
    new THREE.Vector3(extent.max.x - 0.5, 2.9, extent.max.z - 0.5)));

  const grid = new THREE.Box3().setFromPoints(
    layout.beams.flatMap((b) => [new THREE.Vector3(...b.a), new THREE.Vector3(...b.b)]));
  const middle = grid.getCenter(new THREE.Vector3());
  const views = [
    { name: 'Front', ...layout.cameras[0] },
    { name: 'Side', ...layout.cameras[1] },
    { name: 'Below', position: [middle.x + 1.2, 1.1, middle.z], forward: [-0.55, 0.83, 0] },
  ];

  const glare = new Glare(renderer);
  const size = new THREE.Vector2();
  let pixelRatio = Math.min(devicePixelRatio, 1.5);
  let dirty = true;

  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(size);
    glare.setSize(size.x, size.y);
    beams.viewport.copy(size);

    // Same horizontal angle as the Blender cameras, capped so portrait screens stay undistorted
    camera.aspect = width / height;
    const halfHeight = Math.min(layout.cameras[0].tanHalfWidth / camera.aspect, 0.95);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfHeight));
    camera.updateProjectionMatrix();
    dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let show;
  let time = Number(params.get('t')) || 0;
  let playing = !params.has('t') && !reducedMotion;
  let request = 0;
  const accepted = new Set();

  function setPlaying(value) {
    playing = value;
    $('play').textContent = playing ? 'Pause' : 'Play';
  }

  function confirmFlashing() {
    const dialog = $('warning');
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'play'), { once: true });
    });
  }

  async function selectShow(id, at = 0) {
    const mine = ++request;
    const next = await loadShow(id);
    if (mine !== request) return;
    if (next.flashesPerSecond > SAFE_FLASHES_PER_SECOND && !accepted.has(id)) {
      if (!await confirmFlashing()) {
        $('show').value = show.id;
        return;
      }
      accepted.add(id);
    }
    show = next;
    time = THREE.MathUtils.clamp(at, 0, show.duration);
    $('show').value = id;
    dirty = true;
  }

  for (const [id, label] of Object.entries(SHOWS)) $('show').add(new Option(label, id));
  $('show').addEventListener('change', (e) => {
    selectShow(e.target.value).catch((error) => {
      console.error(error);
      e.target.value = show.id;
    });
  });
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('time').addEventListener('input', (e) => { time = e.target.value * show.duration; });
  $('room').addEventListener('input', (e) => { setRoomLight(Number(e.target.value)); dirty = true; });
  views.forEach((view) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = view.name;
    button.addEventListener('click', () => nav.goTo(view.position, view.forward));
    $('views').append(button);
  });
  $('hint').textContent = touch
    ? 'Drag to look · two fingers to move'
    : 'Drag to look · W A S D to walk · Q E down / up · scroll to move';

  const first = views[Number(params.get('view')) - 1] ?? views[0];
  nav.goTo(first.position, first.forward);
  setPlaying(playing);

  // Always begin with a calm show, then honour ?show=, which may ask for confirmation
  const wanted = Object.hasOwn(SHOWS, params.get('show') ?? '') ? params.get('show') : null;
  await selectShow('noise_gb_smooth', time || (reducedMotion ? 3 : 0));

  $('status').hidden = true;
  if (params.has('clean')) document.querySelector('header').hidden = true;
  else $('controls').hidden = false;

  function render() {
    for (const { box, meshes } of bays) {
      const close = box.distanceToPoint(camera.position) < HIGH_DETAIL_WITHIN;
      meshes[0].visible = close;
      meshes[1].visible = !close;
    }
    glare.render(scene, camera);
  }

  // Drop the resolution if the device can't keep up
  let last = performance.now(), slow = 0, shown = -1;
  renderer.setAnimationLoop((now) => {
    const gap = (now - last) / 1000;
    const dt = THREE.MathUtils.clamp(gap, 0, 0.1);
    last = now;

    if (playing) time = (time + dt) % show.duration;
    const moved = nav.update(dt);
    const lit = show.sample(time, beams.colors);

    slow = THREE.MathUtils.clamp(slow + (gap > 1 / 28 && gap < 1 ? 1 : -1), 0, 60);
    if (slow === 60 && pixelRatio > 0.7) {
      slow = 0;
      pixelRatio = Math.max(0.7, pixelRatio * 0.8);
      resize();
    }

    if (dirty || moved || lit) {
      render();
      dirty = false;
    }
    const position = Math.round(time / show.duration * 1000);
    if (position !== shown) {
      $('time').value = position / 1000;
      shown = position;
    }
  });

  canvas.addEventListener('webglcontextlost', () => {
    $('status').hidden = false;
    $('status').textContent = 'The graphics context was lost. Reload the page to continue.';
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  document.documentElement.dataset.ready = '';
  if (wanted && wanted !== show.id) await selectShow(wanted, time);
}

start().catch((error) => {
  console.error(error);
  $('status').hidden = false;
  $('status').textContent = 'Could not load the simulation. It needs a browser with WebGL 2.';
});
