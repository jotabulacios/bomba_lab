// Installation (apunte 13, p. 31–34 and 39–42): system curve, operating point and
// available NPSH (ANPAd) on the suction side.

import { G } from './fluid.js';

export const DEFAULT_SYSTEM = {
  Hgeo: 20, // m, static lift between the free surfaces
  dp: 0, // Pa, extra pressure difference between the discharge and suction tanks
  Kpipe: 2500, // s²/m⁵, friction of the discharge + suction piping (H = K·Q²)
  Kvalve0: 300, // s²/m⁵, discharge valve fully open
  valve: 1, // opening 0.05 … 1
  Hs: 2, // m, suction static height: + flooded (tank above the pump), − suction lift
  Ksuct: 300, // s²/m⁵, friction of the suction line only (part of Kpipe)
};

/** Valve loss coefficient for an opening a ∈ (0, 1]: grows like 1/a² as it closes. */
export function valveK(sys) {
  const a = Math.min(Math.max(sys.valve, 0.05), 1);
  return sys.Kvalve0 / (a * a);
}

/** Head the installation needs at flow Q (m³/s): H_geo + Δp/ρg + ΣK·Q². */
export function systemHead(sys, Q, rho) {
  return sys.Hgeo + sys.dp / (rho * G) + (sys.Kpipe + valveK(sys)) * Q * Q;
}

/**
 * Available NPSH (ANPAd = Hs + Ha − Hf − Hpv, apunte p. 40).
 * @param fluid fluidState() (Ha and Hpv in m of liquid)
 */
export function npshAvailable(sys, fluid, Q) {
  return fluid.Ha + sys.Hs - sys.Ksuct * Q * Q - fluid.Hpv;
}

/**
 * Operating point: where the pump (or pump group) head curve meets the system curve.
 * @param headAt Q ↦ H of the pump(s) (m)
 * @param qMax flow where the pump curve reaches zero head
 * @returns { Q, H } or null when the pump cannot overcome the static head
 */
export function operatingPoint(headAt, sys, rho, qMax) {
  const f = (Q) => headAt(Q) - systemHead(sys, Q, rho);
  if (f(0) <= 0) return null;
  let lo = 0;
  let hi = qMax;
  if (f(hi) > 0) return { Q: hi, H: headAt(hi) };
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  const Q = (lo + hi) / 2;
  return { Q, H: headAt(Q) };
}

/**
 * Flow at which ANPAd = ANPAr: to the right of it the pump cavitates (apunte p. 41).
 * Returns Infinity if it never cavitates up to qMax, 0 if it cavitates already at Q = 0.
 */
export function cavitationOnset(npshrAt, sys, fluid, qMax) {
  const f = (Q) => npshAvailable(sys, fluid, Q) - npshrAt(Q);
  if (f(0) <= 0) return 0;
  if (f(qMax) > 0) return Infinity;
  let lo = 0;
  let hi = qMax;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Margin rule of the notes: choose the pump so that ANPAr < 60 % of ANPAd. */
export function npshStatus(npsha, npshr) {
  if (npsha <= npshr) return 'cavita';
  if (npshr > 0.6 * npsha) return 'margen-bajo';
  return 'ok';
}
