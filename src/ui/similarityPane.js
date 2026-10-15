// "Semejanza" tab: specific speed and impeller type (apunte 13, p. 17; apunte 08), flow
// and head coefficients, and an affinity explorer that compares the affinity-law
// prediction with the full model when the speed changes or the impeller is trimmed.

import { specificSpeeds, coefficients, impellerType, IMPELLER_TYPES, affinity } from '../physics/similarity.js';
import { drawCurves } from './curves.js';

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const explorer = { n2: null, trim2: 90, mode: 'trim' };

export function drawSimilarityPane(host, r, pump, state) {
  const bep = r.bep;
  const ss = specificSpeeds(state.n, bep.Q, bep.H);
  const type = impellerType(ss.ns);
  const { phi, psi } = coefficients(state.n, r.D2, bep.Q, bep.H);
  const d2d1 = r.D2 / r.spec.D1;
  if (explorer.n2 === null) explorer.n2 = Math.round(state.n * 1.2);

  // Affinity explorer: new speed and trim on the same pump.
  const D2new = r.spec.D2 * (explorer.trim2 / 100);
  const optsNew = { n: explorer.n2, D2: D2new, rho: r.rho };
  const pred = affinity({ Q: bep.Q, H: bep.H, P: bep.Peje }, { n1: state.n, n2: explorer.n2, D1: r.D2, D2: D2new, mode: 'trim' });
  const model = pump.at(pred.Q, optsNew);
  const err = (a, b) => `${a >= b ? '+' : ''}${(100 * (a - b) / b).toFixed(1)} %`;

  host.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Velocidad específica (en el BEP)</h3></div>
      <dl class="stats">
        <div><dt>ns = 3.65·n·Q^½/H^¾</dt><dd>${fmt(ss.ns, 0)}</dd></div>
        <div><dt>nq = n·Q^½/H^¾</dt><dd>${fmt(ss.nq, 1)}</dd></div>
        <div><dt>Ns (adim., ω en rad/s)</dt><dd>${fmt(ss.Ns, 3)}</dd></div>
        <div><dt>Φ = Q/(N·D³)</dt><dd>${fmt(phi, 4)}</dd></div>
        <div><dt>Ψ = gH/(N·D)²</dt><dd>${fmt(psi, 2)}</dd></div>
        <div><dt>BEP</dt><dd>${fmt(bep.Q * 3600, 0)} m³/h · ${fmt(bep.H)} m</dd></div>
      </dl>
      <table class="data">
        <tr><th>ns (apunte 13, p. 17)</th><th>Tipo de rodete</th><th>D2/D1</th></tr>
        ${IMPELLER_TYPES.map((t, i) => {
          const lo = i ? IMPELLER_TYPES[i - 1].max : 0;
          return `<tr class="${t.name === type.name ? 'current' : ''}"><td>${lo}–${t.max}</td><td>${t.name}</td><td>${t.d2d1}</td></tr>`;
        }).join('')}
      </table>
      <p class="note">Esta bomba: ns = ${fmt(ss.ns, 0)} → <b>${type.name}</b>; recomendado D2/D1 = ${type.d2d1}, el rodete tiene ${fmt(d2d1, 2)}.</p>
    </section>
    <section class="card">
      <div class="card-head"><h3>Leyes de afinidad vs. modelo</h3></div>
      <div class="row-controls">
        <label>Nueva n <input type="range" id="affN" min="500" max="3600" step="10" value="${explorer.n2}"><output>${explorer.n2}</output></label>
        <label>Recorte D2 <input type="range" id="affT" min="70" max="100" step="1" value="${explorer.trim2}"><output>${explorer.trim2} %</output></label>
      </div>
      <div id="affChart"></div>
      <table class="data">
        <tr><th>BEP homólogo</th><th>Leyes (Q∝nD, H∝n²D², P∝n³D³)</th><th>Modelo</th><th>Diferencia</th></tr>
        <tr><td>Q (m³/h)</td><td>${fmt(pred.Q * 3600, 0)}</td><td>${fmt(model.Q * 3600, 0)}</td><td>—</td></tr>
        <tr><td>H (m)</td><td>${fmt(pred.H)}</td><td>${fmt(model.H)}</td><td>${err(model.H, pred.H)}</td></tr>
        <tr><td>P (kW)</td><td>${fmt(pred.P / 1000)}</td><td>${fmt(model.Peje / 1000)}</td><td>${err(model.Peje, pred.P)}</td></tr>
      </table>
      <p class="note">Cambiando solo n, el modelo cumple las leyes exactamente (puntos homólogos). Al recortar el rodete la semejanza es aproximada: el apunte la acepta hasta ~10 % de recorte; mirá cómo crece la diferencia más allá.</p>
    </section>`;

  const base = pump.curve(r.optsA, 60).map((p) => [p.Q * 3600, p.H]);
  const moved = pump.curve(optsNew, 60).map((p) => [p.Q * 3600, p.H]);
  const xMax = Math.max(base.at(-1)[0], moved.at(-1)[0]);
  drawCurves(host.querySelector('#affChart'), {
    xMax, xLabel: 'Q (m³/h)',
    charts: [{
      key: 'aff', title: 'H–Q actual y con la nueva n / recorte', unit: 'm', digits: 1,
      series: [{ name: 'Actual', cls: 's1 thin', dash: true, pts: base }, { name: 'Nueva (modelo)', cls: 's1', pts: moved }],
      markers: [{ x: bep.Q * 3600, y: bep.H, cls: 'bep' }, { x: pred.Q * 3600, y: pred.H, label: 'afinidad', cls: 'op' }],
    }],
  });

  const rerender = () => drawSimilarityPane(host, r, pump, state);
  host.querySelector('#affN').addEventListener('change', (e) => { explorer.n2 = Number(e.target.value); rerender(); });
  host.querySelector('#affT').addEventListener('change', (e) => { explorer.trim2 = Number(e.target.value); rerender(); });
  for (const id of ['affN', 'affT']) {
    const el = host.querySelector(`#${id}`);
    el.addEventListener('input', () => { el.nextElementSibling.textContent = id === 'affT' ? `${el.value} %` : el.value; });
  }
}
