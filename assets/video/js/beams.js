// Laser beams, drawn as screen-space ribbons so that a 1 cm beam stays a clean line
// when it is thinner than a pixel. Each pixel gets the exact share of the cylinder it covers.
//
// Brightness is the same model as the Blender renders:
//   beam.py      BASE / max(sin θ, MIN)^P  x  Henyey-Greenstein forward scatter (G)
//   rgb_laser    emission weighted by (1 - Layer Weight "Facing", blend 0.7) = |N·V|^(5/3)
import * as THREE from 'three';

export const LOOK = { BASE: 2, MIN: 0.08, P: 1, G: 0.3 };

const vertexShader = /* glsl */`
in vec3 otherEnd;
in vec3 axis;
in float end;     // 0 = this vertex is the diode end, 1 = far end
in float side;    // -1 / +1
in float radius;
in float laser;

uniform vec2 viewport;
uniform float near;
uniform vec3 colors[LASERS];

out vec3 vPoint;
out vec3 vAxis;
out vec3 vColor;
out float vRadius;
out float vOffsetW;
out float vW;

void main() {
  vec3 p = (modelViewMatrix * vec4(position, 1.0)).xyz;
  vec3 q = (modelViewMatrix * vec4(otherEnd, 1.0)).xyz;
  float limit = -near * 1.01;

  if (p.z > limit && q.z > limit) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (p.z > limit) p = mix(p, q, (p.z - limit) / (p.z - q.z));
  if (q.z > limit) q = mix(q, p, (q.z - limit) / (q.z - p.z));

  vec4 cp = projectionMatrix * vec4(p, 1.0);
  vec4 cq = projectionMatrix * vec4(q, 1.0);
  vec2 along = (cq.xy / cq.w - cp.xy / cp.w) * viewport;
  if (end > 0.5) along = -along;
  along /= max(length(along), 1e-6);

  float halfPx = radius * projectionMatrix[1][1] * viewport.y * 0.5 / -p.z;
  float offset = side * (halfPx + 1.5);
  cp.xy += vec2(-along.y, along.x) * offset * 2.0 / viewport * cp.w;
  gl_Position = cp;

  vPoint = p;
  vAxis = mat3(modelViewMatrix) * axis;
  vColor = colors[int(laser + 0.5)];
  vRadius = radius;
  // perspective-correct interpolation would bend the pixel offset, so undo it with w
  vOffsetW = offset * cp.w;
  vW = cp.w;
}`;

const fragmentShader = /* glsl */`
precision highp float;
uniform vec2 viewport;
uniform vec4 look; // BASE, MIN, P, G

in vec3 vPoint;
in vec3 vAxis;
in vec3 vColor;
in float vRadius;
in float vOffsetW;
in float vW;
out vec4 fragColor;

void main() {
  float level = max(vColor.r, max(vColor.g, vColor.b));
  if (level <= 0.0) discard;

  float x = vOffsetW / vW;
  float halfPx = vRadius * projectionMatrix[1][1] * viewport.y * 0.5 / -vPoint.z;
  float lo = max(x - 0.5, -halfPx);
  float hi = min(x + 0.5, halfPx);
  if (hi <= lo) discard;

  float profile = 0.0;
  for (int i = 0; i < 6; i++) {
    float u = mix(lo, hi, (float(i) + 0.5) / 6.0) / halfPx;
    profile += pow(max(1.0 - u * u, 0.0), 0.8333);
  }
  profile /= 6.0;

  vec3 axis = normalize(vAxis);
  vec3 toEye = normalize(-vPoint);
  float s = length(cross(toEye, axis));
  float g = look.w;
  float scatter = pow((1.0 + g * g) / (1.0 + g * g - 2.0 * g * dot(toEye, axis)), 1.5);
  float strength = look.x * pow(1.0 / max(s, look.y), look.z) * scatter;
  float facing = profile * pow(max(s, 1e-4), 5.0 / 3.0);

  float coverage = hi - lo;
  fragColor = vec4(vColor * strength * facing * coverage, coverage * min(level, 1.0));
}`;

export function createBeams(beams) {
  const position = [], otherEnd = [], axis = [], end = [], side = [], radius = [], laser = [], index = [];

  beams.forEach((beam, i) => {
    const dir = new THREE.Vector3(...beam.b).sub(new THREE.Vector3(...beam.a)).normalize().toArray();
    for (const [e, p, q] of [[0, beam.a, beam.b], [1, beam.b, beam.a]]) {
      for (const s of [-1, 1]) {
        position.push(...p); otherEnd.push(...q); axis.push(...dir);
        end.push(e); side.push(s); radius.push(beam.radius); laser.push(i);
      }
    }
    const v = i * 4;
    index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
  });

  const geometry = new THREE.BufferGeometry();
  const attributes = { position: [position, 3], otherEnd: [otherEnd, 3], axis: [axis, 3],
    end: [end, 1], side: [side, 1], radius: [radius, 1], laser: [laser, 1] };
  for (const [name, [data, size]] of Object.entries(attributes)) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  }
  geometry.setIndex(index);

  const colors = new Float32Array(beams.length * 3);
  const viewport = new THREE.Vector2(1, 1);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines: { LASERS: beams.length },
    uniforms: {
      colors: { value: colors },
      viewport: { value: viewport },
      near: { value: 0.05 },
      look: { value: new THREE.Vector4(LOOK.BASE, LOOK.MIN, LOOK.P, LOOK.G) },
    },
    vertexShader,
    // projectionMatrix is only declared for vertex shaders by three.js
    fragmentShader: fragmentShader.replace('uniform vec2 viewport;', 'uniform mat4 projectionMatrix;\nuniform vec2 viewport;'),
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (renderer, scene, camera) => { material.uniforms.near.value = camera.near; };
  return { mesh, colors, viewport };
}
