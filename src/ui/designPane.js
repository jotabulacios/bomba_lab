// "Diseño" tab: the current design against a reference. Meridional half-section (hub
// and shroud between D1 and D2 with b1, b2), H–Q and η–Q of both, a table of changes and
// notes that explain what each change did (apunte 13: Euler, β2, slip, ns).

import { specificSpeeds, impellerType } from '../physics/similarity.js';
import { drawCurves } from './curves.js';

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (a, b) => (Math.abs(b) > 1e-9 ? (100 * (a - b)) / b : 0);

function section(cur, ref, W) {
  const H = 170;
  const pad = 26;
  const rMax = Math.max(cur.D2, ref?.D2 ?? 0) / 2;
  const zMax = Math.max(cur.b1, cur.b2, ref?.b1 ?? 0, ref?.b2 ?? 0) * 1.8;
  const sc = Math.min((H - 2 * pad) / rMax, (W - 120) / (zMax * 2.2));
  const X = (z) => 40 + z * sc;
  const Y = (r) => H - pad - r * sc;
  const shape = (g, cls) => {
    const R1 = g.D1 / 2;
    const R2 = g.D2 / 2;
    // back shroud (z = 0), front shroud from (b1, R1) to (b2, R2), outlet edge, eye.
    return `<path class="${cls}" d="M${X(0)},${Y(0.18 * R1)} L${X(0)},${Y(R2)} L${X(g.b2)},${Y(R2)} L${X(g.b1)},${Y(R1)} L${X(g.b1 + 0.6 * zMax)},${Y(R1 * 1.02)}"/>`;
  };
  const cotas = `
    <text class="sec-txt" x="${X(cur.b2) + 6}" y="${Y(cur.D2 / 2) + 4}">b2 ${fmt(cur.b2 * 1000)} mm</text>
    <text class="sec-txt" x="${X(cur.b1) + 6}" y="${Y(cur.D1 / 2) + 12}">b1 ${fmt(cur.b1 * 1000)} mm</text>
    <text class="sec-txt" x="4" y="${Y(cur.D2 / 2) + 4}">R2</text>
    <text class="sec-txt" x="4" y="${Y(cur.D1 / 2) + 4}">R1</text>`;
  return `<svg class="section" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sección meridional">
    <line class="sec-axis" x1="${X(-0.02 * zMax)}" y1="${Y(0)}" x2="${W - 8}" y2="${Y(0)}"/>
    <text class="sec-txt" x="${W - 60}" y="${Y(0) + 13}">eje</text>
    ${ref ? shape(ref, 'sec-ref') : ''}
    ${shape(cur, 'sec-cur')}
    ${cotas}
  </svg>`;
}

/** Notes that explain the consequences of each change (vs the reference). */
function notes(cur, ref, c, r) {
  const out = [];
  const d = (k) => pct(cur[k], ref[k]);
  if (Math.abs(d('D2')) > 0.5) out.push(`D2 ${d('D2') > 0 ? 'más grande' : 'más chico'} (${fmt(d('D2'))} %): U2 ∝ D2, así que la altura a caudal cero cambia ≈ ${fmt(((cur.D2 / ref.D2) ** 2 - 1) * 100)} % (H ∝ D2²). Cambia también la potencia (∝ D2³ en un recorte).`);
  if (Math.abs(d('b2')) > 0.5) out.push(`b2 ${d('b2') > 0 ? 'más ancho' : 'más angosto'}: a igual Q baja${d('b2') > 0 ? '' : 'ría'} cm2, la curva H–Q se ${d('b2') > 0 ? 'aplana' : 'empina'} y el BEP se corre a ${d('b2') > 0 ? 'más' : 'menos'} caudal.`);
  if (Math.abs(cur.beta2 - ref.beta2) > 0.5) out.push(`β2 ${cur.beta2 > ref.beta2 ? 'mayor' : 'menor'} (${fmt(ref.beta2, 0)}° → ${fmt(cur.beta2, 0)}°): ${cur.beta2 > ref.beta2 ? 'más altura teórica pero menos grado de reacción; hay que recuperar más energía cinética en la voluta' : 'curva más inclinada y estable, más reacción, menos altura'}${cur.beta2 > 90 ? '. Con β2 > 90° la curva tiende a ser creciente (inestable).' : '.'}`);
  if (cur.z !== ref.z) out.push(`z = ${ref.z} → ${cur.z}: ${cur.z > ref.z ? 'menos resbalamiento (σ sube) pero más bloqueo y más superficie de fricción' : 'más resbalamiento (σ baja), menos fricción'}. σ ${fmt(r.sigma, 3)} → ${fmt(c.sigma, 3)}.`);
  if (Math.abs(d('D1')) > 0.5) out.push(`D1 ${d('D1') > 0 ? 'más grande' : 'más chico'}: ${d('D1') > 0 ? 'baja cm1 (menos ANPAr) pero sube U1 y w1 a la entrada' : 'sube cm1 y la ANPAr'}; β1 se rediseña para no tener choque en Q_d.`);
  if (Math.abs(d('Qd')) > 0.5) out.push(`Q de diseño ${d('Qd') > 0 ? 'mayor' : 'menor'}: cambia β1 (entrada sin choque) y la garganta de la voluta (∝ Q_d); el BEP se mueve con él.`);
  if (!out.length) out.push('Igual a la referencia. Mové D2, b2, β2, z, D1 o Q de diseño en el panel izquierdo y mirá cómo cambian el rodete, la sección y las curvas.');
  return out;
}

