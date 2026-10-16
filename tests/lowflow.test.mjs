// Part-load recirculation power and ANPAr fitted to measured NPSH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestCSV } from '../src/physics/csvTest.js';
import { fitPump, fitLambda, modelAt, LAMBDA_BOUNDS } from '../src/physics/fit.js';
import { buildPump, PRESETS } from '../src/physics/pump.js';
import { RUHRPUMPEN_TEST, TP4_TEST, scaledTestPoints } from '../src/physics/testSheet.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);
const rel = (a, b, r, msg) => close(a, b, Math.abs(b) * r, msg);

// ---------- Recirculation ----------
test('shut-off power is within 25 % of both test sheets', () => {
  const R = RUHRPUMPEN_TEST;
  const ruhr = buildPump(PRESETS.ruhrpumpen).at(0, { n: R.n, D2: R.D2, rho: 998.2 });
  rel(ruhr.Peje / 1000, R.points[0].P, 0.25, 'Ruhrpumpen shaft power at Q = 0');
  const T = TP4_TEST;
  const tp4 = modelAt(buildPump(PRESETS.tp4), 0, { n: T.n, D2: T.D2, electric: true, motor: T.motor });
  rel(tp4.P, T.points[0].P, 0.25, 'TP 4 electrical power at Q = 0');
});

test('the Ruhrpumpen power curve follows the sheet at every flow (≤ 3 %)', () => {
  const R = RUHRPUMPEN_TEST;
  const pump = buildPump(PRESETS.ruhrpumpen);
  for (const p of R.points) rel(pump.at(p.Q / 3600, { n: R.n }).Peje / 1000, p.P, 0.03, `Q ${p.Q}`);
  // Without recirculation the shut-off power is a quarter of the measured one.
  const bare = buildPump({ ...PRESETS.ruhrpumpen, recirc: 0 }).at(0, { n: R.n });
  assert.ok(bare.Peje / 1000 < 0.3 * R.points[0].P, `${bare.Peje}`);
});

test('recirculation is largest at shut-off, falls with flow and vanishes past its onset', () => {
  const pump = buildPump();
  const s = pump.spec;
  let prev = Infinity;
  for (let Q = 0; Q < 0.5 * s.Qd; Q += 0.05 * s.Qd) {
    const r = pump.at(Q);
    assert.ok(r.Prec > 0 && r.Prec < prev, `Q ${Q}`);
    prev = r.Prec;
  }
  const past = pump.at(1.01 * s.recircOnset * pump.QiD);
  assert.equal(past.Prec, 0);
  // At shut-off only the leakage flows: close to recirc × the design internal power.
  rel(pump.at(0).Prec, s.recirc * pump.at(s.Qd).Ptr, 0.15, 'shut-off recirculation');
  // It only takes power: head and the useful power are those of the pump without it.
  const bare = buildPump({ ...s, recirc: 0 });
  const a = pump.at(0.2 * s.Qd);
  const b = bare.at(0.2 * s.Qd);
  assert.equal(a.H, b.H);
  close(a.Peje - b.Peje, a.Prec, 1e-9);
  // ηT = ηh·ηv·ηm still holds with recirculation counted in ηm.
  close(a.etaT, a.etaH * a.etaV * a.etaM, 1e-12);
});

test('affinity stays exact with recirculation: P ∝ n³ at homologous part-load points', () => {
  const pump = buildPump(PRESETS.ruhrpumpen);
  const Q = 0.2 * pump.spec.Qd;
  const a = pump.at(Q, { n: 1475 });
  for (const r of [0.5, 0.8, 1.6]) {
    const b = pump.at(Q * r, { n: 1475 * r });
    assert.ok(a.Prec > 0);
    rel(b.Prec, a.Prec * r ** 3, 1e-9, `Prec ×${r}`);
    rel(b.Peje, a.Peje * r ** 3, 1e-9, `Peje ×${r}`);
    rel(b.H, a.H * r * r, 1e-9, `H ×${r}`);
    close(b.etaT, a.etaT, 1e-12);
  }
  // Like disc friction it scales with ρ.
  rel(pump.at(0, { rho: 1200 }).Prec, pump.at(0).Prec * 1200 / 998.2, 1e-12);
});

test('recirculation leaves the best-efficiency point alone', () => {
  const a = buildPump().bep();
  const b = buildPump({ recirc: 0 }).bep();
  close(a.etaT, b.etaT, 1e-6);
});

test('fitPump recovers the shut-off power of a synthetic pump with recirculation', () => {
  const truth = buildPump({ ...PRESETS.didactica, recirc: 0.5, recircOnset: 0.7 });
  const n = PRESETS.didactica.n;
  const points = [0, 40, 80, 120, 160, 200, 240].map((Q) => {
    const r = truth.at(Q / 3600, { n });
    return { Q, H: r.H, eta: r.etaT, P: r.Peje / 1000 };
  });
  const f = fitPump({ n, stages: 1, power: 'shaft', points });
  const fitted = buildPump(f.spec).at(0, { n, D2: f.spec.D2 });
  rel(fitted.Peje, truth.at(0, { n }).Peje, 0.05, 'shut-off power');
  assert.ok(f.rms.P < 0.02, `P rms ${f.rms.P}`);
  assert.equal(f.rms.NPSH, null);
});

