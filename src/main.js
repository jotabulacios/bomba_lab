import { fluidState, G } from './physics/fluid.js';
import { buildPump, PRESETS } from './physics/pump.js';
import { operatingPoint, npshAvailable, cavitationOnset, npshStatus, systemHead } from './physics/system.js';
import { series, parallel } from './physics/combine.js';
import { specificSpeeds, impellerType } from './physics/similarity.js';
import { buildParams } from './ui/params.js';
import { drawCurves, curvesTable } from './ui/curves.js';
import { drawImpellerPane } from './ui/impellerPane.js';
import { drawSimilarityPane } from './ui/similarityPane.js';
import { setupChrome, token } from './ui/chrome.js';
import { PumpScene } from './scene/pumpScene.js';

const $ = (id) => document.getElementById(id);

// Installation defaults per preset (the system curve crosses the pump near its BEP).
const PRESET_INSTALL = {
  didactica: { Hgeo: 15, hfd: 16, Hs: 2, hsd: 0.4 },
  ruhrpumpen: { Hgeo: 70, hfd: 62, Hs: 1, hsd: 0.5 },
};

function stateFromPreset(key, keep = {}) {
  const s = PRESETS[key];
  return {
    preset: key,
    nDesign: s.n,
    n: s.n, trim: 100,
    beta2: s.beta2, z: s.z, D2mm: s.D2 * 1000, b2mm: s.b2 * 1000, D1mm: s.D1 * 1000,
    Qdh: Math.round(s.Qd * 3600), etaHd: s.etaHd, slip: s.slip,
    T: 20, alt: 0, valve: 100, mode: 'single', nB: 100,
    ...PRESET_INSTALL[key],
    ...keep,
  };
}

const state = stateFromPreset('didactica');
let pump = null;
let pumpKey = '';
let result = null;

function specFromState(s) {
  const base = PRESETS[s.preset];
  return {
    ...base,
    n: s.nDesign, beta2: s.beta2, z: s.z, D2: s.D2mm / 1000, b2: s.b2mm / 1000, D1: s.D1mm / 1000,
    b1: base.b1 * (s.D1mm / 1000 / base.D1), Qd: s.Qdh / 3600, etaHd: s.etaHd, slip: s.slip,
  };
}

function systemFromState(s, Qd) {
  return {
    Hgeo: s.Hgeo, dp: 0,
    Kpipe: s.hfd / Qd ** 2, Ksuct: s.hsd / Qd ** 2,
    Kvalve0: 0.5 / Qd ** 2, valve: s.valve / 100, Hs: s.Hs,
  };
}