/**
 * @param cur, ref geometry + derived: { D1, D2, b1, b2, beta1, beta2, z, Qd, pump, opts }
 */
export function drawDesignPane(host, cur, ref, handlers) {
  const W = Math.max(280, host.clientWidth || 360);
  const N = 70;
  const curve = (g) => g.pump.curve(g.opts, N).map((p) => p);
  const cc = curve(cur);
  const rc = curve(ref);
  const cb = cur.pump.bep(cur.opts);
  const rb = ref.pump.bep(ref.opts);
  const nsC = specificSpeeds(cur.opts.n, cb.Q, cb.H).ns;
  const nsR = specificSpeeds(ref.opts.n, rb.Q, rb.H).ns;
  const rows = [
    ['H a Q = 0', cc[0].H, rc[0].H, 'm', 1],
    ['Q del BEP', cb.Q * 3600, rb.Q * 3600, 'm³/h', 0],
    ['H del BEP', cb.H, rb.H, 'm', 1],
    ['η del BEP', 100 * cb.etaT, 100 * rb.etaT, '%', 1],
    ['P en el BEP', cb.Peje / 1000, rb.Peje / 1000, 'kW', 1],
    ['ANPAr en el BEP', cb.NPSHr, rb.NPSHr, 'm', 2],
    ['ns', nsC, nsR, '', 0],
    ['σ resbalamiento', cur.pump.sigma, ref.pump.sigma, '', 3],
    ['D2/D1', cur.D2 / cur.D1, ref.D2 / ref.D1, '', 2],
  ];
  const type = impellerType(nsC);
  host.innerHTML = `
    <div class="design-actions">
      <button class="btn" id="dzSetRef">Fijar como referencia</button>
      <button class="btn ghost" id="dzRevert">Volver a la referencia</button>
    </div>
    <section class="card">
      <div class="card-head"><h3>Sección meridional</h3><span class="note">— actual · - - referencia</span></div>
      ${section(cur, ref, W - 22)}
    </section>
    <section class="card">
      <div class="card-head"><h3>Curvas: actual vs. referencia</h3></div>
      <div id="dzCurves"></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Cambios</h3><span class="note">rodete ${type.name.toLowerCase()} (ns ${fmt(nsC, 0)}, D2/D1 recomendado ${type.d2d1})</span></div>
      <table class="data">
        <tr><th></th><th>Actual</th><th>Referencia</th><th>Δ</th></tr>
        ${rows.map(([k, a, b, u, dd]) => {
          const ch = pct(a, b);
          return `<tr><td>${k}</td><td>${fmt(a, dd)} ${u}</td><td>${fmt(b, dd)} ${u}</td><td class="${Math.abs(ch) < 0.05 ? '' : ch > 0 ? 'up' : 'down'}">${Math.abs(ch) < 0.05 ? '=' : `${ch > 0 ? '+' : ''}${fmt(ch)} %`}</td></tr>`;
        }).join('')}
      </table>
    </section>
    <section class="card">
      <div class="card-head"><h3>Qué cambió y por qué</h3></div>
      <ul class="design-notes">${notes(cur, ref, cur.pump, ref.pump).map((n) => `<li>${n}</li>`).join('')}</ul>
    </section>`;
  const xMax = Math.max(cc.at(-1).Q, rc.at(-1).Q) * 3600;
  drawCurves(host.querySelector('#dzCurves'), {
    xMax, xLabel: 'Q (m³/h) a la velocidad actual',
    charts: [
      { key: 'dzH', title: 'H–Q', unit: 'm', digits: 1,
        series: [{ name: 'Actual', cls: 's1', pts: cc.map((p) => [p.Q * 3600, p.H]) }, { name: 'Referencia', cls: 'muted', dash: true, pts: rc.map((p) => [p.Q * 3600, p.H]) }],
        markers: [{ x: cb.Q * 3600, y: cb.H, cls: 'bep' }, { x: rb.Q * 3600, y: rb.H, cls: 'bep' }] },
      { key: 'dzE', title: 'ηT–Q', unit: '%', digits: 1, yMax: 100,
        series: [{ name: 'Actual', cls: 's1', pts: cc.map((p) => [p.Q * 3600, 100 * p.etaT]) }, { name: 'Referencia', cls: 'muted', dash: true, pts: rc.map((p) => [p.Q * 3600, 100 * p.etaT]) }] },
    ],
  });
  host.querySelector('#dzSetRef').addEventListener('click', handlers.setRef);
  host.querySelector('#dzRevert').addEventListener('click', handlers.revert);
}
