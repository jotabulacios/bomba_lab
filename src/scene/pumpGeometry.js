// Shared geometry of the impeller and the volute, used by the detail view (normalised,
// R2 = 1) and the design view (real metres). Angles follow the course notes: β from the
// tangential direction; blades trail the rotation (backward-curved for β < 90°).

import * as THREE from 'three';

const RAD = Math.PI / 180;

/**
 * Blade camber and channel width between r1 and r2 (any length unit).
 * β varies linearly from β1 to β2, b linearly from b1 to b2;
 * θ(r) = −∫ dr / (r·tan β) (trailing the rotation).
 */
export function impellerProfile({ r1, r2, b1, b2, beta1, beta2 }) {
  const lin = (a, b) => (r) => a + ((b - a) * (Math.min(Math.max(r, r1), r2) - r1)) / (r2 - r1);
  const bAt = lin(b1, b2);
  const betaAt = lin(beta1, beta2);
  const N = 48;
  const tab = [[r1, 0]];
  for (let i = 1; i <= N; i++) {
    const ra = r1 + ((r2 - r1) * (i - 1)) / N;
    const rb = r1 + ((r2 - r1) * i) / N;
    const rm = (ra + rb) / 2;
    tab.push([rb, tab[i - 1][1] - (rb - ra) / (rm * Math.tan(betaAt(rm) * RAD))]);
  }
  const thetaAt = (r) => {
    if (r <= r1) return 0;
    const f = Math.min((r - r1) / (r2 - r1), 1) * N;
    const i = Math.min(Math.floor(f), N - 1);
    return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * (f - i);
  };
  return { r1, r2, bAt, betaAt, thetaAt };
}

/** One blade: a thin strip along the camber, extruded from z = 0 to z = b(r). */
export function bladeGeometry(prof, half) {
  const { r1, r2, thetaAt, bAt } = prof;
  const pos = [];
  const idx = [];
  const M = 40;
  const dr = (r2 - r1) * 0.002;
  for (let i = 0; i <= M; i++) {
    const r = r1 + ((r2 - r1) * i) / M;
    const th = thetaAt(r);
    const ra = Math.max(r - dr, r1);
    const rb = Math.min(r + dr, r2);
    const pa = [ra * Math.cos(thetaAt(ra)), ra * Math.sin(thetaAt(ra))];
    const pb = [rb * Math.cos(thetaAt(rb)), rb * Math.sin(thetaAt(rb))];
    const d = [pb[0] - pa[0], pb[1] - pa[1]];
    const L = Math.hypot(...d) || 1;
    const n = [-d[1] / L, d[0] / L];
    const c = [r * Math.cos(th), r * Math.sin(th)];
    const h = bAt(r);
    for (const s of [-1, 1]) for (const z of [0, h]) pos.push(c[0] + s * half * n[0], c[1] + s * half * n[1], z);
  }
  for (let i = 0; i < M; i++) {
    const a = i * 4;
    const b = a + 4;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
    idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
    idx.push(a + 1, b + 1, b + 3, a + 1, b + 3, a + 3);
  }
  idx.push(0, 1, 3, 0, 3, 2);
  const e = M * 4;
  idx.push(e, e + 2, e + 3, e, e + 3, e + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** z blades around the axis as one instanced mesh. */
export function bladeRow(prof, half, z, material) {
  const mesh = new THREE.InstancedMesh(bladeGeometry(prof, half), material, z);
  const m = new THREE.Matrix4();
  for (let i = 0; i < z; i++) mesh.setMatrixAt(i, m.makeRotationZ((i * 2 * Math.PI) / z));
  return mesh;
}

/** Front shroud: lathe that follows b(r) from r1 to r2 (axis = z). */
export function frontShroudGeometry(prof, gap) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const r = prof.r1 + ((prof.r2 - prof.r1) * i) / 24;
    pts.push(new THREE.Vector2(r, prof.bAt(r) + gap));
  }
  const g = new THREE.LatheGeometry(pts, 96);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Volute tube: circular section growing linearly with the wrap angle from ρ0 (tongue,
 * φ = 0 on the +x side) to ρ1, centred at R3 + ρ, plus a straight diffuser that rises to
 * y = yTop (vertical discharge).
 */
export function voluteGeometry({ R3, rho0, rho1, zc, yTop }) {
  const SEG_A = 180;
  const SEG_C = 28;
  const pos = [];
  const idx = [];
  const ring = (cx, cy, ux, uy, rho) => {
    for (let j = 0; j < SEG_C; j++) {
      const t = (j / SEG_C) * Math.PI * 2;
      pos.push(cx + rho * Math.cos(t) * ux, cy + rho * Math.cos(t) * uy, zc + rho * Math.sin(t));
    }
  };
  for (let i = 0; i <= SEG_A; i++) {
    const u = i / SEG_A;
    const phi = u * 2 * Math.PI;
    const rho = rho0 + (rho1 - rho0) * u;
    const rc = R3 + rho;
    ring(rc * Math.cos(phi), rc * Math.sin(phi), Math.cos(phi), Math.sin(phi), rho);
  }
  const DIFF = 12;
  for (let i = 1; i <= DIFF; i++) {
    const v = i / DIFF;
    ring(R3 + rho1, v * yTop, 1, 0, rho1 * (1 + 0.25 * v));
  }
  const rings = SEG_A + 1 + DIFF;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < SEG_C; j++) {
      const a0 = i * SEG_C + j;
      const a1 = i * SEG_C + ((j + 1) % SEG_C);
      idx.push(a0, a0 + SEG_C, a1 + SEG_C, a0, a1 + SEG_C, a1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
