// Bloom built like Blender's compositor Glare > Bloom (see env.py): highlights above a
// threshold at half resolution, a chain of downsamples, then added back up and averaged.
// The final pass does AgX + sRGB, as Blender does after compositing.
import * as THREE from 'three';

const GLARE = { THRESHOLD: 0.5, SIZE: 0.6, STRENGTH: 0.8 }; // strength matched to the Blender movies

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(fragmentShader, uniforms, options = {}) {
  return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms,
    depthTest: false, depthWrite: false, toneMapped: false, ...options });
}

export class Glare {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.down = [];
    this.up = [];
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(triangle);
    this.quad.frustumCulled = false;

    this.highlights = pass(/* glsl */`
      uniform sampler2D map; uniform float threshold; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        float v = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * max(v - threshold, 0.0) / max(v, 1e-4), 1.0);
      }`, { map: { value: null }, threshold: { value: GLARE.THRESHOLD } });

    this.downsample = pass(/* glsl */`
      uniform sampler2D map; uniform vec2 texel; varying vec2 vUv;
      vec3 s(float x, float y) { return texture2D(map, vUv + vec2(x, y) * texel).rgb; }
      void main() {
        vec3 c = s(0., 0.) * .125;
        c += (s(-1., -1.) + s(1., -1.) + s(-1., 1.) + s(1., 1.)) * .125;
        c += (s(-2., 0.) + s(2., 0.) + s(0., -2.) + s(0., 2.)) * .0625;
        c += (s(-2., -2.) + s(2., -2.) + s(-2., 2.) + s(2., 2.)) * .03125;
        gl_FragColor = vec4(c, 1.0);
      }`, { map: { value: null }, texel: { value: new THREE.Vector2() } });

    this.upsample = pass(/* glsl */`
      uniform sampler2D small; uniform sampler2D base; uniform vec2 texel; varying vec2 vUv;
      vec3 s(float x, float y) { return texture2D(small, vUv + vec2(x, y) * texel).rgb; }
      void main() {
        vec3 c = s(0., 0.) * .25;
        c += (s(-1., 0.) + s(1., 0.) + s(0., -1.) + s(0., 1.)) * .125;
        c += (s(-1., -1.) + s(1., -1.) + s(-1., 1.) + s(1., 1.)) * .0625;
        gl_FragColor = vec4(c + texture2D(base, vUv).rgb, 1.0);
      }`, { small: { value: null }, base: { value: null }, texel: { value: new THREE.Vector2() } });

    this.composite = pass(/* glsl */`
      uniform sampler2D map; uniform sampler2D glare; uniform float gain; varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(map, vUv).rgb + texture2D(glare, vUv).rgb * gain, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // dither: the room is almost black and would band otherwise
        gl_FragColor.rgb += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))) - .5) / 255.0;
      }`, { map: { value: null }, glare: { value: null }, gain: { value: 0 } }, { toneMapped: true });
  }

  setSize(width, height) {
    this.target.setSize(width, height);
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = [];
    this.up = [];

    let w = Math.max(width >> 1, 2), h = Math.max(height >> 1, 2);
    const levels = Math.max(1, Math.floor(Math.log2(Math.min(w, h) * GLARE.SIZE)));
    for (let i = 0; i < levels; i++) {
      const options = { type: THREE.HalfFloatType, depthBuffer: false };
      this.down.push(new THREE.WebGLRenderTarget(w, h, options));
      if (i < levels - 1) this.up.push(new THREE.WebGLRenderTarget(w, h, options));
      w = Math.max(w >> 1, 1);
      h = Math.max(h >> 1, 1);
    }
    this.composite.uniforms.gain.value = GLARE.STRENGTH / levels;
  }

  draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.camera);
  }

  render(scene, camera) {
    const { renderer, down, up } = this;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);

    this.highlights.uniforms.map.value = this.target.texture;
    this.draw(this.highlights, down[0]);

    for (let i = 1; i < down.length; i++) {
      this.downsample.uniforms.map.value = down[i - 1].texture;
      this.downsample.uniforms.texel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
      this.draw(this.downsample, down[i]);
    }

    let last = down[down.length - 1];
    for (let i = down.length - 2; i >= 0; i--) {
      this.upsample.uniforms.small.value = last.texture;
      this.upsample.uniforms.base.value = down[i].texture;
      this.upsample.uniforms.texel.value.set(1 / last.width, 1 / last.height);
      this.draw(this.upsample, up[i]);
      last = up[i];
    }

    this.composite.uniforms.map.value = this.target.texture;
    this.composite.uniforms.glare.value = last.texture;
    this.draw(this.composite, null);
  }
}
