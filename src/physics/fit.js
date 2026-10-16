// Fit the pump model to measured test points: given Q–H (and optionally η and power) at a
// known speed and number of stages, find an impeller (D2, b2, Q_d) and loss constants
// (ηh, shock ratio, ηm, part-load recirculation, motor efficiency) that reproduce them.
// The blade angle β2, the number of blades z and the inlet proportions are kept from a
// base design; only the sizes scale. Nelder–Mead on bounded parameters (sigmoid
// transform), several restarts. Measured NPSH points then fix the ANPAr coefficients
// λc and λw, which enter linearly: a bounded linear least-squares fit.

import { buildPump, DEFAULT_SPEC } from './pump.js';
import { G } from './fluid.js';

const RHO = 998.2;
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (y) => Math.log(y / (1 - y));
const bounded = (lo, hi) => ({ to: (x) => lo + (hi - lo) * sig(x), from: (v) => logit(Math.min(Math.max((v - lo) / (hi - lo), 1e-6), 1 - 1e-6)) });

/** Nelder–Mead minimisation of f over R^n from x0. */
export function nelderMead(f, x0, { step = 0.5, iters = 800, tol = 1e-10 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += step;
    simplex.push(x);
  }
  let vals = simplex.map(f);
  for (let k = 0; k < iters; k++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol * (1 + Math.abs(vals[0]))) break;
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const along = (t) => c.map((cj, j) => cj + t * (simplex[n][j] - cj));
    const xr = along(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = along(-2);
      const fe = f(xe);
      [simplex[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) {
      [simplex[n], vals[n]] = [xr, fr];
    } else {
      const xc = along(fr < vals[n] ? -0.5 : 0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, vals[n])) [simplex[n], vals[n]] = [xc, fc];
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = f(simplex[i]);
        }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], f: vals[best] };
}

/**
 * Model values comparable with a measured point: power and efficiency are those of the
 * shaft, or of the whole motor + pump when the test measured electrical power. The motor
 * is a constant no-load loss P0 (kW: iron, friction, fan) plus a proportional part.
 */
export function modelAt(pump, Qh, { n, D2, electric, motor = { eta: 1, P0: 0 } }) {
  const r = pump.at(Qh / 3600, { n, D2, rho: RHO });
  const P = electric ? motor.P0 + r.Peje / 1000 / motor.eta : r.Peje / 1000;
  return { H: r.H, P, eta: P > 0 ? r.Pfl / 1000 / P : 0, NPSH: r.NPSHr };
}

// Physical range of the ANPAr coefficients: λc ≥ 1 (the inlet meridional kinetic energy
// is lost at least once); λw covers incipient to 3 % head-drop NPSH (Gülich, Centrifugal Pumps).
export const LAMBDA_BOUNDS = { c: [1, 3], w: [0.05, 1] };

/**
 * λc, λw minimising the relative error of NPSHr = λc·a + λw·b (a = cm1²/2g, b = w1²/2g at
 * each measured flow) within LAMBDA_BOUNDS. With a single point the base ratio λw/λc is kept.
 * @param pump buildPump() result with the fitted geometry
 * @param pts [{ Q m³/h, NPSH m }] at speed n
 */
