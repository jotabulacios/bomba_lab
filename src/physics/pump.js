// Centrifugal pump: Euler head with optional finite-blade slip, the two loss terms of the
// course notes (friction ∝ Q² and shock ∝ (Q − Q_shock)²), leakage, mechanical losses and
// a required-NPSH (ANPAr) correlation.
//
// Conventions (apunte 13): stations 1 = impeller inlet, 2 = outlet; c absolute, w
// relative, u blade speed; cm meridional, cu tangential; β measured from the
// peripheral (tangential) direction, so β2 < 90° is a backward-swept blade; no
// pre-swirl (c1u = 0). n in rpm, Q in m³/s, H in m.
//
// The spec describes the pump at its design point (n, Q_d). From it the model
// calibrates, once, the geometric loss constants (k_f, k_i, leakage, disc friction) and
// the inlet blade angle β1 that makes the inlet shock-free at Q_d. Those constants do not
// depend on speed, so the model obeys the affinity laws by construction.

import { G } from './fluid.js';

const RAD = Math.PI / 180;
const RHO_REF = 998.2;

export const DEFAULT_SPEC = {
  name: 'Didáctica',
  n: 1450, // rpm
  Qd: 0.05, // m³/s, shock-free (design) delivered flow
  D2: 0.32, b2: 0.022, beta2: 25, z: 7, t: 0.004,
  D1: 0.13, b1: 0.04,
  etaHd: 0.86, etaVd: 0.96, etaMd: 0.97,
  shockRatio: 3.0, // k_i / k_f (puts the best-efficiency point a little left of Q_d)
  slip: true,
  lambdaC: 1.1, lambdaW: 0.25,
};

/**
 * Pump fitted (bounded least squares on H and η) to the Ruhrpumpen test sheet in the
 * course notes (apunte 13, p. 48): guarantee point 240 m³/h, 101.3 m, 80.2 % at 1475 rpm.
 * It matches H within ≈ 6 % over the sheet and the guarantee point within 1 %; part-load
 * efficiency is higher than the sheet's because recirculation at low flow is not modelled.
 */
export const PRESETS = {
  didactica: { ...DEFAULT_SPEC },
  ruhrpumpen: {
    ...DEFAULT_SPEC, name: 'Ruhrpumpen (hoja de ensayo del apunte)',
    n: 1475, Qd: 0.0944, D2: 0.56, b2: 0.0142, beta2: 15.5, z: 7, t: 0.005,
    D1: 0.17, b1: 0.045, etaHd: 0.802, etaVd: 0.97, etaMd: 0.975, shockRatio: 3.46,
  },
};

/** Wiesner slip factor σ = 1 − √(sin β2) / z^0.7 (β2 from tangential). Not in the notes. */
export function wiesnerSlip(beta2, z) {
  return 1 - Math.sqrt(Math.sin(beta2 * RAD)) / z ** 0.7;
}

function blockage(D, beta, z, t) {
  return 1 - (z * t) / (Math.PI * D * Math.sin(beta * RAD));
}

/**
 * @param spec pump description at its design point (see DEFAULT_SPEC)
 * @returns pump object: at(Q, {n, D2, rho}) and helpers
 */
