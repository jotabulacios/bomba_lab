import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterDensity, vaporPressure, atmosphericPressure, fluidState, G } from '../src/physics/fluid.js';
import { buildPump, PRESETS, wiesnerSlip } from '../src/physics/pump.js';
import { DEFAULT_SYSTEM, systemHead, npshAvailable, operatingPoint, cavitationOnset, npshStatus } from '../src/physics/system.js';
import { series, parallel, flowAtHead } from '../src/physics/combine.js';
import { affinity, npshWithSpeed, specificSpeeds, coefficients, impellerType } from '../src/physics/similarity.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const rel = (a, b, r, msg) => close(a, b, Math.abs(b) * r, msg);
const h = (m3h) => m3h / 3600;

// ---------- Fluid ----------
test('water density and vapour pressure match tables', () => {
  close(waterDensity(20), 998.2, 0.3);
  close(waterDensity(4), 1000.0, 0.1);
  close(waterDensity(100), 958.4, 0.6);
  close(vaporPressure(20), 2339, 40);
  close(vaporPressure(100), 101325, 800, 'boils at 100 °C at sea level');
});

test('atmospheric pressure falls with site altitude', () => {
  close(atmosphericPressure(0), 101325, 1);
  close(atmosphericPressure(1000), 89875, 60);
  const f = fluidState(20, 0);
  close(f.Ha, 101325 / (998.2 * G), 0.02, 'about 10.3 m of water');
});

// ---------- Euler ----------
test('Euler head without slip: H_t∞ is a straight line in Q with the notes slope', () => {
  const p = buildPump({ slip: false });
  const s = p.spec;
  const U2 = (Math.PI * s.D2 * s.n) / 60;
  const kb2 = 1 - (s.z * s.t) / (Math.PI * s.D2 * Math.sin((s.beta2 * Math.PI) / 180));
  const slope = -(U2 / Math.tan((s.beta2 * Math.PI) / 180)) / (G * Math.PI * s.D2 * s.b2 * kb2);
  for (const Q of [0, 0.02, 0.05, 0.08]) {
    const r = p.at(Q);
    close(r.HtInf, (U2 * U2) / G + slope * r.Qi, 1e-9, `Q=${Q}`);
    close(r.Htr, r.HtInf, 1e-9, 'no slip: H_TR = H_t∞');
  }
});

test('β2 sets the slope: backward falls, radial is flat, forward rises', () => {
  const slopeFor = (beta2) => {
    const p = buildPump({ beta2, slip: false, Qd: 0.03 });
    const a = p.at(0.01);
    const b = p.at(0.04);
    return (b.HtInf - a.HtInf) / (b.Qi - a.Qi);
  };
  assert.ok(slopeFor(25) < 0);
  close(slopeFor(90), 0, 1e-9);
  assert.ok(slopeFor(120) > 0);
});

test('slip lowers the head; Wiesner factor grows with blade count', () => {
  const withSlip = buildPump({ slip: true }).at(0.03);
  const noSlip = buildPump({ slip: false }).at(0.03);
  assert.ok(withSlip.Htr < withSlip.HtInf);
  close(noSlip.Htr, noSlip.HtInf, 1e-9);
  assert.ok(wiesnerSlip(25, 9) > wiesnerSlip(25, 5));
  assert.ok(wiesnerSlip(25, 7) > 0.75 && wiesnerSlip(25, 7) < 0.9);
});

// ---------- Real curve, efficiencies ----------
test('real head = H_TR − friction − shock; shock loss vanishes at the design flow', () => {
  const p = buildPump();
  for (const Q of [0, 0.02, 0.05, 0.07]) {
    const r = p.at(Q);
    assert.ok(r.H < r.Htr);
    close(r.H, r.Htr - r.hf - r.hi, 1e-9);
  }
  close(p.at(p.spec.Qd).hi, 0, 1e-9, 'shock-free at Q_d');
  close(p.at(p.spec.Qd).incidence, 0, 1e-6, 'zero incidence at Q_d');
  close(p.at(p.spec.Qd).etaH, p.spec.etaHd, 1e-6, 'calibrated ηh');
});

test('η_T = η_h · η_v · η_m and the best-efficiency point sits near the design flow', () => {
  const p = buildPump();
  for (const Q of [0.01, 0.04, 0.06]) {
    const r = p.at(Q);
    close(r.etaT, r.etaH * r.etaV * r.etaM, 1e-9);
  }
  const b = p.bep();
  assert.ok(b.Q > 0.6 * p.spec.Qd && b.Q < 1.1 * p.spec.Qd, `BEP ${b.Q}`);
  assert.ok(b.etaT > 0.7 && b.etaT < 0.9);
  assert.equal(p.at(0).etaT, 0, 'no useful power at shut-off');
});

