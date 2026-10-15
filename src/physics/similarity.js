// Similarity (apunte 13 p. 16–20 and 37–38; apunte 08 p. 5–13).

import { G } from './fluid.js';

/**
 * Affinity laws for a homologous point.
 *  - 'trim':   same pump, n and/or impeller trim (apunte 13): Q ∝ n·D, H ∝ n²D², P ∝ n³D³
 *  - 'family': geometrically similar pumps:                     Q ∝ n·D³, H ∝ n²D², P ∝ n³D⁵
 */
export function affinity({ Q, H, P }, { n1, n2, D1 = 1, D2 = 1, mode = 'trim' }) {
  const rn = n2 / n1;
  const rd = D2 / D1;
  const [eq, ep] = mode === 'family' ? [3, 5] : [1, 3];
  return { Q: Q * rn * rd ** eq, H: H * rn ** 2 * rd ** 2, P: P === undefined ? undefined : P * rn ** 3 * rd ** ep };
}

/** NPSH scaling with speed quoted in the notes (apunte 13, p. 37): NPSH ∝ n^1.7. */
export function npshWithSpeed(npsh, n1, n2) {
  return npsh * (n2 / n1) ** 1.7;
}

/**
 * Specific speeds at a point (normally the BEP). Q in m³/s, H in m (per stage), n in rpm.
 *  - ns  = 3.65·n·Q^½/H^¾ (apunte 13; = n·P_CV^½/H^(5/4) for water at η = 1)
 *  - nq  = n·Q^½/H^¾
 *  - Ns  = ω·Q^½/(gH)^¾ with ω in rad/s (dimensionless, apunte 08 / Dixon chart)
 */
export function specificSpeeds(n, Q, H) {
  const nq = (n * Math.sqrt(Q)) / H ** 0.75;
  const omega = (n * 2 * Math.PI) / 60;
  return { ns: 3.65 * nq, nq, Ns: (omega * Math.sqrt(Q)) / (G * H) ** 0.75 };
}

/** Flow and head coefficients of apunte 08: Φ = Q/(N·D³), Ψ = gH/(N·D)², N in rev/s. */
export function coefficients(n, D, Q, H) {
  const N = n / 60;
  return { phi: Q / (N * D ** 3), psi: (G * H) / (N * D) ** 2 };
}

// Impeller type by ns (apunte 13, p. 17).
export const IMPELLER_TYPES = [
  { max: 80, name: 'Radial lenta', d2d1: '2.2–3.5' },
  { max: 150, name: 'Radial normal', d2d1: '1.8–2.2' },
  { max: 365, name: 'Radial rápida', d2d1: '1.3–1.8' },
  { max: 547, name: 'Flujo mixto', d2d1: '1.1–1.3' },
  { max: 1095, name: 'Axial', d2d1: '1' },
];

export function impellerType(ns) {
  return IMPELLER_TYPES.find((t) => ns <= t.max) ?? { ...IMPELLER_TYPES.at(-1), name: 'Axial (fuera de tabla)' };
}
