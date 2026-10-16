import { fluidState, G } from './physics/fluid.js';
import { buildPump, PRESETS, voluteThroat } from './physics/pump.js';
import { operatingPoint, npshAvailable, cavitationOnset, npshStatus, systemHead, pressureProfile } from './physics/system.js';
import { series, parallel } from './physics/combine.js';
import { specificSpeeds, impellerType } from './physics/similarity.js';
import { buildParams } from './ui/params.js';
import { drawCurves, curvesTable } from './ui/curves.js';
import { drawImpellerPane } from './ui/impellerPane.js';
import { drawSimilarityPane } from './ui/similarityPane.js';
import { setupChrome, token, isDark } from './ui/chrome.js';
import { PumpScene } from './scene/pumpScene.js';
import { PlantScene } from './scene/plantScene.js';
import { DesignScene } from './scene/designScene.js';
import { drawDesignPane } from './ui/designPane.js';
import { drawPidPane } from './ui/pidPane.js';
import { updateTitleBlock, exportDrawing } from './ui/titleBlock.js';
import { RUHRPUMPEN_TEST, scaledTestPoints, guaranteeCheck } from './physics/testSheet.js';

// Measured performance of a preset, when the course notes have its test sheet.
const TEST_SHEETS = { ruhrpumpen: RUHRPUMPEN_TEST };

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
  // Common suction line (the installation drawing): suction loss with the total flow.
  // In parallel both pumps see that ANPAd; in series only the first pump draws from it.
  const npsha = npshAvailable(sys, fluid, op ? op.Q : 0);
  const npshr = pA ? pA.NPSHr : pump.at(0, optsA).NPSHr;
  const npshrB = state.mode === 'parallel' && pB ? pB.NPSHr : 0;
  const status = op ? npshStatus(npsha, Math.max(npshr, npshrB)) : 'sin-caudal';
  const cavA = op && npsha <= npshr;
  const cavB = op && state.mode === 'parallel' && pB && pB.Q > 1e-6 && npsha <= npshrB;
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

  return { spec, fluid, rho, sys, D2, optsA, optsB, A, B, group, op, pA, pB, npsha, npshr, npshrB, cavA, cavB, status, Ptot, etaGroup, bep, ss, onset, warnings };
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