test('affinity built in: homologous points obey Q ∝ n, H ∝ n², P ∝ n³, same η', () => {
  const p = buildPump();
  const a = p.at(0.04, { n: 1450 });
  const r = 2900 / 1450;
  const b = p.at(0.04 * r, { n: 2900 });
  rel(b.H, a.H * r * r, 1e-9, 'H');
  rel(b.Peje, a.Peje * r ** 3, 1e-9, 'P');
  close(b.etaT, a.etaT, 1e-9, 'η');
  rel(b.NPSHr, a.NPSHr * r * r, 1e-9, 'NPSHr of the model scales with n²');
});

test('trimming the impeller lowers the curve close to the trim laws (≤ 10 %)', () => {
  const p = buildPump();
  const D = p.spec.D2;
  const a = p.at(0.04);
  const pred = affinity({ Q: 0.04, H: a.H }, { n1: 1450, n2: 1450, D1: D, D2: 0.95 * D });
  const b = p.at(pred.Q, { D2: 0.95 * D });
  rel(b.H, pred.H, 0.06, 'model vs trim law');
  assert.ok(b.H < a.H);
});

test('ANPAr grows with flow', () => {
  const p = buildPump();
  let prev = -Infinity;
  for (let Q = 0; Q <= 0.08; Q += 0.01) {
    const r = p.at(Q).NPSHr;
    assert.ok(r > prev);
    prev = r;
  }
});

// ---------- Installation ----------
test('system curve and operating point', () => {
  const p = buildPump();
  const rho = 998.2;
  const sys = { ...DEFAULT_SYSTEM };
  close(systemHead(sys, 0, rho), sys.Hgeo, 1e-12);
  const op = operatingPoint((Q) => p.at(Q).H, sys, rho, p.qMax());
  close(op.H, systemHead(sys, op.Q, rho), 1e-6, 'H_pump = H_system');
  const closed = operatingPoint((Q) => p.at(Q).H, { ...sys, valve: 0.3 }, rho, p.qMax());
  assert.ok(closed.Q < op.Q && closed.H > op.H, 'throttling: less Q, more H');
  assert.equal(operatingPoint((Q) => p.at(Q).H, { ...sys, Hgeo: 200 }, rho, p.qMax()), null, 'cannot lift 200 m');
});

test('ANPAd falls with water temperature, site altitude and suction lift', () => {
  const sys = { ...DEFAULT_SYSTEM };
  const base = npshAvailable(sys, fluidState(20, 0), 0.04);
  assert.ok(npshAvailable(sys, fluidState(80, 0), 0.04) < base);
  assert.ok(npshAvailable(sys, fluidState(20, 2500), 0.04) < base);
  assert.ok(npshAvailable({ ...sys, Hs: -4 }, fluidState(20, 0), 0.04) < base);
  assert.ok(npshAvailable(sys, fluidState(20, 0), 0.06) < base, 'decreases with Q');
});

test('cavitation zone lies to the right of the ANPAd = ANPAr crossing', () => {
  const p = buildPump();
  const fluid = fluidState(85, 0);
  const sys = { ...DEFAULT_SYSTEM, Hs: -3 };
  const qm = p.qMax();
  const q = cavitationOnset((Q) => p.at(Q).NPSHr, sys, fluid, qm);
  assert.ok(q > 0 && q < qm, `onset ${q}`);
  assert.ok(npshAvailable(sys, fluid, q * 0.9) > p.at(q * 0.9).NPSHr);
  assert.ok(npshAvailable(sys, fluid, q * 1.1) < p.at(q * 1.1).NPSHr);
  assert.equal(npshStatus(5, 6), 'cavita');
  assert.equal(npshStatus(10, 7), 'margen-bajo');
  assert.equal(npshStatus(10, 5), 'ok');
});

// ---------- Series / parallel ----------
const single = (p, n) => ({ headAt: (Q) => p.at(Q, { n }).H, qMax: p.qMax({ n }) });

test('series: heads add at the same flow', () => {
  const p = buildPump();
  const a = single(p, 1450);
  const s = series(a, a);
  for (const Q of [0, 0.03, 0.05]) close(s.headAt(Q), 2 * a.headAt(Q), 1e-9);
});

test('parallel: flows add at the same head, but the system gets less than double', () => {
  const p = buildPump();
  const a = single(p, 1450);
  const par = parallel(a, a);
  const Q1 = 0.04;
  close(par.headAt(2 * Q1), a.headAt(Q1), 1e-4, 'same H at double Q');
  const split = par.split(2 * Q1);
  close(split.QA, split.QB, 1e-6);
  const sys = { ...DEFAULT_SYSTEM, Kpipe: 8000 };
  const one = operatingPoint(a.headAt, sys, 998.2, a.qMax);
  const two = operatingPoint(par.headAt, sys, 998.2, par.qMax);
  assert.ok(two.Q > one.Q && two.Q < 2 * one.Q, `${two.Q} vs ${one.Q}`);
});

