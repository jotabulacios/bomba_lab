// Performance test sheet of the Ruhrpumpen pump in the course notes (apunte 13, p. 48):
// "Ensayo de performance" N° 152600118-01, 30/8/2019, results homologated to 1475 rpm,
// acceptance per Hydraulic Institute 2016 grade 2B. Used to overlay the measured points on
// the model curves and to check the guarantee point against the tolerance band.

import { affinity } from './similarity.js';

const CV = 0.73549875; // kW per metric horsepower (CV)

export const RUHRPUMPEN_TEST = {
  title: 'Ensayo de performance Ruhrpumpen N° 152600118-01 (30/8/2019)',
  source: 'apunte 13, p. 48',
  n: 1475, // rpm the results are homologated to
  D2: 0.56, // m
  // Q (m³/h), H (m), P shaft (kW), η (fraction), homologated columns of the sheet.
  points: [
    { Q: 0, H: 103.3, P: 47.1 * CV, eta: 0 },
    { Q: 101, H: 103.6, P: 72.4 * CV, eta: 0.533 },
    { Q: 203, H: 102.1, P: 102.2 * CV, eta: 0.746 },
    { Q: 238, H: 98.3, P: 113.0 * CV, eta: 0.772 },
    { Q: 299, H: 90.8, P: 125.6 * CV, eta: 0.792 },
  ],
  guarantee: { Q: 240, H: 101.3, P: 112.05 * CV, eta: 0.802 },
  // HI 14.6-2016 grade 2B: flow ±8 %, head ±5 %, power 0/+8 %.
  tolerance: { Q: 0.08, H: 0.05, Pplus: 0.08 },
};

/**
 * TP 4 of the course notes (apunte 13, p. 49): laboratory test of the course pump, a
 * Grundfos CM5-2 (two stages, 1×230 V, 50 Hz) according to the TP guide. Values read
 * from the plotted points (300 dpi), so ±2 % or so. Power is the electrical input
 * Ne = U·I·cos φ and η is that of motor + pump. The speed is not on the sheet: 2850 rpm,
 * the usual speed of a two-pole 50 Hz motor under load, is assumed.
 */
const LPM = 0.06; // m³/h per l/min
export const TP4_TEST = {
  title: 'TP 4 Ensayo de bomba centrífuga (Grundfos CM5-2, 2 etapas)',
  source: 'apunte 13, p. 49 (leído del gráfico)',
  n: 2850,
  stages: 2,
  D2: 0.0718, // from the fit (PRESETS.tp4)
  power: 'electric',
  etaPump: 0.5, // best η of the pump alone, Grundfos catalogue curve in the TP guide (≈ 50 %)
  motor: { eta: 0.8, P0: 0.1265 }, // fitted: η of the motor and its no-load loss (kW)
  points: [
    [0, 18.0, 308, 0], [13.9, 17.05, 358, 0.110], [30.0, 16.0, 411, 0.192], [41.0, 15.45, 435, 0.239],
    [52.2, 14.9, 446, 0.284], [61.3, 14.1, 465, 0.305], [68.5, 13.55, 482, 0.314], [75.5, 12.7, 501, 0.312],
    [81.6, 11.95, 529, 0.302], [85.5, 11.1, 546, 0.284], [88.6, 10.7, 550, 0.279],
  ].map(([q, H, W, eta]) => ({ Q: q * LPM, H, P: W / 1000, eta })),
};

/**
 * Test points scaled by the affinity laws to speed n and impeller diameter D2 (trim);
 * efficiency is kept (homologous points).
 */
export function scaledTestPoints(test, n, D2 = test.D2) {
  return test.points.map((p) => {
    const a = affinity({ Q: p.Q, H: p.H, P: p.P }, { n1: test.n, n2: n, D1: test.D2, D2 });
    return { Q: a.Q, H: a.H, P: a.P, eta: p.eta };
  });
}

/**
 * HI acceptance of a head curve at the guarantee point: the curve must pass through the
 * tolerance box (Q ± tQ, H ± tH). Checked at the guarantee flow and at the band edges.
 * @param headAt (Q m³/h) → H m
 */
export function guaranteeCheck(test, headAt) {
  const g = test.guarantee;
  const t = test.tolerance;
  const Hg = headAt(g.Q);
  const dH = (Hg - g.H) / g.H;
  const lo = headAt(g.Q * (1 - t.Q));
  const hi = headAt(g.Q * (1 + t.Q));
  // The curve crosses the box if, over the flow band, it reaches heads inside ±tH.
  const Hmin = g.H * (1 - t.H);
  const Hmax = g.H * (1 + t.H);
  const inBox = Math.min(lo, hi, Hg) <= Hmax && Math.max(lo, hi, Hg) >= Hmin;
  return { H: Hg, dH, inBox };
}
