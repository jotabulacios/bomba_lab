import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestCSV } from '../src/physics/csvTest.js';
import { fitPump, modelAt, nelderMead } from '../src/physics/fit.js';
import { buildPump, PRESETS } from '../src/physics/pump.js';
import { TP4_TEST } from '../src/physics/testSheet.js';

test('nelderMead finds the minimum of a shifted quadratic', () => {
  const r = nelderMead(([x, y]) => (x - 1) ** 2 + 3 * (y + 2) ** 2, [0, 0]);
  assert.ok(Math.abs(r.x[0] - 1) < 1e-4 && Math.abs(r.x[1] + 2) < 1e-4);
});

test('CSV in the TP guide layout: Ps + Pe give H, V·I·cos φ gives electrical power', () => {
  const csv = 'Q [l/min];Ps [kg/cm2];Pe [mmHg];V [v];I[A];Cosφ\n0;1,80;0;221,2;1,403;0,990\n60;1,30;40;221;2,1;0,99';
  const t = parseTestCSV(csv);
  assert.equal(t.power, 'electric');
  assert.equal(t.points.length, 2);
  assert.ok(Math.abs(t.points[0].H - 1.8 * 10.018) < 0.02, `H ${t.points[0].H}`);
  assert.ok(Math.abs(t.points[1].H - (1.3 * 10.018 + 40 * 0.01362)) < 0.02);
  assert.ok(Math.abs(t.points[0].P - 0.2212 * 1.403 * 0.99) < 1e-4); // the TP 4 first row: 307 W
  assert.ok(Math.abs(t.points[1].Q - 3.6) < 1e-12);
  assert.ok(t.points[1].eta > 0 && t.points[1].eta < 1);
});

test('CSV processed layout with other units (l/s, kPa, %, kW)', () => {
  const csv = 'caudal (l/s),altura (kPa),P2 (kW),eta (%)\n10,300,4.5,65\n0,350,2.0,0';
  const t = parseTestCSV(csv);
  assert.equal(t.power, 'shaft');
  assert.equal(t.points[0].Q, 0); // sorted by flow
  assert.ok(Math.abs(t.points[1].Q - 36) < 1e-9);
  assert.ok(Math.abs(t.points[1].H - 300e3 / (998.2 * 9.80665)) < 1e-6);
  assert.equal(t.points[1].eta, 0.65);
  assert.equal(t.points[1].P, 4.5);
});

test('CSV: a speed column is not mistaken for power; missing columns are reported', () => {
  const t = parseTestCSV('Q,H,n [rpm]\n1,10,2900\n2,9,2900');
  assert.equal(t.points[0].P, undefined);
  assert.throws(() => parseTestCSV('H,P\n1,2'), /caudal/);
  assert.throws(() => parseTestCSV('Q\n1'), /encabezado|altura/);
});

test('fitPump recovers a synthetic pump from its own curve (H within 1 %)', () => {
  const truth = buildPump(PRESETS.didactica);
  const n = PRESETS.didactica.n;
  const points = [0, 60, 120, 180, 220, 260].map((Q) => {
    const r = truth.at(Q / 3600, { n });
    return { Q, H: r.H, eta: r.etaT, P: r.Peje / 1000 };
  });
  const f = fitPump({ n, stages: 1, power: 'shaft', points });
  assert.ok(f.worstH < 0.01, `worst H ${f.worstH}`);
  assert.ok(f.rms.eta < 0.02, `η rms ${f.rms.eta}`);
});

test('the TP 4 preset (fitted, two stages, electrical power) reproduces the lab test', () => {
  const pump = buildPump(PRESETS.tp4);
  for (const p of TP4_TEST.points) {
    const m = modelAt(pump, p.Q, { n: TP4_TEST.n, D2: PRESETS.tp4.D2, electric: true, motor: TP4_TEST.motor });
    assert.ok(Math.abs(m.H - p.H) / p.H < 0.04, `H at ${p.Q}: ${m.H} vs ${p.H}`);
    if (p.Q > 0) assert.ok(Math.abs(m.eta - p.eta) < 0.03, `η at ${p.Q}: ${m.eta} vs ${p.eta}`);
    assert.ok(Math.abs(m.P - p.P) / p.P < 0.06, `P at ${p.Q}: ${m.P} vs ${p.P}`);
  }
  // The pump alone peaks near the catalogue's ≈ 50 %.
  const bep = pump.bep({ n: TP4_TEST.n });
  assert.ok(Math.abs(bep.etaT - TP4_TEST.etaPump) < 0.02, `pump η ${bep.etaT}`);
});

test('stages multiply head and power, not velocities or ANPAr', () => {
  const one = buildPump({ ...PRESETS.tp4, stages: 1 }).at(0.001);
  const two = buildPump(PRESETS.tp4).at(0.001);
  assert.ok(Math.abs(two.H - 2 * one.H) < 1e-9);
  assert.ok(Math.abs(two.Peje - 2 * one.Peje) < 1e-9);
  assert.equal(two.NPSHr, one.NPSHr);
  assert.equal(two.etaT, one.etaT);
});