// ---------- NPSH ----------
test('CSV: an NPSH column is read under its usual names and units, blanks are skipped', () => {
  for (const name of ['NPSH', 'NPSHr', 'NPSH3', 'ANPA', 'ANPAr', 'npsh_r']) {
    const t = parseTestCSV(`Q [m3/h];H [m];${name} [m]\n10;30;1,5\n20;28;\n30;25;3,2`);
    assert.deepEqual(t.points.map((p) => p.NPSH), [1.5, undefined, 3.2], name);
    assert.ok(t.columns.includes('NPSH'));
  }
  const kpa = parseTestCSV('Q,H,NPSH (kPa)\n1,10,20');
  close(kpa.points[0].NPSH, 20e3 / (998.2 * 9.80665), 1e-9);
  // No NPSH column, no NPSH field.
  assert.equal('NPSH' in parseTestCSV('Q,H\n1,10\n2,9').points[0], false);
  // The TP guide sheet with NPSH3 next to the gauges.
  const tp = parseTestCSV('Q [l/min];Ps [kg/cm2];Pe [mmHg];NPSH3 [m]\n60;1,30;40;1,1');
  close(tp.points[0].NPSH, 1.1, 1e-12);
  close(tp.points[0].H, 1.3 * 10.018 + 40 * 0.01362, 0.02);
});

test('scaled test points carry NPSH with n² and ignore the trim', () => {
  const sheet = { n: 2900, D2: 0.2, points: [{ Q: 10, H: 30, NPSH: 2 }, { Q: 20, H: 25 }] };
  const p = scaledTestPoints(sheet, 1450, 0.18);
  close(p[0].NPSH, 0.5, 1e-12);
  assert.equal(p[1].NPSH, undefined);
});

const syntheticNPSH = (spec, flows) => {
  const truth = buildPump(spec);
  return flows.map((Q) => {
    const r = truth.at(Q / 3600, { n: spec.n });
    return { Q, H: r.H, eta: r.etaT, P: r.Peje / 1000, NPSH: r.NPSHr };
  });
};

test('fitLambda recovers λc and λw exactly when the geometry is known', () => {
  const spec = { ...PRESETS.didactica, lambdaC: 1.35, lambdaW: 0.42 };
  const pts = syntheticNPSH(spec, [60, 120, 180, 240]).map(({ Q, NPSH }) => ({ Q, NPSH }));
  const l = fitLambda(buildPump(PRESETS.didactica), pts, { n: spec.n, D2: spec.D2 });
  close(l.lambdaC, 1.35, 1e-6);
  close(l.lambdaW, 0.42, 1e-6);
});

test('fitLambda stays within its bounds and keeps the base ratio with one point', () => {
  const pump = buildPump(PRESETS.didactica);
  const { n, D2 } = pump.spec;
  const huge = fitLambda(pump, [{ Q: 100, NPSH: 500 }, { Q: 200, NPSH: 900 }], { n, D2 });
  assert.equal(huge.lambdaC, LAMBDA_BOUNDS.c[1]);
  assert.equal(huge.lambdaW, LAMBDA_BOUNDS.w[1]);
  const tiny = fitLambda(pump, [{ Q: 100, NPSH: 0.01 }, { Q: 200, NPSH: 0.02 }], { n, D2 });
  assert.equal(tiny.lambdaC, LAMBDA_BOUNDS.c[0]);
  assert.equal(tiny.lambdaW, LAMBDA_BOUNDS.w[0]);
  // A single point: the model passes through it with λw/λc of the base.
  const target = pump.at(150 / 3600).NPSHr * 1.2;
  const one = fitLambda(pump, [{ Q: 150, NPSH: target }], { n, D2 });
  close(one.lambdaW / one.lambdaC, pump.spec.lambdaW / pump.spec.lambdaC, 1e-9);
  rel(buildPump({ ...pump.spec, ...one }).at(150 / 3600).NPSHr, target, 1e-9);
});

test('fitPump with NPSH points recovers the ANPAr of a synthetic pump', () => {
  const spec = { ...PRESETS.didactica, lambdaC: 1.3, lambdaW: 0.4 };
  const points = syntheticNPSH(spec, [0, 60, 120, 180, 220, 260]);
  points[0].NPSH = undefined; // not measured at shut-off
  const f = fitPump({ n: spec.n, stages: 1, power: 'shaft', points });
  assert.ok(f.rms.NPSH < 0.03, `NPSH rms ${f.rms.NPSH}`);
  assert.ok(f.worstH < 0.01, `worst H ${f.worstH}`);
  const fitted = buildPump(f.spec);
  for (const Q of [100, 200, 280]) rel(fitted.at(Q / 3600).NPSHr, buildPump(spec).at(Q / 3600).NPSHr, 0.05, `Q ${Q}`);
  // Without NPSH points the base λ are kept.
  const g = fitPump({ n: spec.n, stages: 1, power: 'shaft', points: points.map(({ NPSH, ...p }) => p) });
  assert.equal(g.spec.lambdaC, PRESETS.didactica.lambdaC);
  assert.equal(g.rms.NPSH, null);
});