export function fitLambda(pump, pts, { n, D2 }) {
  const s = pump.spec;
  const rows = pts.map((p) => {
    const a = buildPump({ ...s, lambdaC: 1, lambdaW: 0 }).at(p.Q / 3600, { n, D2, rho: RHO }).NPSHr;
    const b = buildPump({ ...s, lambdaC: 0, lambdaW: 1 }).at(p.Q / 3600, { n, D2, rho: RHO }).NPSHr;
    return { a: a / p.NPSH, b: b / p.NPSH }; // relative residual: λc·a + λw·b − 1
  });
  const [cLo, cHi] = LAMBDA_BOUNDS.c;
  const [wLo, wHi] = LAMBDA_BOUNDS.w;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const sse = (c, w) => rows.reduce((e, r) => e + (c * r.a + w * r.b - 1) ** 2, 0);
  const S = (f) => rows.reduce((t, r) => t + f(r), 0);
  const aa = S((r) => r.a * r.a), bb = S((r) => r.b * r.b), ab = S((r) => r.a * r.b), a1 = S((r) => r.a), b1 = S((r) => r.b);
  const cands = [];
  const det = aa * bb - ab * ab;
  if (rows.length >= 2 && det > 1e-12 * aa * bb) cands.push([(a1 * bb - b1 * ab) / det, (b1 * aa - a1 * ab) / det]);
  else {
    const k = s.lambdaW / s.lambdaC; // keep the base proportion, fit the scale
    const c = S((r) => r.a + k * r.b) / S((r) => (r.a + k * r.b) ** 2);
    cands.push([c, k * c]);
  }
  // On each edge of the box the other coefficient is a 1-D least-squares problem.
  for (const c of [cLo, cHi]) cands.push([c, clamp((b1 - c * ab) / bb, wLo, wHi)]);
  for (const w of [wLo, wHi]) cands.push([clamp((a1 - w * ab) / aa, cLo, cHi), w]);
  const ok = cands.map(([c, w]) => [clamp(c, cLo, cHi), clamp(w, wLo, wHi)]);
  const [lambdaC, lambdaW] = ok.reduce((m, x) => (sse(...x) < sse(...m) ? x : m));
  return { lambdaC, lambdaW };
}

/**
 * @param test { n, stages, power: 'shaft' | 'electric', points: [{ Q m³/h, H m, P? kW, eta?, NPSH? m }],
 *               etaPump?: best efficiency of the pump alone (e.g. from the catalogue), which
 *               splits motor and pump losses when only electrical power was measured }
 * @param base base design to keep β2, z and the proportions from (default: the didactic pump)
 * @returns { spec, motor: { eta, P0 kW }, rms: { H, eta, P, NPSH }, worstH }
 */
