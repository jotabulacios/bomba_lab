import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIPE_SIZES, selectPipe, velocity, lineList, V_SUCTION, V_DISCHARGE } from '../src/physics/piping.js';

test('selected pipe keeps velocity under the limit and is the smallest that does', () => {
  for (const Qh of [10, 50, 180, 400, 900]) {
    const Q = Qh / 3600;
    for (const v of [V_SUCTION, V_DISCHARGE]) {
      const p = selectPipe(Q, v);
      const i = PIPE_SIZES.indexOf(p);
      if (i < PIPE_SIZES.length - 1) assert.ok(velocity(Q, p.di) <= v, `${Qh} m³/h → DN${p.dn}`);
      if (i > 0) assert.ok(velocity(Q, PIPE_SIZES[i - 1].di) > v, `DN${PIPE_SIZES[i - 1].dn} would be enough`);
    }
  }
});

test('suction is never smaller than discharge (lower velocity limit)', () => {
  for (const Qh of [30, 180, 500]) {
    const l = lineList(Qh / 3600, 'single');
    assert.ok(l.suction.dn >= l.discharge.dn);
    assert.match(l.suction.tag, /-AS-001$/);
    assert.match(l.discharge.tag, /-DE-002$/);
  }
});

test('parallel: headers carry twice the flow of the branches', () => {
  const l = lineList(180 / 3600, 'parallel');
  assert.ok(l.suction.dn >= l.suctionBranch.dn);
  assert.ok(l.discharge.dn >= l.dischargeBranch.dn);
  assert.ok(lineList(180 / 3600, 'series').between);
});

test('180 m³/h of water: about 8" suction and 6" discharge', () => {
  const l = lineList(180 / 3600, 'single');
  assert.equal(l.suction.dn, 250);
  assert.equal(l.discharge.dn, 200);
  assert.ok(velocity(0.05, 0.2027) < V_DISCHARGE);
});
