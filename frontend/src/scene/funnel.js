import * as THREE from 'three';

// Cinematic suction for the hero card.
//
// The sheet stays a plain mesh-basic card (map, opacity, toneMapped off) — we
// only splice a deformation into it through onBeforeCompile:
//   * the centre is dragged toward the hole (the card's -Z faces it) -> funnel
//   * the surface winds into a spiral that bites hardest at the centre
//   * the whole sheet pinches into a thread and shreds apart at the horizon
// All of it runs in the shader, so a 32x32 plane is enough to read as cloth.

export function funnelUniforms() {
  return {
    uSize: { value: new THREE.Vector2(1, 1) }, // world size of the sheet
    uFunnel: { value: 0 }, // depth of the cone toward the hole (world units)
    uTwist: { value: 0 }, // radians wound into the sheet
    uPinch: { value: 0 }, // 0..1 collapse into a thread
    uDissolve: { value: 0 }, // 0..1 shredded fade
  };
}

const PARS_V = /* glsl */ `
varying vec2 vFunnelUv;
uniform vec2 uSize;
uniform float uFunnel;
uniform float uTwist;
uniform float uPinch;
`;

const BODY_V = /* glsl */ `
  vFunnelUv = uv;
  {
    vec2 sz = max(uSize, vec2(1e-3));
    vec2 fq = transformed.xy * sz;          // world units, so the collapse is round
    float sr = length(fq);
    float rn = clamp(sr / max(0.5 * length(sz), 1e-4), 0.0, 1.0);

    // log spiral: the middle winds up far harder than the rim
    float sa = sr > 1e-5 ? atan(fq.y, fq.x) : 0.0;
    sa -= uTwist * (0.30 + 1.7 * (1.0 - rn));
    fq = vec2(cos(sa), sin(sa)) * sr;

    // pinch into a thread and draw it out along its own axis
    fq *= mix(1.0, 0.07, uPinch);
    fq.x *= 1.0 + 3.0 * uPinch;

    transformed.xy = fq / sz;
    // the middle is dragged toward the hole (-Z of the card faces it)
    transformed.z -= uFunnel * pow(1.0 - rn, 1.5);
  }
`;

const PARS_F = /* glsl */ `
varying vec2 vFunnelUv;
uniform float uDissolve;
`;

const BODY_F = /* glsl */ `
  if (uDissolve > 0.001) {
    // strands running along the thread, eaten away from the rim inward
    vec2 cell = floor(vFunnelUv * vec2(44.0, 170.0));
    float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float thr = uDissolve;
    float keep = smoothstep(thr - 0.14, thr, n);
    float edge = smoothstep(thr - 0.22, thr - 0.06, n) *
                 (1.0 - smoothstep(thr - 0.06, thr + 0.06, n));
    diffuseColor.a *= keep;
    diffuseColor.rgb += vec3(1.5, 0.8, 0.34) * edge * 0.9;
  }
`;

// both hero materials share one uniform block, so a single write drives them
export function applyFunnel(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSize = uniforms.uSize;
    shader.uniforms.uFunnel = uniforms.uFunnel;
    shader.uniforms.uTwist = uniforms.uTwist;
    shader.uniforms.uPinch = uniforms.uPinch;
    shader.uniforms.uDissolve = uniforms.uDissolve;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS_V}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BODY_V}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS_F}`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n${BODY_F}`);
  };
  material.needsUpdate = true;
  return material;
}