// ---------- Test sheet ----------
/** Measured points against the model at the same flow, and the HI guarantee check. */
function drawTestSheet(sheet, tp, r) {
  const host = $('testSheet');
  if (!sheet) { host.innerHTML = ''; return; }
  const at = (Qh) => pump.at(Qh / 3600, r.optsA);
  const f = (v, d = 1) => v.toFixed(d);
  const dp = (m, t) => (t > 1e-9 ? `${m >= t ? '+' : '−'}${f(Math.abs(100 * (m - t) / t))} %` : '—');
  const rows = tp.map((p) => {
    const m = at(p.Q);
    return `<tr><td>${f(p.Q, 0)}</td><td>${f(p.H)}</td><td>${f(m.H)}</td><td>${dp(m.H, p.H)}</td><td>${f(100 * p.eta)}</td><td>${f(100 * m.etaT)}</td><td>${f(p.P)}</td><td>${f(m.Peje / 1000)}</td></tr>`;
  }).join('');
  const atHome = Math.abs(state.n - sheet.n) < 0.5 && Math.abs(r.D2 - sheet.D2) < 1e-4;
  const designSame = DESIGN_KEYS.every((k) => state[k] === stateFromPreset(state.preset)[k]);
  const g = sheet.guarantee;
  const chk = guaranteeCheck(sheet, (Qh) => pump.at(Qh / 3600, { ...r.optsA, n: sheet.n, D2: sheet.D2 }).H);
  host.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Hoja de ensayo</h3><span class="note">${sheet.title} · ${sheet.source}</span></div>
      <p class="note">Puntos medidos (□ en las curvas), homologados a ${sheet.n} rpm y D2 ${f(sheet.D2 * 1000, 0)} mm${atHome ? '' : `, llevados con las leyes de afinidad a ${f(state.n, 0)} rpm y D2 ${f(r.D2 * 1000, 0)} mm`}.${designSame ? '' : ' <b>Cambiaste el diseño del rodete: el ensayo es de la bomba original.</b>'}</p>
      <table class="data">
        <tr><th>Q m³/h</th><th>H ensayo</th><th>H modelo</th><th>ΔH</th><th>η ensayo %</th><th>η modelo %</th><th>P ensayo kW</th><th>P modelo kW</th></tr>
        ${rows}
      </table>
      <p class="note">Punto garantizado: ${g.Q} m³/h, ${g.H} m, ${f(100 * g.eta)} %, ${f(g.P)} kW. Tolerancia HI 2016 grado 2B: Q ±${100 * sheet.tolerance.Q} %, H ±${100 * sheet.tolerance.H} %, P 0/+${100 * sheet.tolerance.Pplus} %.
        El modelo a ${sheet.n} rpm da ${f(chk.H)} m en ${g.Q} m³/h (${dp(chk.H, g.H)}): <span class="${chk.inBox ? 'ok' : 'bad'}">${chk.inBox ? 'pasa por la ventana de tolerancia' : 'fuera de la ventana de tolerancia'}</span>. La hoja dice APROBADO.</p>
    </section>`;
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
  // Test sheet points, moved with the affinity laws to the current speed and trim.
  const sheet = TEST_SHEETS[state.preset];
  const tp = sheet ? scaledTestPoints(sheet, state.n, r.D2) : null;
  const testSeries = (f) => (tp ? [{ name: 'Ensayo', cls: 'test', points: true, pts: tp.map((p) => [p.Q, f(p)]) }] : []);

  const hSeries = combo
    ? [{ name: state.mode === 'series' ? 'Serie' : 'Paralelo', cls: 's1', pts: pts((Q) => r.group.headAt(Q)) },
      { name: 'Una bomba', cls: 's1 thin', dash: true, pts: onePump },
      { name: 'Sistema', cls: 's2', pts: pts((Q) => systemHead(r.sys, Q, r.rho)) }]
    : [{ name: 'Bomba', cls: 's1', pts: onePump },
      { name: 'Sistema', cls: 's2', pts: pts((Q) => systemHead(r.sys, Q, r.rho)) },
      { name: 'H_t∞ Euler', cls: 'muted', dash: true, pts: single.map((p) => [p.Q * 3600, p.HtInf]) }];
  hSeries.push(...testSeries((p) => p.H));
  const yMaxH = Math.max(...hSeries[0].pts.map((p) => p[1]), r.pA ? r.pA.H : 0) * 1.25;

  const charts = [
    {
      key: 'H', title: `Altura H y curva del sistema`, unit: 'm', digits: 1, yMax: yMaxH, vline: opX,
      series: hSeries,
      markers: r.op ? [{ x: opX, y: r.op.H, label: `${r.op.H.toFixed(1)} m`, cls: 'op' }] : [],
    },
    {
      key: 'eta', title: `Rendimiento total ηT${per}`, unit: '%', digits: 1, yMax: 100, vline: pumpX,
      series: [{ name: 'ηT', cls: 's1', pts: single.map((p) => [p.Q * 3600, 100 * p.etaT]) }, ...testSeries((p) => 100 * p.eta)],
      markers: [{ x: r.bep.Q * 3600, y: 100 * r.bep.etaT, label: `BEP ${(100 * r.bep.etaT).toFixed(1)} %`, cls: 'bep' },
        ...(r.pA ? [{ x: pumpX, y: 100 * r.pA.etaT, cls: 'op' }] : [])],
    },
    {
      key: 'P', title: `Potencia en el eje${per}`, unit: 'kW', digits: 1, vline: pumpX,
      series: [{ name: 'P eje', cls: 's1', pts: single.map((p) => [p.Q * 3600, p.Peje / 1000]) }, ...testSeries((p) => p.P)],
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
  drawTestSheet(sheet, tp, r);
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
const plant = new PlantScene(scene3d.renderer, $('canvasHost'));
const design = new DesignScene(scene3d.renderer, $('canvasHost'));
let view = 'plant'; // 'plant' | 'pump' | 'design'

// Reference design for the "Diseño" view (design inputs only).
const DESIGN_KEYS = ['beta2', 'z', 'D2mm', 'b2mm', 'D1mm', 'Qdh', 'etaHd', 'slip'];
const snapshot = () => Object.fromEntries(DESIGN_KEYS.map((k) => [k, state[k]]));
let refDesign = snapshot();
let refPump = null;
let refKey = '';
function referencePump() {
  const spec = specFromState({ ...state, ...refDesign });
  const key = JSON.stringify(spec);
  if (key !== refKey) { refPump = buildPump(spec); refKey = key; }
  return refPump;
}
function designGeom(p, s, D2) {
  return { D2, D1: s.D1, b1: s.b1, b2: s.b2, beta1: p.beta1, beta2: s.beta2, z: s.z, t: s.t, Qd: s.Qd, throat: voluteThroat(p), pump: p };
}
function designData(r) {
  const rp = referencePump();
  const cur = { ...designGeom(pump, r.spec, r.D2), opts: r.optsA };
  const rs = rp.spec;
  const ref = { ...designGeom(rp, rs, rs.D2 * (state.trim / 100)), opts: { ...r.optsA, D2: rs.D2 * (state.trim / 100) } };
  return { cur, ref };
}
let shownPump = 0; // which pump the detail view shows (series / parallel)

/** Flows, pump states and the pressure profile of the installation (3-D and P&ID). */
function installData(r) {
  const Q = r.op ? r.op.Q : 0;
  const branches = state.mode === 'parallel' ? { QA: r.pA?.Q ?? 0, QB: r.pB?.Q ?? 0 } : { QA: Q, QB: Q };
  const heads = !r.op ? [0] : state.mode === 'series' ? [r.pA.H, r.pB.H] : [r.op.H];
  const pumps = [{ n: state.n, Q: r.pA?.Q ?? 0, H: r.pA?.H ?? 0, active: (r.pA?.Q ?? 0) > 1e-6, cavitates: !!r.cavA }];
  if (state.mode !== 'single') pumps.push({ n: state.n * (state.nB / 100), Q: r.pB?.Q ?? 0, H: r.pB?.H ?? 0, active: (r.pB?.Q ?? 0) > 1e-6, cavitates: !!r.cavB });
  const profile = pressureProfile(r.sys, r.op ?? { Q: 0, H: 0 }, heads, state.mode);
  return { Q, branches, pumps, profile };
}

function update3d(r) {
  const s = r.spec;
  const two = state.mode !== 'single';
  if (!two) shownPump = 0;
  const pp = shownPump === 1 && r.pB ? r.pB : r.pA;
  const n = shownPump === 1 ? state.n * (state.nB / 100) : state.n;
  scene3d.setPump(
    { D2: r.D2, b2: s.b2, D1: s.D1, b1: s.b1, beta1: pump.beta1, beta2: s.beta2, z: s.z, t: s.t },
    { n, Q: pp?.Q ?? 0, Qi: pp?.Qi ?? 0, c2u: pp?.c2u ?? 0, rho: r.rho },
  );
  const ts = scene3d.updateTimeScale(state.n * Math.max(1, state.nB / 100), s.z);
  const cav = shownPump === 1 ? r.cavB : r.cavA;
  const req = shownPump === 1 ? r.npshrB : r.npshr;
  scene3d.setCavitation(cav ? 0.3 + (2 * (req - r.npsha)) / req : 0);

  // Installation.
  const { Q, branches, pumps, profile } = installData(r);
  plant.setState({
    mode: state.mode, Hs: state.Hs, Hgeo: state.Hgeo, valve: state.valve / 100, Q, branches, pumps, rho: r.rho,
    profile,
    pipeArea: (s.Qd / 2.5),
    Qd: s.Qd,
  });

  if (view === 'design') {
    const { cur, ref } = designData(r);
    design.setDesign(cur, $('dzGhost').checked ? ref : null);
  }
  const frameTxt = scene3d.frame === 'abs' ? 'marco absoluto: el rodete gira y el flujo sigue c' : 'marco del rodete: el rodete quieto y el flujo sigue w';
  $('legend3d').innerHTML = view === 'plant'
    ? '<span class="pleg"><i class="pv"></i>vacío <i class="p0"></i>0 <i class="pp"></i>presión · color de las partículas = presión manométrica · clic en una bomba para verla por dentro</span>'
    : view === 'design'
      ? '<span>A escala real · gris translúcido = referencia · pasá el mouse por un parámetro de diseño para ver su cota</span>'
      : `<span>Cámara lenta 1 : ${Math.round(1 / ts)} · ${frameTxt}${two ? ` · bomba ${shownPump + 1}` : ''}</span>`;
  $('pumpPicker').classList.toggle('hidden', view !== 'pump' || !two);
  // Quick selector in the viewport for one pump, series or parallel (same as the panel).
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  const sel = $('p-mode');
  if (sel) sel.value = state.mode;
  update();
}));
document.querySelectorAll('[data-pump]').forEach((b) => b.classList.toggle('active', Number(b.dataset.pump) === shownPump));
}

// Global drawing style: '3d' (render) or 'plan' (technical drawing).
let drawStyle = '3d';
function setDrawStyle(st) {
  drawStyle = st;
  document.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('active', b.dataset.style === st));
  $('viewport').classList.toggle('plan', st === 'plan');
  plant.setPlanStyle(st === 'plan', isDark());
  design.setPlanStyle?.(st === 'plan', isDark());
  scene3d.setPlanStyle?.(st === 'plan', isDark());
  $('titleBlock').classList.toggle('hidden', view !== 'design' || st !== 'plan');
}
document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => setDrawStyle(b.dataset.style)));

function setView(v) {
  view = v;
  document.querySelectorAll('.toolbar [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  plant.controls.enabled = v === 'plant';
  scene3d.controls.enabled = v === 'pump';
  design.controls.enabled = v === 'design';
  plant.setLabelsVisible(v === 'plant');
  design.setLabelsVisible(v === 'design');
  for (const id of ['cutBtn', 'frameBtn']) $(id).classList.toggle('hidden', v !== 'pump');
  $('flowBtn').classList.toggle('hidden', v === 'design');
  $('designCtl').classList.toggle('hidden', v !== 'design');
  $('modeSeg').classList.toggle('hidden', v !== 'plant');
  $('titleBlock').classList.toggle('hidden', v !== 'design' || drawStyle !== 'plan');
  if (result) update3d(result);
}

// Click (not drag) on a pump in the installation opens its detail view.
{
  let down = null;
  const canvas = scene3d.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || view !== 'plant') return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > 4) return;
    const i = plant.pick(e);
    if (i !== null) { shownPump = i; setView('pump'); }
  });
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
  flow: () => toggleTool('flowBtn', (on) => { scene3d.setFlowVisible(on); plant.showFlow = on; }),
  frame: () => toggleTool('frameBtn', (on) => { scene3d.setFrame(on ? 'rel' : 'abs'); if (result) update3d(result); }),
  reset: () => (view === 'plant' ? plant.frame() : view === 'design' ? design.setCamera('iso') : scene3d.resetCamera()),
  view: () => setView(view === 'plant' ? 'pump' : 'plant'),
};
document.querySelectorAll('.toolbar [data-view]').forEach((b) => b.addEventListener('click', () => {
  setView(b.dataset.view);
  if (b.dataset.view === 'design') chrome.setTab('design');
}));
document.querySelectorAll('[data-dcam]').forEach((b) => b.addEventListener('click', () => {
  design.setCamera(b.dataset.dcam);
  document.querySelectorAll('[data-dcam]').forEach((x) => x.classList.toggle('active', x === b));
}));
$('dzVolute').addEventListener('change', (e) => { design.setVolute(e.target.checked); });
document.querySelectorAll('[data-cut]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.cut;
  document.querySelectorAll('[data-cut]').forEach((x) => x.classList.toggle('active', x === b));
  $('cutPos').value = 0;
  $('cutAng').value = 0;
  design.cut.angle = 0;
  design.setCut(k);
  $('cutPosWrap').classList.toggle('hidden', k === 'none');
  $('cutAngWrap').classList.toggle('hidden', k !== 'B');
  const cam = k === 'A' ? 'front' : k === 'B' ? 'side' : null;
  if (cam) document.querySelectorAll('[data-dcam]').forEach((x) => x.classList.toggle('active', x.dataset.dcam === cam));
  if (result) update3d(result);
}));
$('cutPos').addEventListener('input', (e) => design.setCutPos(Number(e.target.value) / 100));
$('cutAng').addEventListener('input', (e) => { design.setCutAngle(Number(e.target.value)); if (result) update3d(result); });
$('planPng').addEventListener('click', () => exportDrawing(design, $('viewport'), '.design-labels > div, .title-block', 'plano-bomba-lab.png'));
function refreshTitleBlock() {
  if (!result) return;
  const s = result.spec;
  const d = pump.at(s.Qd, result.optsA);
  updateTitleBlock({ z: s.z, beta2: s.beta2, D2mm: result.D2 * 1000, Qh: s.Qd * 3600, H: d.H, n: state.n, view: design.viewName(), scale: design.scaleText() });
}
design.onView = refreshTitleBlock;
$('dzGhost').addEventListener('change', () => { if (result) update3d(result); });
document.querySelectorAll('[data-pump]').forEach((b) => b.addEventListener('click', () => { shownPump = Number(b.dataset.pump); if (result) update3d(result); }));
$('cutBtn').addEventListener('click', tools.cut);
$('flowBtn').addEventListener('click', tools.flow);
$('frameBtn').addEventListener('click', tools.frame);
$('resetBtn').addEventListener('click', tools.reset);

// ---------- Wiring ----------
const DIM_FOR = { D2mm: 'D2mm', trim: 'D2mm', D1mm: 'D1mm', b2mm: 'b2mm', beta2: 'beta2', z: 'z' };
const onHover = (k) => design.highlight(k ? DIM_FOR[k] ?? null : null);
const params = buildParams($('params'), state, onParam, onHover);
function onParam(k, v) {
  state[k] = v;
  update();
}

$('preset').innerHTML = Object.entries(PRESETS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
$('preset').addEventListener('change', (e) => {
  Object.assign(state, stateFromPreset(e.target.value));
  refDesign = snapshot();
  design.fitted = false;
  rebuildParams();
  update();
});
function rebuildParams() {
  Object.assign(paramsRef, buildParams($('params'), state, onParam, onHover));
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
  onTheme: () => { scene3d.setBackground(token('--stage-bg')); if (drawStyle === 'plan') setDrawStyle('plan'); update(); },
  onResize: () => onResize(),
  onTab: (t) => { activeTab = t; if (t === 'design' && view !== 'design') setView('design'); if (result) renderPanes(result); },
  shortcuts: {
    1: () => chrome.setTab('curves'),
    2: () => chrome.setTab('impeller'),
    3: () => chrome.setTab('similarity'),
    4: () => chrome.setTab('design'),
    5: () => chrome.setTab('pid'),
    d: () => { setView('design'); chrome.setTab('design'); },
    b: () => setDrawStyle(drawStyle === 'plan' ? '3d' : 'plan'),
    p: toggleParams,
    x: tools.cut,
    f: tools.flow,
    c: tools.frame,
    r: tools.reset,
    v: tools.view,
  },
});

function renderPanes(r) {
  if (activeTab === 'curves') updateCurves(r);
  else if (activeTab === 'impeller') drawImpellerPane($('impellerPane'), r, pump);
  else if (activeTab === 'similarity') drawSimilarityPane($('similarityPane'), r, pump, state);
  else if (activeTab === 'pid') {
    const { Q, pumps, profile } = installData(r);
    const kPa = Object.fromEntries(profile.map((x) => [x.key, (x.p * r.rho * 9.80665) / 1000]));
    drawPidPane($('pidPane'), { mode: state.mode, Qd: r.spec.Qd, Q, pumps, kPa, Hs: state.Hs, Hgeo: state.Hgeo, valve: state.valve / 100, dark: isDark() });
  } else {
    const { cur, ref } = designData(r);
    drawDesignPane($('designPane'), cur, ref, {
      setRef: () => { refDesign = snapshot(); update(); },
      revert: () => { Object.assign(state, refDesign); rebuildParams(); update(); },
    });
  }
}

function update() {
  result = solve();
  document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x.dataset.mode === state.mode));
  paramsRef.refresh(state);
  updateKpis(result);
  $('warnings').innerHTML = result.warnings.map((w) => `<li>${w}</li>`).join('');
  renderPanes(result);
  update3d(result);
}

function onResize() {
  resize3d();
  if (result) renderPanes(result);
}
new ResizeObserver(onResize).observe($('rightPanel'));
function resize3d() {
  scene3d.resize();
  const host = $('canvasHost');
  if (host.clientWidth && host.clientHeight) { plant.resize(host.clientWidth, host.clientHeight); design.resize(host.clientWidth, host.clientHeight); }
}
new ResizeObserver(resize3d).observe($('viewport'));

scene3d.setBackground(token('--stage-bg'));
update();
setView('plant');
resize3d();
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (view === 'plant') { plant.update(dt); plant.render(); } else if (view === 'design') design.render(); else { scene3d.update(dt); scene3d.render(); }
}
requestAnimationFrame(loop);
