import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUHRPUMPEN_TEST, scaledTestPoints, guaranteeCheck } from '../src/physics/testSheet.js';
import { buildPump, PRESETS } from '../src/physics/pump.js';

const T = RUHRPUMPEN_TEST;

test('test points at the homologation speed are the sheet values', () => {
  const p = scaledTestPoints(T, T.n);
  p.forEach((q, i) => {
    assert.ok(Math.abs(q.Q - T.points[i].Q) < 1e-9);
    assert.ok(Math.abs(q.H - T.points[i].H) < 1e-9);
  });
});

test('scaled test points follow the affinity laws (half speed: Q/2, H/4, P/8, same η)', () => {
  const p = scaledTestPoints(T, T.n / 2);
  const s = T.points[3];
  assert.ok(Math.abs(p[3].Q - s.Q / 2) < 1e-9);
  assert.ok(Math.abs(p[3].H - s.H / 4) < 1e-9);
  assert.ok(Math.abs(p[3].P - s.P / 8) < 1e-9);
  assert.equal(p[3].eta, s.eta);
});

test('the sheet is consistent: η = ρgQH / P within 2 points at every flow', () => {
  for (const p of T.points.filter((q) => q.Q > 0)) {
    const eta = (998 * 9.80665 * (p.Q / 3600) * p.H) / (p.P * 1000);
    assert.ok(Math.abs(eta - p.eta) < 0.02, `Q ${p.Q}: ${eta.toFixed(3)} vs ${p.eta}`);
  }
});

test('the Ruhrpumpen model passes the HI 2B guarantee box and stays near the measured heads', () => {
  const pump = buildPump(PRESETS.ruhrpumpen);
  const opts = { n: T.n, D2: T.D2, rho: 998 };
  const headAt = (Qh) => pump.at(Qh / 3600, opts).H;
  const g = guaranteeCheck(T, headAt);
  assert.ok(g.inBox, `H at guarantee ${g.H}`);
  // The model rises a little too much at part load (+7 % at 101 m³/h, no recirculation).
  for (const p of T.points) assert.ok(Math.abs(headAt(p.Q) - p.H) / p.H < 0.075, `Q ${p.Q}`);
});

test('guaranteeCheck rejects a curve far below the box', () => {
  assert.equal(guaranteeCheck(T, () => 80).inBox, false);
  assert.equal(guaranteeCheck(T, () => 101).inBox, true);
});
