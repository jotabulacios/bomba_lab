// International Standard Atmosphere (troposphere + lower stratosphere, 0–20 km).

export const R_AIR = 287.05287; // J/(kg·K)
export const G0 = 9.80665; // m/s²
export const GAMMA_AIR = 1.4;

const T_SL = 288.15;
const P_SL = 101325;
const LAPSE = 0.0065; // K/m
const H_TROPOPAUSE = 11000;
const T_TROPOPAUSE = T_SL - LAPSE * H_TROPOPAUSE; // 216.65 K
const P_TROPOPAUSE = P_SL * Math.pow(T_TROPOPAUSE / T_SL, G0 / (R_AIR * LAPSE));
const H_MAX = 20000;

/**
 * Static conditions at geometric altitude `h` (metres).
 * Altitudes outside [0, 20000] m are clamped.
 * @returns {{T:number, p:number, rho:number, a:number, h:number}}
 */
export function isa(h) {
  const hc = Math.min(Math.max(h, 0), H_MAX);
  let T, p;
  if (hc <= H_TROPOPAUSE) {
    T = T_SL - LAPSE * hc;
    p = P_SL * Math.pow(T / T_SL, G0 / (R_AIR * LAPSE));
  } else {
    T = T_TROPOPAUSE;
    p = P_TROPOPAUSE * Math.exp((-G0 / (R_AIR * T)) * (hc - H_TROPOPAUSE));
  }
  const rho = p / (R_AIR * T);
  const a = Math.sqrt(GAMMA_AIR * R_AIR * T);
  return { T, p, rho, a, h: hc };
}