/** Everything the UI shows, for the current state. */
function solve() {
  const spec = specFromState(state);
  const key = JSON.stringify(spec);
  const warnings = [];
  if (key !== pumpKey) {
    try {
      pump = buildPump(spec);
      pumpKey = key;
    } catch (e) {
      warnings.push(`${e.message} Se mantiene la geometría anterior.`);
    }
  }
  const fluid = fluidState(state.T, state.alt);
  const rho = fluid.rho;
  const sys = systemFromState(state, spec.Qd);
  const D2 = (state.D2mm / 1000) * (state.trim / 100);
  const optsA = { n: state.n, D2, rho };
  const optsB = { n: state.n * (state.nB / 100), D2, rho };
  const A = { headAt: (Q) => pump.at(Q, optsA).H, qMax: pump.qMax(optsA) };
  const B = { headAt: (Q) => pump.at(Q, optsB).H, qMax: pump.qMax(optsB) };
  const group = state.mode === 'series' ? series(A, B) : state.mode === 'parallel' ? parallel(A, B) : A;
  const op = operatingPoint(group.headAt, sys, rho, group.qMax);

  let pA = null;
  let pB = null;
  if (op) {
    const split = state.mode === 'single' ? { QA: op.Q, QB: 0 } : group.split(op.Q);
    pA = pump.at(split.QA, optsA);
    if (state.mode !== 'single') pB = pump.at(split.QB, optsB);
  }
  // Suction: each pump has its own suction line (in series only the first one draws from the tank).
  const npsha = pA ? npshAvailable(sys, fluid, pA.Q) : npshAvailable(sys, fluid, 0);
  const npshr = pA ? pA.NPSHr : pump.at(0, optsA).NPSHr;
  const status = op ? npshStatus(npsha, npshr) : 'sin-caudal';
  const Ptot = (pA?.Peje ?? 0) + (pB?.Peje ?? 0);
  const etaGroup = op && Ptot > 0 ? (rho * G * op.Q * op.H) / Ptot : 0;
  const bep = pump.bep(optsA);
  const ss = specificSpeeds(state.n, bep.Q, bep.H);
  const onset = cavitationOnset((Q) => pump.at(Q, optsA).NPSHr, sys, fluid, A.qMax);

  if (!op) warnings.push(`La bomba no vence la altura del sistema (H a caudal cero ${group.headAt(0).toFixed(1)} m < ${systemHead(sys, 0, rho).toFixed(1)} m): no hay caudal.`);
  if (status === 'cavita') warnings.push(`Cavita: ANPAd = ${npsha.toFixed(2)} m < ANPAr = ${npshr.toFixed(2)} m. Bajar la bomba (más Hs), enfriar el agua, reducir pérdidas de aspiración o el caudal.`);
  if (status === 'margen-bajo') warnings.push(`Margen bajo: ANPAr es ${(100 * npshr / npsha).toFixed(0)} % de ANPAd (el apunte pide < 60 %).`);
  if (state.trim < 90) warnings.push('Recorte mayor al 10 %: las leyes de afinidad dejan de ser exactas.');
  if (state.beta2 > 92) warnings.push('Álabes hacia adelante: más altura teórica, pero curva inestable, menos reacción y menor rendimiento.');
  if (pA && (pA.Q < 0.7 * bep.Q || pA.Q > 1.2 * bep.Q)) {
    warnings.push(`Lejos del punto de máximo rendimiento (${(bep.Q * 3600).toFixed(0)} m³/h): Q = ${(100 * pA.Q / bep.Q).toFixed(0)} % de Q_BEP.`);
  }
  if (state.mode === 'parallel' && pB && pB.Q < 1e-6) warnings.push('En paralelo la segunda bomba no aporta: su altura a caudal cero es menor que la del punto de funcionamiento.');

  return { spec, fluid, rho, sys, D2, optsA, optsB, A, B, group, op, pA, pB, npsha, npshr, status, Ptot, etaGroup, bep, ss, onset, warnings };
}

// ---------- KPIs ----------
function updateKpis(r) {
  const op = r.op;
  const statusText = { ok: 'Sin cavitación', 'margen-bajo': 'Margen bajo', cavita: 'CAVITA', 'sin-caudal': 'Sin caudal' }[r.status];
  const statusCls = { ok: 'ok', 'margen-bajo': 'warn', cavita: 'bad', 'sin-caudal': 'warn' }[r.status];
  const k = [
    ['Q', op ? (op.Q * 3600).toFixed(0) : '—', 'm³/h'],
    ['H', op ? op.H.toFixed(1) : '—', 'm'],
    ['ηT', op ? (100 * r.etaGroup).toFixed(1) : '—', '%'],
    ['P eje', op ? (r.Ptot / 1000).toFixed(1) : '—', 'kW'],
    ['ANPAd', r.npsha.toFixed(2), 'm'],
    ['ANPAr', r.npshr.toFixed(2), 'm'],
    ['τ Thoma', r.pA ? (r.npshr / r.pA.H).toFixed(3) : '—', ''],
    ['ns', r.ss.ns.toFixed(0), ''],
  ];
  $('kpis').innerHTML = k.map(([t, v, u]) => `<div><dt>${t}</dt><dd>${v}<small>${u}</small></dd></div>`).join('')
    + `<div class="status ${statusCls}"><dt>ANPA</dt><dd>${statusText}</dd></div>`;
  $('cavBanner').classList.toggle('hidden', r.status !== 'cavita');
  $('cavBanner').textContent = 'La bomba cavita: ANPAd < ANPAr';
}