test('parallel with a weaker pump: it adds nothing above its own shut-off head', () => {
  const p = buildPump();
  const strong = single(p, 1450);
  const weak = single(p, 1100);
  const Hhigh = (weak.headAt(0) + strong.headAt(0)) / 2;
  assert.equal(flowAtHead(weak.headAt, weak.qMax, Hhigh), 0);
  const par = parallel(strong, weak);
  const Q = flowAtHead(strong.headAt, strong.qMax, Hhigh);
  close(par.headAt(Q), Hhigh, 1e-3, 'only the strong pump below that flow');
});

// ---------- Similarity ----------
test('affinity laws reproduce the 1150 → 1750 rpm table of the notes (p. 37)', () => {
  const rows = [[612, 35, 9, 3.5, 931, 81, 32, 7.14], [875, 32, 10, 4.0, 1331, 74, 36, 8.16], [1137, 26, 10.5, 5.0, 1730, 60, 37, 10.2]];
  for (const [Q, H, P, npsh, Q2, H2, P2, npsh2] of rows) {
    const r = affinity({ Q, H, P }, { n1: 1150, n2: 1750 });
    rel(r.Q, Q2, 0.005, 'Q');
    rel(r.H, H2, 0.01, 'H');
    rel(r.P, P2, 0.03, 'P');
    rel(npshWithSpeed(npsh, 1150, 1750), npsh2, 0.01, 'NPSH ∝ n^1.7');
  }
});

test('family affinity uses D³ for Q and D⁵ for P', () => {
  const r = affinity({ Q: 1, H: 1, P: 1 }, { n1: 1, n2: 1, D1: 1, D2: 2, mode: 'family' });
  assert.deepEqual([r.Q, r.H, r.P], [8, 4, 32]);
});

test('specific speed of the Ruhrpumpen guarantee point: slow radial impeller', () => {
  const s = specificSpeeds(1475, h(240), 101.3);
  close(s.ns, 3.65 * 1475 * Math.sqrt(h(240)) / 101.3 ** 0.75, 1e-9);
  assert.ok(s.ns > 40 && s.ns < 47, `ns ${s.ns}`);
  assert.equal(impellerType(s.ns).name, 'Radial lenta');
  assert.equal(impellerType(500).name, 'Flujo mixto');
});

test('dimensionless Ns equals 2π·Φ^½/Ψ^¾ (apunte 08)', () => {
  const { phi, psi } = coefficients(1475, 0.56, h(240), 101.3);
  close(specificSpeeds(1475, h(240), 101.3).Ns, 2 * Math.PI * Math.sqrt(phi) / psi ** 0.75, 1e-12);
});

// ---------- Preset ----------
test('Ruhrpumpen preset follows the test sheet of the notes (p. 48)', () => {
  const p = buildPump(PRESETS.ruhrpumpen);
  const sheet = [[0, 106.3], [102, 106.3], [206, 104.4], [240, 101.5], [302, 92.6]];
  for (const [Qh, H] of sheet) rel(p.at(h(Qh)).H, H, 0.06, `H at ${Qh} m³/h`);
  const g = p.at(h(240));
  rel(g.H, 101.3, 0.015, 'guarantee head');
  close(g.etaT, 0.802, 0.015, 'guarantee efficiency');
  const npshr = g.NPSHr;
  assert.ok(npshr > 2 && npshr < 5, `ANPAr ${npshr} m, like the manufacturer curves (2–5 m)`);
});

// ---------- Pressure along the installation ----------
import { pressureProfile } from '../src/physics/system.js';

test('pressure profile closes at the open discharge tank and steps up by the pump head', () => {
  const p = buildPump();
  const rho = 998.2;
  const sys = { ...DEFAULT_SYSTEM, valve: 0.6 };
  const op = operatingPoint((Q) => p.at(Q).H, sys, rho, p.qMax());
  const pts = Object.fromEntries(pressureProfile(sys, op, [op.H]).map((x) => [x.key, x]));
  close(pts.tank1.p, 0, 1e-12);
  close(pts.tank2.p, 0, 1e-6, 'arrives at atmospheric pressure');
  close(pts.discharge.p - pts.suction.p, op.H, 1e-9, 'pump adds H');
  assert.ok(pts.valveOut.p < pts.valveIn.p, 'valve drops pressure');
  close(pts.suction.p, sys.Hs - sys.Ksuct * op.Q ** 2, 1e-12);
});

test('series: the pressure between the pumps lies between suction and discharge', () => {
  const p = buildPump();
  const a = { headAt: (Q) => p.at(Q).H, qMax: p.qMax() };
  const s = series(a, a);
  const sys = { ...DEFAULT_SYSTEM, Hgeo: 50 };
  const op = operatingPoint(s.headAt, sys, 998.2, s.qMax);
  const split = s.split(op.Q);
  const pts = Object.fromEntries(pressureProfile(sys, op, [split.HA, split.HB], 'series').map((x) => [x.key, x]));
  assert.ok(pts.suction.p < pts.between.p && pts.between.p < pts.discharge.p);
  close(pts.tank2.p, 0, 1e-6);
});
