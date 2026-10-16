// Closed, consistently oriented triangle meshes for the section view. A cut is filled
// with stencil capping, which only works on watertight solids, so every part that can be
// cut (casing, shrouds, hub, blades, wear ring) is built here as a loft of rings with
// capped ends. Pure JS (no three.js) so the tests can check closure and orientation.

/**
 * Loft through rings of points (each ring the same length, a closed polygon).
 * @param rings [[[x,y,z], ...], ...]
 * @param wrap  true: the last ring joins the first (a full revolution, no end caps)
 * @returns { pos: Float32Array-ready number[], idx: number[] }
 */
export function loftSolid(rings, wrap = false) {
  const M = rings[0].length;
  const N = rings.length;
  const pos = [];
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  const idx = [];
  const v = (i, j) => (i % N) * M + (j % M);
  const spans = wrap ? N : N - 1;
  for (let i = 0; i < spans; i++) {
    for (let j = 0; j < M; j++) {
      const a = v(i, j);
      const b = v(i + 1, j);
      const c = v(i + 1, j + 1);
      const d = v(i, j + 1);
      idx.push(a, b, c, a, c, d);
    }
  }
  if (!wrap) {
    // Cap at ring 0 runs with increasing j, at the last ring with decreasing j, so every
    // boundary edge is shared by two faces in opposite directions.
    for (const [a, b, c] of triangulate(rings[0])) idx.push(v(0, a), v(0, b), v(0, c));
    for (const [a, b, c] of triangulate(rings[N - 1])) idx.push(v(N - 1, c), v(N - 1, b), v(N - 1, a));
  }
  return { pos, idx };
}

/** Ear-clipping triangulation of a planar 3-D polygon; triangles keep the input order. */
export function triangulate(poly) {
  // Newell normal → drop the dominant axis to work in 2-D.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const [u, w] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
  const pts = poly.map((p) => [p[u], p[w]]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sgn = Math.sign(area) || 1;
  const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sgn;
  const inside = (p, a, b, c) => cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;
  const rest = pts.map((_, i) => i);
  const tris = [];
  let guard = 0;
  while (rest.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < rest.length; k++) {
      const i0 = rest[(k + rest.length - 1) % rest.length];
      const i1 = rest[k];
      const i2 = rest[(k + 1) % rest.length];
      const [a, b, c] = [pts[i0], pts[i1], pts[i2]];
      if (cross(a, b, c) <= 1e-14) continue;
      if (rest.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c))) continue;
      tris.push([i0, i1, i2]);
      rest.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate leftovers (collinear points): fan them so the cap stays closed.
      tris.push([rest[0], rest[1], rest[2]]);
      rest.splice(1, 1);
    }
  }
  if (rest.length === 3) tris.push([rest[0], rest[1], rest[2]]);
  return tris;
}

/** Revolve a closed (r, z) profile around the z axis between two angles. */
export function revolveRings(profileAt, phi0, phi1, n) {
  const rings = [];
  for (let i = 0; i <= n; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / n;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    rings.push(profileAt(phi, i / n).map(([r, z]) => [r * c, r * s, z]));
  }
  return rings;
}

/** Full solid of revolution (closed (r, z) profile, r > 0). */
export function latheSolid(profile, n = 96) {
  const rings = revolveRings(() => profile, 0, 2 * Math.PI, n);
  rings.pop(); // the last ring equals the first; wrap instead
  return loftSolid(rings, true);
}

/**
 * Meridional wall profile of the casing at one wrap angle, as a closed (r, z) polygon:
 * suction nozzle, front wall over the impeller, the volute (a circle of radius ρ open
 * towards the impeller), back wall and stuffing box. All lengths in the same unit.
 * @param c { rho, R3, zb, zf1, zf2, rN, zN, rS, zS, tw, arcN }
 */