export function fitPump(test, base = DEFAULT_SPEC) {
  const pts = test.points.filter((p) => Number.isFinite(p.Q) && Number.isFinite(p.H));
  if (pts.length < 3) throw new Error('Hacen falta al menos 3 puntos con Q y H.');
  const stages = Math.max(1, Math.round(test.stages ?? 1));
  const electric = test.power === 'electric';
  const n = test.n;
  const withEta = pts.filter((p) => Number.isFinite(p.eta) && p.Q > 0);
  const withP = pts.filter((p) => Number.isFinite(p.P));
  const Hmax = Math.max(...pts.map((p) => p.H));
  const Pmax = withP.length ? Math.max(...withP.map((p) => p.P)) : 1;
  const Qmax = Math.max(...pts.map((p) => p.Q));
  // Starting guess: shut-off head per stage ≈ 0.6·U2²/g; design flow near the η peak.
  const H0 = (pts.reduce((a, p) => (p.Q < a.Q ? p : a)).H) / stages;
  const D2g = (60 * Math.sqrt((G * H0) / 0.6)) / (Math.PI * n);
  const etaPeak = withEta.length ? withEta.reduce((a, p) => (p.eta > a.eta ? p : a)) : { Q: 0.7 * Qmax };
  const T = {
    D2: bounded(0.2 * D2g, 3 * D2g),
    b2r: bounded(0.008, 0.2), // b2 / D2
    Qd: bounded(0.15 * Qmax / 3600, 2 * Qmax / 3600),
    etaHd: bounded(0.35, 0.92),
    shock: bounded(0.2, 12),
    etaMd: bounded(0.6, 0.995),
  };
  // Recirculation only shows in the power drawn at part load: fit it when power or η was measured.
  if (withP.length || withEta.length) {
    T.recirc = bounded(0, 1);
    T.recircOnset = bounded(0.3, 1);
  }
  if (electric) {
    T.etaMotor = bounded(0.55, 0.8); // small induction motors; power alone cannot separate motor and pump losses
    T.P0 = bounded(0, 0.8 * Pmax);
  }
  const keys = Object.keys(T);
  const r1 = base.D1 / base.D2;
  const rb1 = base.b1 / base.b2;
  const rt = base.t / base.D2;
  const specOf = (v) => ({
    ...base, name: test.name ?? 'Ensayo propio', n, stages,
    D2: v.D2, b2: v.b2r * v.D2, D1: r1 * v.D2, b1: Math.min(rb1 * v.b2r * v.D2, 0.6 * r1 * v.D2), t: rt * v.D2,
    Qd: v.Qd, etaHd: v.etaHd, shockRatio: v.shock, etaMd: v.etaMd,
    recirc: v.recirc ?? base.recirc, recircOnset: v.recircOnset ?? base.recircOnset,
  });
  const decode = (x) => Object.fromEntries(keys.map((k, i) => [k, T[k].to(x[i])]));
  const cost = (x) => {
    const v = decode(x);
    let pump;
    try { pump = buildPump(specOf(v)); } catch { return 1e6; }
    let e = 0;
    for (const p of pts) {
      const m = modelAt(pump, p.Q, { n, D2: v.D2, electric, motor: { eta: v.etaMotor, P0: v.P0 } });
      if (!Number.isFinite(m.H)) return 1e6;
      e += ((m.H - p.H) / Hmax) ** 2;
      if (Number.isFinite(p.eta) && p.Q > 0) e += 0.5 * ((m.eta - p.eta) / 0.1) ** 2 * 0.1;
      if (Number.isFinite(p.P)) e += 0.5 * ((m.P - p.P) / Pmax) ** 2;
    }
    e /= pts.length;
    if (Number.isFinite(test.etaPump)) e += ((pump.bep({ n, D2: v.D2, rho: RHO }).etaT - test.etaPump) / 0.03) ** 2 * 0.01;
    return e;
  };
  const guess = { D2: D2g, b2r: 0.05, Qd: (1.1 * etaPeak.Q) / 3600, etaHd: 0.8, shock: 3, etaMd: 0.95, recirc: base.recirc, recircOnset: base.recircOnset, etaMotor: 0.8, P0: 0.3 * Pmax };
  let best = { x: keys.map((k) => T[k].from(guess[k])), f: Infinity };
  best.f = cost(best.x);
  for (let restart = 0; restart < 6; restart++) {
    const r = nelderMead(cost, best.x, { step: restart ? 0.3 : 0.8, iters: 900 });
    if (r.f < best.f - 1e-12) best = r; else if (restart > 1) break;
  }
  const v = decode(best.x);
  let spec = specOf(v);
  const withNPSH = pts.filter((p) => Number.isFinite(p.NPSH) && p.NPSH > 0);
  if (withNPSH.length) spec = { ...spec, ...fitLambda(buildPump(spec), withNPSH, { n, D2: v.D2 }) };
  const pump = buildPump(spec);
  const motor = electric ? { eta: v.etaMotor, P0: v.P0 } : { eta: 1, P0: 0 };
  const errs = pts.map((p) => {
    const m = modelAt(pump, p.Q, { n, D2: v.D2, electric, motor });
    return {
      dH: (m.H - p.H) / p.H,
      deta: Number.isFinite(p.eta) && p.Q > 0 ? m.eta - p.eta : null,
      dP: Number.isFinite(p.P) ? (m.P - p.P) / p.P : null,
      dN: Number.isFinite(p.NPSH) && p.NPSH > 0 ? (m.NPSH - p.NPSH) / p.NPSH : null,
    };
  });
  const rms = (a) => (a.length ? Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) : null);
  return {
    spec,
    motor,
    rms: { H: rms(errs.map((e) => e.dH)), eta: rms(errs.filter((e) => e.deta !== null).map((e) => e.deta)), P: rms(errs.filter((e) => e.dP !== null).map((e) => e.dP)), NPSH: rms(errs.filter((e) => e.dN !== null).map((e) => e.dN)) },
    worstH: Math.max(...errs.map((e) => Math.abs(e.dH))),
  };
}