// ---------- Curves ----------
function updateCurves(r) {
  const N = 90;
  const xMaxQ = Math.max(r.group.qMax, r.A.qMax);
  const xMax = xMaxQ * 3600;
  const grid = Array.from({ length: N + 1 }, (_, i) => (xMaxQ * i) / N);
  const pts = (f) => grid.map((Q) => [Q * 3600, f(Q)]);
  const single = grid.filter((Q) => Q <= r.A.qMax).map((Q) => pump.at(Q, r.optsA));
  const onePump = single.map((p) => [p.Q * 3600, p.H]);
  const opX = r.op ? r.op.Q * 3600 : null;
  const pumpX = r.pA ? r.pA.Q * 3600 : null;
  const combo = state.mode !== 'single';
  const per = combo ? ' (por bomba)' : '';

  const hSeries = combo
    ? [{ name: state.mode === 'series' ? 'Serie' : 'Paralelo', cls: 's1', pts: pts((Q) => r.group.headAt(Q)) },
      { name: 'Una bomba', cls: 's1 thin', dash: true, pts: onePump },
      { name: 'Sistema', cls: 's2', pts: pts((Q) => systemHead(r.sys, Q, r.rho)) }]
    : [{ name: 'Bomba', cls: 's1', pts: onePump },
      { name: 'Sistema', cls: 's2', pts: pts((Q) => systemHead(r.sys, Q, r.rho)) },
      { name: 'H_t∞ Euler', cls: 'muted', dash: true, pts: single.map((p) => [p.Q * 3600, p.HtInf]) }];
  const yMaxH = Math.max(...hSeries[0].pts.map((p) => p[1]), r.pA ? r.pA.H : 0) * 1.25;

  const charts = [
    {
      key: 'H', title: `Altura H y curva del sistema`, unit: 'm', digits: 1, yMax: yMaxH, vline: opX,
      series: hSeries,
      markers: r.op ? [{ x: opX, y: r.op.H, label: `${r.op.H.toFixed(1)} m`, cls: 'op' }] : [],
    },
    {
      key: 'eta', title: `Rendimiento total ηT${per}`, unit: '%', digits: 1, yMax: 100, vline: pumpX,
      series: [{ name: 'ηT', cls: 's1', pts: single.map((p) => [p.Q * 3600, 100 * p.etaT]) }],
      markers: [{ x: r.bep.Q * 3600, y: 100 * r.bep.etaT, label: `BEP ${(100 * r.bep.etaT).toFixed(1)} %`, cls: 'bep' },
        ...(r.pA ? [{ x: pumpX, y: 100 * r.pA.etaT, cls: 'op' }] : [])],
    },
    {
      key: 'P', title: `Potencia en el eje${per}`, unit: 'kW', digits: 1, vline: pumpX,
      series: [{ name: 'P eje', cls: 's1', pts: single.map((p) => [p.Q * 3600, p.Peje / 1000]) }],
      markers: r.pA ? [{ x: pumpX, y: r.pA.Peje / 1000, cls: 'op' }] : [],
    },
    {
      key: 'npsh', title: `ANPA disponible y requerida${per}`, unit: 'm', digits: 2, vline: pumpX,
      series: [
        { name: 'ANPAd', cls: 's3', pts: single.map((p) => [p.Q * 3600, npshAvailable(r.sys, r.fluid, p.Q)]) },
        { name: 'ANPAr', cls: 's2', pts: single.map((p) => [p.Q * 3600, p.NPSHr]) },
      ],
      bands: Number.isFinite(r.onset) ? [{ x0: r.onset * 3600, x1: xMax, label: 'cavitación', cls: 'crit' }] : [],
      markers: r.pA ? [{ x: pumpX, y: r.npshr, cls: 'op' }] : [],
    },
  ];
  drawCurves($('curves'), { xMax, xLabel: combo ? 'Q (m³/h): del conjunto en H; de cada bomba en ηT, P y ANPA' : 'Caudal Q (m³/h)', charts });
  const rows = Array.from({ length: 11 }, (_, i) => {
    const Q = (r.A.qMax * i) / 10;
    const p = pump.at(Q, r.optsA);
    return { Q: Q * 3600, H: p.H, Hs: systemHead(r.sys, Q, r.rho), eta: p.etaT, P: p.Peje / 1000, npsha: npshAvailable(r.sys, r.fluid, Q), npshr: p.NPSHr };
  });
  curvesTable($('curvesTable'), rows);
  $('curvesNote').textContent = r.op
    ? `Punto de funcionamiento: ${(r.op.Q * 3600).toFixed(0)} m³/h a ${r.op.H.toFixed(1)} m, donde la curva ${combo ? 'del conjunto' : 'de la bomba'} corta la del sistema.`
    : 'No hay punto de funcionamiento: la bomba no llega a la altura estática del sistema.';
}

// ---------- 3D ----------
const scene3d = new PumpScene($('canvasHost'));

