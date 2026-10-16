import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triangulate, latheSolid, casingSolid, casingProfile, bladeSolid, loftSolid, isClosedOriented, signedVolume } from '../src/scene/solids.js';

const casing = { R3: 1.07, rho0: 0.05, rho1: 0.32, zb: -0.08, zf1: 0.16, zf2: 0.14, rN: 0.42, zN: 0.9, rS: 0.13, zS: -0.5, tw: 0.05 };

test('triangulate: an L-shaped (non-convex) polygon gives n − 2 triangles covering its area', () => {
  const L = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
  const tris = triangulate(L);
  assert.equal(tris.length, L.length - 2);
  const area = tris.reduce((s, [a, b, c]) => {
    const [p, q, r] = [L[a], L[b], L[c]];
    return s + ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
  }, 0);
  assert.ok(Math.abs(area - 3) < 1e-12, `area ${area}`); // same sign as the input (CCW)
});

test('latheSolid of a rectangle is closed and has the volume of a ring', () => {
  const [r0, r1, h] = [0.5, 1, 0.3];
  const m = latheSolid([[r0, 0], [r1, 0], [r1, h], [r0, h]], 256);
  assert.ok(isClosedOriented(m));
  const V = Math.abs(signedVolume(m));
  const exact = Math.PI * (r1 * r1 - r0 * r0) * h;
  assert.ok(Math.abs(V - exact) / exact < 1e-3, `${V} vs ${exact}`);
});

test('casing profile is a simple polygon that wraps the volute and both walls', () => {
  const p = casingProfile({ ...casing, rho: 0.2 });
  // Front inner face at the eye, back inner face at the shaft, volute outside R3.
  assert.deepEqual(p[0], [casing.rN, casing.zN]);
  assert.ok(Math.max(...p.map((q) => q[0])) > casing.R3 + 2 * 0.2);
  assert.ok(Math.min(...p.map((q) => q[1])) < casing.zS + 1e-12);
});

test('casingSolid is watertight and consistently oriented (needed for stencil caps)', () => {
  const m = casingSolid(casing, 60);
  assert.ok(isClosedOriented(m));
  assert.ok(Math.abs(signedVolume(m)) > 0);
});

test('the volute section grows with the wrap angle', () => {
  const small = casingProfile({ ...casing, rho: casing.rho0 });
  const big = casingProfile({ ...casing, rho: casing.rho1 });
  const rMax = (p) => Math.max(...p.map((q) => q[0]));
  assert.ok(rMax(big) > rMax(small) + 0.3);
});

test('bladeSolid is closed for a backward-curved blade', () => {
  const prof = { r1: 0.4, r2: 1, thetaAt: (r) => -1.2 * (r - 0.4), bAt: (r) => 0.2 - 0.1 * (r - 0.4) };
  const m = bladeSolid(prof, 0.01);
  assert.ok(isClosedOriented(m));
});

test('isClosedOriented rejects an open mesh and a flipped face', () => {
  const ring = (z) => [[0, 0, z], [1, 0, z], [1, 1, z], [0, 1, z]];
  const box = loftSolid([ring(0), ring(1)]);
  assert.ok(isClosedOriented(box));
  const open = { pos: box.pos, idx: box.idx.slice(0, -6) };
  assert.equal(isClosedOriented(open), false);
  const flipped = { pos: box.pos, idx: [...box.idx] };
  [flipped.idx[0], flipped.idx[1]] = [flipped.idx[1], flipped.idx[0]];
  assert.equal(isClosedOriented(flipped), false);
});
