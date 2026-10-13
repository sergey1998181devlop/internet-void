import { useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { blackHoleVertex, blackHoleFragment } from '../shaders/blackHole';
import { attachOrbitControls, updateOrbit, orbit } from './orbit';
import { getState } from '../lib/store';
import { updateHole } from './hole';
import { effects, updateEffects, spawnRipple, RIPPLE_SLOTS } from '../lib/effects';
import { secrets, updateSecrets } from '../lib/secrets';
import { rickrollActive, rickrollPulse } from '../lib/rickroll';
import { interstellarActive, interstellarPhase, interstellarElapsed } from '../lib/interstellar';
import { holeGif, loadHoleGif, updateHoleGif } from '../lib/holeGif';
import { dissolve, tickDissolve, renderStable, renderReveal, renderDissolve } from '../lib/stabilize';
import { sky } from '../lib/sky';

// sampler stand-in until the rickroll clip has decoded
const EMPTY_GIF = new THREE.DataTexture(new Uint8Array([0, 0, 0, 1]), 1, 1);
EMPTY_GIF.needsUpdate = true;

export default function BlackHole({ massRef }) {
  const { gl, camera, size } = useThree();

  const uniforms = useMemo(
    () => ({
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3(0, 4, 15) },
      uCamTarget: { value: new THREE.Vector3(0, 0, 0) },
      uFov: { value: THREE.MathUtils.degToRad(55) },
      uHorizon: { value: 1.0 },
      uDiskIn: { value: 2.6 },
      uDiskOut: { value: 9.5 },
      uFlash: { value: 0 },
      uSpin: { value: 0 },
      uRipple: {
        value: Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0, 0, 99, 0)),
      },
      uGlitch: { value: 0 },
      uGlitchSuck: { value: 0 },
      uHiccup: { value: 0 },
      uCompress: { value: 0 },
      uBang: { value: 0 },
      uRetro: { value: 0 },
      uRetroPulse: { value: 0 },
      uGif: { value: EMPTY_GIF },
      uGifMix: { value: 0 },
      uGifAspect: { value: 640 / 480 },
      uDissolve: { value: 0 },
      uStable: { value: 0 },
      uReveal: { value: 1 },
      uSky: { value: null },
      uHasSky: { value: 0 },
    }),
    []
  );

  // the clip is ~6 MB: get it out of the way while the page is still idle
  useEffect(() => {
    const id = setTimeout(loadHoleGif, 3000);
    return () => clearTimeout(id);
  }, []);

  // QA: the live camera, so a test can prove the shake really moves it
  useEffect(() => {
    if (typeof window !== 'undefined') window.__cam = camera;
  }, [camera]);

  useEffect(() => {
    const el = gl.domElement;
    const detach = attachOrbitControls(el);

    // a tap (not a drag) anywhere on the void sends a lensing ripple
    const onUp = (e) => {
      if (orbit.moved > 8) return;
      const rect = el.getBoundingClientRect();
      spawnRipple(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width || 1,
        rect.height || 1
      );
    };
    el.addEventListener('pointerup', onUp);

    return () => {
      detach();
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl]);

  useFrame((state, delta) => {
    updateOrbit(camera);

    // click secret: the singularity rattles the camera while it overloads
    updateSecrets();
    if (secrets.shake > 0) {
      const n = state.clock.elapsedTime;
      const k = secrets.shake;
      camera.position.x +=
        (Math.sin(n * 63.1) * Math.cos(n * 41.7) + 0.5 * Math.sin(n * 127.3)) * 0.55 * k;
      camera.position.y +=
        (Math.sin(n * 57.3) * Math.cos(n * 71.1) + 0.5 * Math.cos(n * 113.9)) * 0.5 * k;
      camera.rotateZ(Math.sin(n * 47.9) * Math.cos(n * 31.7) * 0.05 * k);
    }

    const u = uniforms;
    u.uResolution.value.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
    u.uTime.value = state.clock.elapsedTime;
    u.uCamPos.value.copy(camera.position);
    u.uCamTarget.value.copy(orbit.aim);

    // ARG phase 1: advance the dissolve timeline (burn -> hold -> reveal)
    tickDissolve(delta);
    // the share recorder pins the level of the sacrifice being replayed
    u.uDissolve.value = renderDissolve();
    u.uStable.value = renderStable();
    u.uReveal.value = renderReveal();

    // ARG phase 2: the panorama of the new level (falls back to the
    // procedural starfield until the six faces have decoded)
    if (sky.ready) {
      u.uSky.value = sky.tex;
      u.uHasSky.value = 1;
    }

    // scripted effects advance once per frame
    const e = updateEffects(delta);

    // interstellar show: the three phases reshape the hole itself
    const islPh = interstellarActive() ? interstellarPhase() : 0;
    const islE = interstellarElapsed();
    const islSpin = islPh === 1 ? 2.4 : islPh === 2 ? 1.4 : islPh === 3 ? 0.12 : 1;

    // white hole: the accretion disk runs backwards against the inverted sky;
    // the stabilized void settles into a slow, balanced rotation
    u.uSpin.value +=
      delta * 1.6 * e.spinMult * (1 - 2 * secrets.white) * islSpin * (renderStable() ? 0.45 : 1);
    u.uGlitch.value = e.glitch;
    u.uGlitchSuck.value = e.glitchSuck;
    u.uHiccup.value = secrets.overload;
    u.uCompress.value = e.compress;
    u.uBang.value = e.bang;
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      const r = effects.ripples[i];
      u.uRipple.value[i].set(r.x, r.y, r.age, r.amp);
    }

    // overload: a flat gravitational wave leaves the centre of the frame
    while (secrets.shockNow > 0) {
      secrets.shockNow -= 1;
      const rect = gl.domElement.getBoundingClientRect();
      const w = rect.width || 1;
      const h = rect.height || 1;
      // from where the void sits in frame, not from the geometric centre
      spawnRipple(w / 2, h / 2 + orbit.pan * h, w, h, 3.2);
    }

    // white hole: the whole frame inverts (black space -> blazing white);
    // interstellar phase 3 lays chromatic aberration on top of it
    const cv = gl.domElement;
    const inverted = secrets.white > 0.01;
    let wantFilter = '';
    if (inverted) wantFilter += 'invert(1) hue-rotate(180deg) ';
    if (islPh === 3) wantFilter += 'url(#isl-chroma)';
    wantFilter = wantFilter.trim();
    if (wantFilter !== (cv.__filter || '')) {
      cv.__filter = wantFilter;
      cv.__inv = wantFilter.includes('invert') ? 1 : 0; // debug introspection
      cv.style.transition = 'filter 0.16s ease-out';
      cv.style.filter = wantFilter;
    }

    if (typeof window !== 'undefined') {
      window.__sec = {
        shake: +secrets.shake.toFixed(3),
        hiccup: +u.uHiccup.value.toFixed(3),
        white: +secrets.white.toFixed(3),
        rings: secrets.shock.length,
        msg: secrets.msg ? secrets.msg.text : null,
      };
    }

    // mass grows the horizon: the counter now moves in hundredths of M☉,
    // so the same visual growth costs 100x more dollars than before
    const mass = massRef.current || 0;
    let horizon = 1.0 + Math.min(mass * 0.004, 0.3);

    // rickroll: synthwave palette fades in/out, bass throb rocks the hole
    const retro = rickrollActive();
    const pulse = rickrollPulse();
    u.uRetro.value += ((retro ? 1 : 0) - u.uRetro.value) * Math.min(1, delta * 3);
    u.uRetroPulse.value = pulse;
    if (retro || u.uRetro.value > 0.001) {
      horizon *= 1 + 0.09 * pulse * u.uRetro.value;
      u.uDiskIn.value = 2.6 * (1 + 0.05 * pulse * u.uRetro.value);
      u.uDiskOut.value = 9.5 * (1 + 0.07 * pulse * u.uRetro.value);
    } else {
      u.uDiskIn.value = 2.6;
      u.uDiskOut.value = 9.5;
    }

    // interstellar: phase 1 goes supermassive — stronger lensing, the golden
    // disk flares wide; phases 2-3 keep the swollen hole behind the show
    if (islPh === 1) {
      const ramp = Math.min(1, islE / 4);
      horizon *= 1 + 0.3 * ramp;
      u.uDiskIn.value *= 1 - 0.12 * ramp;
      u.uDiskOut.value *= 1 + 0.55 * ramp;
    } else if (islPh) {
      horizon *= 1.12;
      u.uDiskOut.value *= 1.3;
    }
    u.uHorizon.value = horizon;

    // rickroll: the clip replaces the black interior of the shadow
    if (retro) loadHoleGif();
    const gif = holeGif();
    if (typeof window !== 'undefined') {
      window.__gif = {
        ready: gif.ready,
        frames: gif.frames,
        w: gif.w,
        h: gif.h,
        idx: gif.idx,
        playing: gif.playing,
        err: gif.err || null,
        mix: +u.uGifMix.value.toFixed(3),
        retro: +u.uRetro.value.toFixed(3),
      };
    }
    if (gif.ready) {
      u.uGif.value = gif.texture;
      u.uGifAspect.value = gif.aspect;
      u.uGifMix.value = u.uRetro.value;
      if (retro || u.uRetro.value > 0.001) updateHoleGif(performance.now());
    } else {
      u.uGifMix.value = 0;
    }

    // keep the screen-space shadow edge in sync for the falling objects
    updateHole({ horizon: u.uHorizon.value, dist: camera.position.length(), fovDeg: camera.fov });

    // gamma burst: brightest pending flash wins, then decay
    const pending = getState().flash;
    u.uFlash.value = Math.max(u.uFlash.value, pending);
    if (u.uFlash.value > 0) {
      u.uFlash.value = Math.max(0, u.uFlash.value - delta * 1.35);
    }
  });

  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={blackHoleVertex}
        fragmentShader={blackHoleFragment}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
