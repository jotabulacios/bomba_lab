// Fit the pump model to measured test points: given Q–H (and optionally η and power) at a
// known speed and number of stages, find an impeller (D2, b2, Q_d) and loss constants
// (ηh, shock ratio, ηm, motor efficiency) that reproduce them. The blade angle β2, the
// number of blades z and the inlet proportions are kept from a base design; only the
// sizes scale. Nelder–Mead on bounded parameters (sigmoid transform), several restarts.

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
  return { H: r.H, P, eta: P > 0 ? r.Pfl / 1000 / P : 0 };
}

/**
 * @param test { n, stages, power: 'shaft' | 'electric', points: [{ Q m³/h, H m, P? kW, eta? }],
 *               etaPump?: best efficiency of the pump alone (e.g. from the catalogue), which
 *               splits motor and pump losses when only electrical power was measured }
 * @param base base design to keep β2, z and the proportions from (default: the didactic pump)
 * @returns { spec, motor: { eta, P0 kW }, rms: { H, eta, P }, worstH }
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
  const guess = { D2: D2g, b2r: 0.05, Qd: (1.1 * etaPeak.Q) / 3600, etaHd: 0.8, shock: 3, etaMd: 0.95, etaMotor: 0.8, P0: 0.3 * Pmax };
  let best = { x: keys.map((k) => T[k].from(guess[k])), f: Infinity };
  best.f = cost(best.x);
  for (let restart = 0; restart < 6; restart++) {
    const r = nelderMead(cost, best.x, { step: restart ? 0.3 : 0.8, iters: 900 });
    if (r.f < best.f - 1e-12) best = r; else if (restart > 1) break;
  }
  const v = decode(best.x);
  const spec = specOf(v);
  const pump = buildPump(spec);
  const motor = electric ? { eta: v.etaMotor, P0: v.P0 } : { eta: 1, P0: 0 };
  const errs = pts.map((p) => {
    const m = modelAt(pump, p.Q, { n, D2: v.D2, electric, motor });
    return { dH: (m.H - p.H) / p.H, deta: Number.isFinite(p.eta) && p.Q > 0 ? m.eta - p.eta : null, dP: Number.isFinite(p.P) ? (m.P - p.P) / p.P : null };
  });
  const rms = (a) => (a.length ? Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) : null);
  return {
    spec,
    motor,
    rms: { H: rms(errs.map((e) => e.dH)), eta: rms(errs.filter((e) => e.deta !== null).map((e) => e.deta)), P: rms(errs.filter((e) => e.dP !== null).map((e) => e.dP)) },
    worstH: Math.max(...errs.map((e) => Math.abs(e.dH))),
  };
}
