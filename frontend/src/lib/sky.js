// ARG phase 2 — the sky of the new level.
//
// The stabilized void swaps the procedural starfield for a real 360°
// panorama. The equirect source is pre-sliced into the six cube faces
// (`public/cubemap/*.jpg`, WebGL/OpenGL layout with flipY = false) the exact
// way https://github.com/JatinChopra/emissive-dissolve-effect loads its
// `public/cubeMap2` folder: posx, negx, posy, negy, posz, negz.
//
// The texture feeds two places:
//   * `samplerCube uSky` in the black hole shader (the visible background)
//   * `scene.environment` (the relic's chrome reflects the same world)

import * as THREE from 'three';

const FACES = ['posx.jpg', 'negx.jpg', 'posy.jpg', 'negy.jpg', 'posz.jpg', 'negz.jpg'];

export const sky = { tex: null, ready: false, err: false };

let loading = null;

export function loadSky() {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    try {
      const loader = new THREE.CubeTextureLoader();
      loader.setPath('/cubemap/');
      loader.load(
        FACES,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.name = 'phase2-sky';
          sky.tex = tex;
          sky.ready = true;
          resolve(tex);
        },
        undefined,
        () => {
          sky.err = true;
          resolve(null);
        }
      );
    } catch {
      sky.err = true;
      resolve(null);
    }
  });
  return loading;
}

// QA
if (typeof window !== 'undefined') window.__sky = sky;
