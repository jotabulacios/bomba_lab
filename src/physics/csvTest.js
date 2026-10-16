// Read a pump test from CSV text. Two layouts are accepted:
//  - processed: Q, H and optionally power and efficiency, with units in the header
//    ("Q [l/min]", "H [m]", "P [W]", "eta [%]"), and
//  - the raw sheet of the TP guide: Q [l/min], Ps [kg/cm2] (discharge gauge), Pe [mmHg]
//    (suction vacuum gauge), V, I, cos φ → H = Ps + Pe in metres of water, P = V·I·cos φ.
// Separators: comma, semicolon or tab; with ';' or tab a decimal comma is fine.

const RHO_G = 998.2 * 9.80665;
const M_PER_KGFCM2 = 98066.5 / RHO_G; // ≈ 10.02 m of water
const M_PER_MMHG = 133.322 / RHO_G; // ≈ 0.0136 m of water
const M_PER_BAR = 1e5 / RHO_G;
const M_PER_KPA = 1e3 / RHO_G;

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');

/** Split a header cell into its name and its unit ("Q [l/min]" → ['q', 'l/min']). */
function nameUnit(cell) {
  const c = norm(cell);
  const m = c.match(/^([^[(]*)[[(]([^\])]*)[\])]/);
  return m ? [m[1], m[2]] : [c, ''];
}

function classify(name) {
  const n = name.replace(/[_.\-]/g, '');
  if (/^(q|caudal|flow)/.test(n)) return 'Q';
  if (/^(ps|pdesc|pimp|pd|p2man)$/.test(n)) return 'Ps';
  if (/^(pe|pasp|pvac|psuc|pa)$/.test(n)) return 'Pe';
  if (/^(h|altura|head|dp|δp|deltap|hm)$/.test(n) || /^altura|^head/.test(n)) return 'H';
  if (/^(v|u|tension|voltaje)$/.test(n)) return 'V';
  if (/^(i|corriente|amp)$/.test(n)) return 'I';
  if (/^(cos|cosphi|cosφ|cosfi|fp|pf)/.test(n)) return 'cos';
  if (/^(eta|η|rend|ef|eff)/.test(n)) return 'eta';
  if (/^(p|n|ne|nm|pel|pelec|p1|p2|peje|pabs|pot|potencia|power)$/.test(n) || /^potencia(electrica|eje|absorbida)?$/.test(n)) return 'P';
  return null;
}

/**
 * @returns { points: [{ Q m³/h, H m, P? kW, eta? }], power: 'electric' | 'shaft' | null, columns, warnings }
 * @throws if there is no flow or no head (or gauge pressures) column
 */
export function parseTestCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('El CSV necesita una fila de encabezado y al menos una de datos.');
  const delim = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map(nameUnit);
  const cols = {};
  const units = {};
  const names = {};
  header.forEach(([name, unit], i) => {
    const k = unit === 'rpm' || unit === '1/min' ? null : classify(name); // a speed column is not a power
    if (k && !(k in cols)) { cols[k] = i; units[k] = unit; names[k] = name; }
  });
  if (!('Q' in cols)) throw new Error('No encuentro la columna de caudal (Q).');
  if (!('H' in cols) && !('Ps' in cols)) throw new Error('No encuentro la altura (H) ni la presión de descarga (Ps).');
  const num = (s) => {
    if (s === undefined) return NaN;
    const t = delim === ',' ? s : s.replace(',', '.');
    return t.trim() === '' ? NaN : Number(t);
  };
  const rows = lines.slice(1).map((l) => l.split(delim)).map((c) => Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, num(c[i])])));
  const warnings = [];
  const qf = { 'l/min': 0.06, lpm: 0.06, 'l/s': 3.6, 'm3/s': 3600, 'm³/s': 3600, gpm: 0.227125, 'm3/h': 1, 'm³/h': 1, '': 1 }[units.Q];
  if (qf === undefined) warnings.push(`Unidad de caudal "${units.Q}" desconocida: la tomo como m³/h.`);
  const hf = { m: 1, mca: 1, '': 1, kpa: M_PER_KPA, bar: M_PER_BAR, 'kg/cm2': M_PER_KGFCM2, 'kgf/cm2': M_PER_KGFCM2, 'kg/cm²': M_PER_KGFCM2, 'kgf/cm²': M_PER_KGFCM2, ft: 0.3048, mmhg: M_PER_MMHG };
  const press = (u, def) => hf[u || def] ?? hf[def];
  // Power: unit from the header, or W when the values are large.
  let power = null;
  const pName = names.P ?? '';
  if ('P' in cols) power = /^(ne|p1|pel|nm)/.test(pName) || /elec|motor|abs/.test(pName) ? 'electric' : /^(p2|peje)/.test(pName) || /eje|shaft/.test(pName) ? 'shaft' : null;
  const pVals = rows.map((r) => r.P).filter(Number.isFinite);
  const pf = units.P === 'kw' ? 1 : units.P === 'w' ? 1e-3 : units.P === 'cv' ? 0.73549875 : units.P === 'hp' ? 0.7457 : Math.max(0, ...pVals) > 50 ? 1e-3 : 1;
  const etaVals = rows.map((r) => r.eta).filter(Number.isFinite);
  const ef = units.eta === '%' || Math.max(0, ...etaVals) > 1.5 ? 0.01 : 1;
  const points = rows.map((r) => {
    const Q = r.Q * (qf ?? 1);
    let H = r.H * press(units.H, 'm');
    if (!Number.isFinite(H) && Number.isFinite(r.Ps)) {
      // H = P2 − P1: discharge gauge plus the suction vacuum reading (mmHg by default).
      H = r.Ps * press(units.Ps, 'kg/cm2') + (Number.isFinite(r.Pe) ? r.Pe * press(units.Pe, 'mmhg') : 0);
    }
    let P = r.P * pf;
    if (!Number.isFinite(P) && Number.isFinite(r.V) && Number.isFinite(r.I)) {
      P = (r.V * r.I * (Number.isFinite(r.cos) ? r.cos : 1)) / 1000;
      power = 'electric';
    }
    let eta = r.eta * ef;
    if (!Number.isFinite(eta) && Number.isFinite(P) && P > 0) eta = (RHO_G * (Q / 3600) * H) / (P * 1000);
    return { Q, H, P: Number.isFinite(P) ? P : undefined, eta: Number.isFinite(eta) ? eta : undefined };
  }).filter((p) => Number.isFinite(p.Q) && Number.isFinite(p.H));
  if ('Ps' in cols && !('H' in cols) && !('Pe' in cols)) warnings.push('Sin presión de aspiración (Pe): H = Ps, sin sumar el vacío en la aspiración.');
  if (('V' in cols) && !('cos' in cols) && !('P' in cols)) warnings.push('Sin cos φ: la potencia eléctrica es V·I (aparente).');
  points.sort((a, b) => a.Q - b.Q);
  return { points, power, columns: Object.keys(cols), warnings };
}