export function casingProfile(c) {
  const zc = (c.zb + c.zf2) / 2;
  const half = (c.zf2 - c.zb) / 2;
  const rho = Math.max(c.rho, half * 1.03);
  const rc = c.R3 + rho;
  const arc = (R, t0, t1, n) => Array.from({ length: n + 1 }, (_, k) => {
    const t = t0 + ((t1 - t0) * k) / n;
    return [rc + R * Math.cos(t), zc + R * Math.sin(t)];
  });
  const n = c.arcN ?? 24;
  const tIn = Math.asin(half / rho);
  const tOut = Math.asin((half + c.tw) / (rho + c.tw));
  const tws = c.tw * 1.4; // stuffing box wall
  return [
    [c.rN, c.zN], // suction nozzle, inner, at the flange
    [c.rN, c.zf1], // front wall, inner, at the eye
    ...arc(rho, Math.PI - tIn, -Math.PI + tIn, n), // volute, inner, front → round → back
    [c.rS, c.zb], // back wall, inner, at the shaft
    [c.rS, c.zS], // stuffing box bore
    [c.rS + tws, c.zS],
    [c.rS + tws, c.zb - c.tw],
    ...arc(rho + c.tw, -Math.PI + tOut, Math.PI - tOut, n), // volute, outer, back → round → front
    [c.rN + c.tw, c.zf1 + c.tw],
    [c.rN + c.tw, c.zN],
  ];
}

/**
 * Volute casing swept over the full wrap (ρ grows linearly from ρ0 to ρ1). It stops a
 * hair short of 2π so the two end walls at the tongue never share vertices: each end
 * stays a closed solid and the coincident walls cancel in the stencil count.
 */
export function casingSolid(c, n = 120) {
  const rings = revolveRings((phi, u) => casingProfile({ ...c, rho: c.rho0 + (c.rho1 - c.rho0) * u }), 0, 2 * Math.PI - 1e-4, n);
  return loftSolid(rings, false);
}

/**
 * One blade as a closed solid: a quadrilateral section (thickness 2·half × height b(r))
 * lofted along the camber θ(r) from r1 to r2.
 */
export function bladeSolid(prof, half, M = 40) {
  const { r1, r2, thetaAt, bAt } = prof;
  const dr = (r2 - r1) * 0.002;
  const rings = [];
  for (let i = 0; i <= M; i++) {
    const r = r1 + ((r2 - r1) * i) / M;
    const ra = Math.max(r - dr, r1);
    const rb = Math.min(r + dr, r2);
    const pa = [ra * Math.cos(thetaAt(ra)), ra * Math.sin(thetaAt(ra))];
    const pb = [rb * Math.cos(thetaAt(rb)), rb * Math.sin(thetaAt(rb))];
    const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
    const nrm = [-(pb[1] - pa[1]) / L, (pb[0] - pa[0]) / L];
    const th = thetaAt(r);
    const c = [r * Math.cos(th), r * Math.sin(th)];
    const h = bAt(r);
    const P = (s, z) => [c[0] + s * half * nrm[0], c[1] + s * half * nrm[1], z];
    rings.push([P(-1, 0), P(1, 0), P(1, h), P(-1, h)]);
  }
  return loftSolid(rings, false);
}

/**
 * Check that a mesh is closed and consistently oriented: after merging coincident
 * vertices, every directed edge appears once and its reverse once.
 */
export function isClosedOriented({ pos, idx }, eps = 1e-7) {
  const key = (i) => `${Math.round(pos[3 * i] / eps)},${Math.round(pos[3 * i + 1] / eps)},${Math.round(pos[3 * i + 2] / eps)}`;
  const ids = new Map();
  const id = (i) => {
    const k = key(i);
    if (!ids.has(k)) ids.set(k, ids.size);
    return ids.get(k);
  };
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const v = [id(idx[t]), id(idx[t + 1]), id(idx[t + 2])];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue; // degenerate sliver
    for (let k = 0; k < 3; k++) {
      const e = `${v[k]}>${v[(k + 1) % 3]}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const [e, n] of edges) {
    if (n !== 1) return false;
    const [a, b] = e.split('>');
    if (edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

/** Signed volume (divergence theorem); its sign tells the orientation. */
export function signedVolume({ pos, idx }) {
  let V = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return V;
}
