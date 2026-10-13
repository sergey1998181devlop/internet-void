// Shared, per-frame state of the black hole as seen by the rest of the scene.
// The horizon shader draws a fullscreen quad, so world-space objects need to
// know where the shadow edge sits in screen units (the BH shader uses
// uv = (frag - 0.5*res) / res.y, i.e. uv.y spans -0.5 .. 0.5).
export const hole = {
  horizon: 1.0,
  dist: 21.5,
  fovDeg: 55,
  // critical impact parameter of the shadow edge in world units (= 2.9 * Rs)
  bCrit: 2.9,
  // radius of the shadow in BH-uv units, refreshed every frame
  rim: 0.253,
};

export function updateHole({ horizon, dist, fovDeg }) {
  hole.horizon = horizon;
  if (dist) hole.dist = dist;
  if (fovDeg) hole.fovDeg = fovDeg;
  hole.bCrit = 2.9 * horizon;
  hole.rim = hole.bCrit / (hole.dist * Math.tan((hole.fovDeg * Math.PI) / 360));
  return hole;
}
