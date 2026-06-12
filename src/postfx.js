import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from '../vendor/jsm/shaders/FXAAShader.js';

// Cinematic post pipeline: HDR scene → bloom → ACES output (tonemap + sRGB) →
// colour grade + vignette → FXAA. Gives a much more "rendered" look without any
// new art assets. Pixel-ratio aware; one knob (quality) keeps phones smooth.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.05 },
    saturation: { value: 1.12 },
    vignette: { value: 0.92 },     // 1 = none, lower = stronger
    warmth: { value: 0.02 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float contrast, saturation, vignette, warmth;
    varying vec2 vUv;
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      c = (c - 0.5) * contrast + 0.5;                 // contrast about mid-grey
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); // saturation
      c = mix(vec3(l), c, saturation);
      c *= vec3(1.0 + warmth, 1.0, 1.0 - warmth);     // gentle warm grade
      vec2 q = vUv - 0.5;                             // vignette
      float v = smoothstep(0.95, vignette, 1.0 - dot(q, q) * 1.6);
      c *= mix(1.0, v, 0.4);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
    }
  `,
};

export function setupPostFX(renderer, scene, camera, quality = 'high') {
  const dbs = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(dbs.x, dbs.y, {
    type: THREE.HalfFloatType, samples: quality === 'high' ? 2 : 0,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(dbs.x, dbs.y),
    quality === 'high' ? 0.62 : 0.5,   // strength
    0.6,                               // radius
    0.55                               // luminance threshold (only bright things glow)
  );
  composer.addPass(bloom);

  composer.addPass(new OutputPass());  // ACES tonemap (reads renderer) + sRGB

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  function setSize(w, h) {
    composer.setSize(w, h);
    const d = renderer.getDrawingBufferSize(new THREE.Vector2());
    bloom.setSize(d.x, d.y);
    fxaa.material.uniforms.resolution.value.set(1 / d.x, 1 / d.y);
  }
  setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight);

  return { composer, bloom, grade, fxaa, setSize, render: (dt) => composer.render(dt) };
}
