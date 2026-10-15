// Water properties and site atmosphere for the suction side of the pump.

import { isa } from './atmosphere.js';

export const G = 9.80665; // m/s²

/** Liquid water density (kg/m³) at T °C, Thiesen-type fit (0–100 °C, < 0.1 % error). */
export function waterDensity(T) {
  const t = Math.min(Math.max(T, 0), 100);
  return 1000 * (1 - ((t + 288.9414) / (508929.2 * (t + 68.12963))) * (t - 3.9863) ** 2);
}

/** Saturation (vapour) pressure of water (Pa) at T °C, Antoine equation (1–100 °C). */
export function vaporPressure(T) {
  const t = Math.min(Math.max(T, 1), 100);
  const mmHg = 10 ** (8.07131 - 1730.63 / (233.426 + t));
  return mmHg * 133.322;
}

/** Atmospheric pressure (Pa) at the free surface of the suction tank, ISA at `altitude` m. */
export function atmosphericPressure(altitude) {
  return isa(altitude).p;
}

/** Everything the hydraulics needs about the liquid at temperature T and site altitude. */
export function fluidState(T, altitude) {
  const rho = waterDensity(T);
  const pv = vaporPressure(T);
  const patm = atmosphericPressure(altitude);
  return { T, altitude, rho, pv, patm, Ha: patm / (rho * G), Hpv: pv / (rho * G) };
}