function update3d(r) {
  const s = r.spec;
  scene3d.setPump(
    { D2: r.D2, b2: s.b2, D1: s.D1, b1: s.b1, beta1: pump.beta1, beta2: s.beta2, z: s.z, t: s.t },
    { n: state.n, Q: r.pA?.Q ?? 0, Qi: r.pA?.Qi ?? 0, c2u: r.pA?.c2u ?? 0, rho: r.rho },
  );
  const ts = scene3d.updateTimeScale(state.n * Math.max(1, state.nB / 100), s.z);
  scene3d.setCavitation(r.status === 'cavita' ? 0.3 + (2 * (r.npshr - r.npsha)) / r.npshr : 0);
  const frameTxt = scene3d.frame === 'abs' ? 'marco absoluto: el rodete gira y el flujo sigue c' : 'marco del rodete: el rodete quieto y el flujo sigue w';
  $('legend3d').innerHTML = `<span>Cámara lenta 1 : ${Math.round(1 / ts)} · ${frameTxt}${state.mode !== 'single' ? ' · se muestra la bomba 1' : ''}</span>`;
}

function toggleTool(id, fn) {
  const b = $(id);
  const on = !b.classList.contains('on');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  fn(on);
}
const tools = {
  cut: () => toggleTool('cutBtn', (on) => scene3d.setCut(on)),
  flow: () => toggleTool('flowBtn', (on) => scene3d.setFlowVisible(on)),
  frame: () => toggleTool('frameBtn', (on) => { scene3d.setFrame(on ? 'rel' : 'abs'); if (result) update3d(result); }),
  reset: () => scene3d.resetCamera(),
};
$('cutBtn').addEventListener('click', tools.cut);
$('flowBtn').addEventListener('click', tools.flow);
$('frameBtn').addEventListener('click', tools.frame);
$('resetBtn').addEventListener('click', tools.reset);

// ---------- Wiring ----------
const params = buildParams($('params'), state, onParam);
function onParam(k, v) {
  state[k] = v;
  update();
}

$('preset').innerHTML = Object.entries(PRESETS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
$('preset').addEventListener('change', (e) => {
  Object.assign(state, stateFromPreset(e.target.value));
  rebuildParams();
  update();
});
function rebuildParams() {
  Object.assign(paramsRef, buildParams($('params'), state, onParam));
}
const paramsRef = params;

function toggleParams() {
  const p = $('paramsPanel');
  p.classList.toggle('collapsed');
  $('toggleParams').textContent = p.classList.contains('collapsed') ? '›' : '‹';
  onResize();
}
$('toggleParams').addEventListener('click', toggleParams);
$('toggleTable').addEventListener('click', () => {
  const t = $('curvesTable');
  t.classList.toggle('hidden');
  $('toggleTable').textContent = t.classList.contains('hidden') ? 'Ver tabla' : 'Ocultar tabla';
});

let activeTab = 'curves';
const chrome = setupChrome({
  onTheme: () => { scene3d.setBackground(token('--stage-bg')); update(); },
  onResize: () => onResize(),
  onTab: (t) => { activeTab = t; if (result) renderPanes(result); },
  shortcuts: {
    1: () => chrome.setTab('curves'),
    2: () => chrome.setTab('impeller'),
    3: () => chrome.setTab('similarity'),
    p: toggleParams,
    x: tools.cut,
    f: tools.flow,
    c: tools.frame,
    r: tools.reset,
  },
});

function renderPanes(r) {
  if (activeTab === 'curves') updateCurves(r);
  else if (activeTab === 'impeller') drawImpellerPane($('impellerPane'), r, pump);
  else drawSimilarityPane($('similarityPane'), r, pump, state);
}

function update() {
  result = solve();
  paramsRef.refresh(state);
  updateKpis(result);
  $('warnings').innerHTML = result.warnings.map((w) => `<li>${w}</li>`).join('');
  renderPanes(result);
  update3d(result);
}

function onResize() {
  scene3d.resize();
  if (result) renderPanes(result);
}
new ResizeObserver(onResize).observe($('rightPanel'));
new ResizeObserver(() => scene3d.resize()).observe($('viewport'));

scene3d.setBackground(token('--stage-bg'));
update();
scene3d.resize();
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  scene3d.update(dt);
  scene3d.render();
}
requestAnimationFrame(loop);