export function buildPump(spec = {}) {
  const s = { ...DEFAULT_SPEC, ...spec };
  const sigma = s.slip ? wiesnerSlip(s.beta2, s.z) : 1;
  const cot2 = 1 / Math.tan(s.beta2 * RAD);

  const headTR = (Qi, n, D2) => {
    const U2 = (Math.PI * D2 * n) / 60;
    const kb2 = blockage(D2, s.beta2, s.z, s.t);
    const cm2 = Qi / (Math.PI * D2 * s.b2 * kb2);
    return (U2 * (sigma * U2 - cm2 * cot2)) / G;
  };

  // --- Design-point calibration (at s.n, s.D2) ---
  const qd = s.Qd * (1 / s.etaVd - 1);
  const QiD = s.Qd + qd;
  const U1d = (Math.PI * s.D1 * s.n) / 60;
  let kb1 = 1;
  let beta1 = 0;
  // β1 and the inlet blockage depend on each other: iterate, ending on β1 so both agree.
  for (let i = 0; i < 8; i++) {
    beta1 = Math.atan(QiD / (Math.PI * s.D1 * s.b1 * kb1 * U1d)) / RAD;
    kb1 = blockage(s.D1, beta1, s.z, s.t);
  }
  beta1 = Math.atan(QiD / (Math.PI * s.D1 * s.b1 * kb1 * U1d)) / RAD;
  const HtrD = headTR(QiD, s.n, s.D2);
  if (HtrD <= 0) throw new Error('La geometría no da altura positiva en el punto de diseño.');
  const kf = ((1 - s.etaHd) * HtrD) / QiD ** 2;
  const ki = s.shockRatio * kf;
  const cLeak = qd / Math.sqrt(HtrD);
  const PtrD = RHO_REF * G * QiD * HtrD;
  const cMech = ((1 / s.etaMd - 1) * PtrD) / (s.n ** 3 * s.D2 ** 5);

  /**
   * Pump state at delivered flow Q (m³/s), speed n (rpm), outer diameter D2 (m, trimming)
   * and liquid density rho. Heads in m, powers in W, velocities in m/s, angles in degrees.
   */
  function at(Q, { n = s.n, D2 = s.D2, rho = RHO_REF } = {}) {
    const U1 = (Math.PI * s.D1 * n) / 60;
    const U2 = (Math.PI * D2 * n) / 60;
    const Qshock = QiD * (n / s.n); // same inlet geometry: shock-free flow ∝ n
    // Leakage through the wear rings depends on the head it works against.
    let q = qd * (n / s.n);
    for (let i = 0; i < 8; i++) q = cLeak * Math.sqrt(Math.max(headTR(Q + q, n, D2), 0));
    const Qi = Q + q;
    const Htr = headTR(Qi, n, D2);
    const kb2 = blockage(D2, s.beta2, s.z, s.t);
    const cm2 = Qi / (Math.PI * D2 * s.b2 * kb2);
    const HtInf = (U2 * (U2 - cm2 * cot2)) / G;
    const hf = kf * Qi ** 2;
    const hi = ki * (Qi - Qshock) ** 2;
    const H = Htr - hf - hi;

    const cm1 = Qi / (Math.PI * s.D1 * s.b1 * kb1);
    const w1 = Math.hypot(cm1, U1);
    const beta1Flow = Math.atan2(cm1, U1) / RAD;
    const c2u = sigma * U2 - cm2 * cot2;
    const c2 = Math.hypot(cm2, c2u);
    const w2u = U2 - c2u;
    const w2 = Math.hypot(cm2, w2u);
    const c2uInf = U2 - cm2 * cot2;

    const NPSHr = (s.lambdaC * cm1 ** 2 + s.lambdaW * w1 ** 2) / (2 * G);
    const Ptr = rho * G * Qi * Math.max(Htr, 0);
    const Pfl = rho * G * Q * Math.max(H, 0);
    const Pm = cMech * (rho / RHO_REF) * n ** 3 * D2 ** 5;
    const Peje = Ptr + Pm;
    const etaH = Htr > 0 ? Math.max(H, 0) / Htr : 0;
    const etaV = Qi > 0 ? Q / Qi : 0;
    const etaM = Peje > 0 ? Ptr / Peje : 0;
    const etaT = Peje > 0 ? Pfl / Peje : 0;
    // Degree of reaction of the rotor (apunte: σ = Hp/Ht): dynamic part (c2² − c1²)/2g.
    const reaction = Htr > 0 ? 1 - (c2 ** 2 - cm1 ** 2) / (2 * G * Htr) : 0;

    return {
      Q, Qi, q, n, D2, H, Htr, HtInf, hf, hi, Qshock,
      U1, U2, cm1, w1, beta1Flow, incidence: beta1 - beta1Flow,
      cm2, c2u, c2uInf, c2, w2u, w2, alpha2: Math.atan2(cm2, c2u) / RAD,
      NPSHr, Ptr, Pfl, Pm, Peje, etaH, etaV, etaM, etaT, reaction,
    };
  }

  /** Delivered flow where the real head falls to zero (end of the curve). */
  function qMax(opts = {}) {
    let hi = s.Qd * 0.5;
    while (at(hi, opts).H > 0 && hi < s.Qd * 20) hi *= 1.5;
    let lo = 0;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid, opts).H > 0) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Sampled curve from Q = 0 to the zero-head flow. */
  function curve(opts = {}, N = 80) {
    const qm = qMax(opts);
    return Array.from({ length: N + 1 }, (_, i) => at((qm * i) / N, opts));
  }

  /** Best-efficiency point (golden-section search on η_T). */
  function bep(opts = {}) {
    let a = 0;
    let b = qMax(opts);
    const r = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 60; i++) {
      const c = b - r * (b - a);
      const d = a + r * (b - a);
      if (at(c, opts).etaT > at(d, opts).etaT) b = d; else a = c;
    }
    return at((a + b) / 2, opts);
  }

  return {
    spec: s, sigma, beta1, kb1, kf, ki, cLeak, cMech, QiD,
    at, qMax, curve, bep,
    shutoff: (opts) => at(0, opts),
  };
}
