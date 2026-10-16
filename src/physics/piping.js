// Pipe sizing for the installation drawing: pick the nominal size of each line from a
// recommended velocity (suction ≈ 1.5 m/s to keep ANPAd up, discharge ≈ 2.5 m/s).
// Inner diameters are Schedule 40 (ASME B36.10), the usual choice for water service.

export const PIPE_SIZES = [
  { dn: 25, nps: '1"', di: 0.0266 }, { dn: 32, nps: '1¼"', di: 0.0351 }, { dn: 40, nps: '1½"', di: 0.0409 },
  { dn: 50, nps: '2"', di: 0.0525 }, { dn: 65, nps: '2½"', di: 0.0627 }, { dn: 80, nps: '3"', di: 0.0779 },
  { dn: 100, nps: '4"', di: 0.1023 }, { dn: 125, nps: '5"', di: 0.1282 }, { dn: 150, nps: '6"', di: 0.1541 },
  { dn: 200, nps: '8"', di: 0.2027 }, { dn: 250, nps: '10"', di: 0.2545 }, { dn: 300, nps: '12"', di: 0.3032 },
  { dn: 350, nps: '14"', di: 0.3334 }, { dn: 400, nps: '16"', di: 0.381 }, { dn: 450, nps: '18"', di: 0.4287 },
  { dn: 500, nps: '20"', di: 0.4778 },
];

export const V_SUCTION = 1.5; // m/s
export const V_DISCHARGE = 2.5; // m/s

/** Velocity (m/s) of flow Q (m³/s) in a pipe of inner diameter di (m). */
export const velocity = (Q, di) => Q / ((Math.PI * di * di) / 4);

/** Smallest standard pipe whose velocity at Q does not exceed vMax. */
export function selectPipe(Q, vMax) {
  return PIPE_SIZES.find((p) => velocity(Q, p.di) <= vMax) ?? PIPE_SIZES[PIPE_SIZES.length - 1];
}

/**
 * Line list for the drawing, sized at the design flow of one pump.
 * @param Qd design flow of one pump (m³/s)
 * @param mode 'single' | 'series' | 'parallel'
 * @returns lines keyed by service with { tag, dn, nps, di, service }
 */
export function lineList(Qd, mode) {
  const total = mode === 'parallel' ? 2 * Qd : Qd;
  const mk = (n, service, Q, v, code) => {
    const p = selectPipe(Q, v);
    return { ...p, service, tag: `${p.nps}-${code}-${String(n).padStart(3, '0')}` };
  };
  const lines = {
    suction: mk(1, 'aspiración', total, V_SUCTION, 'AS'),
    discharge: mk(2, 'descarga', total, V_DISCHARGE, 'DE'),
  };
  if (mode === 'parallel') {
    lines.suctionBranch = mk(3, 'aspiración (ramal)', Qd, V_SUCTION, 'AS');
    lines.dischargeBranch = mk(4, 'descarga (ramal)', Qd, V_DISCHARGE, 'DE');
  }
  if (mode === 'series') lines.between = mk(3, 'entre bombas', Qd, V_DISCHARGE, 'DE');
  return lines;
}
