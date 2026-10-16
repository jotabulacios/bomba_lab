// "Rodete" tab: velocity triangles at the impeller inlet and outlet (with and without
// slip), the blade plan view, and how β2 changes the theoretical head and the degree of
// reaction (apunte 13, p. 22). Angles as in the notes: β from the tangential direction.

import { G } from '../physics/fluid.js';
import { drawCurves } from './curves.js';

const RAD = Math.PI / 180;
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function arrow(x0, y0, x1, y1, cls, label, dash = false) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const h = 7;
  const head = `M${x1},${y1} L${x1 - h * Math.cos(a - 0.4)},${y1 - h * Math.sin(a - 0.4)} L${x1 - h * Math.cos(a + 0.4)},${y1 - h * Math.sin(a + 0.4)} Z`;
  return `<line class="vec ${cls}" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" ${dash ? 'stroke-dasharray="4 3"' : ''}/>
    <path class="vec-head ${cls}" d="${head}"/>
    ${label ? `<text class="vec-label" x="${(x0 + x1) / 2 + 5}" y="${(y0 + y1) / 2 - 5}">${label}</text>` : ''}`;
}

/** One triangle: u along +x, cm up. c = (cu, cm), w = c − u. */
function triangle(title, { u, cu, cm, cuInf }, W) {
  // Each triangle gets its own scale (they differ a lot in size); angles stay true.
  const scale = (W - 34) / Math.max(u, Math.abs(cu), cuInf ?? 0, 1);
  const Ht = Math.max(80, cm * scale + 60);
  const ox = 16;
  const oy = Ht - 26;
  const X = (v) => ox + v * scale;
  const Y = (v) => oy - v * scale;
  const beta = Math.atan2(cm, u - cu) / RAD; // between w and −u
  const alpha = Math.atan2(cm, cu) / RAD;
  return `<svg class="tri" viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img" aria-label="${title}">
    <text class="tri-title" x="6" y="14">${title}</text>
    <line class="tri-base" x1="${ox - 6}" y1="${oy}" x2="${W - 6}" y2="${oy}"/>
    ${arrow(X(0), Y(0), X(u), Y(0), 'u', 'u')}
    ${cuInf !== undefined ? arrow(X(0), Y(0), X(cuInf), Y(cm), 'c', '', true) : ''}
    ${arrow(X(0), Y(0), X(cu), Y(cm), 'c', 'c')}
    ${arrow(X(u), Y(0), X(cu), Y(cm), 'w', 'w')}
    <text class="tri-ang" x="6" y="${Ht - 6}">α ${fmt(alpha)}° · β ${fmt(beta)}° · c ${fmt(Math.hypot(cu, cm))} · w ${fmt(Math.hypot(u - cu, cm))} m/s</text>
  </svg>`;
}

/** Plan view of the impeller: z camber lines from r1 to r2 (β1 → β2). */
function planView(g, beta1, W) {
  // Room above the impeller for the rotation arrow and below it for the two label lines.
  const H = 262;
  const R = 92;
  const cx = W / 2;
  const cy = 30 + R + 8;
  const r1 = g.D1 / g.D2;
  const N = 40;
  const betaAt = (r) => beta1 + ((g.beta2 - beta1) * (r - r1)) / (1 - r1);
  const pts = [[r1, 0]];
  for (let i = 1; i <= N; i++) {
    const ra = r1 + ((1 - r1) * (i - 1)) / N;
    const rb = r1 + ((1 - r1) * i) / N;
    const rm = (ra + rb) / 2;
    pts.push([rb, pts[i - 1][1] - (rb - ra) / (rm * Math.tan(betaAt(rm) * RAD))]);
  }
  const blades = Array.from({ length: g.z }, (_, k) => {
    const off = (k * 2 * Math.PI) / g.z;
    return `<path class="plan-blade" d="${pts.map(([r, t], i) => `${i ? 'L' : 'M'}${cx + R * r * Math.cos(t + off)},${cy - R * r * Math.sin(t + off)}`).join('')}"/>`;
  }).join('');
  return `<svg class="plan" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Rodete en planta">
    <circle class="plan-ring" cx="${cx}" cy="${cy}" r="${R}"/>
    <circle class="plan-ring" cx="${cx}" cy="${cy}" r="${R * r1}"/>
    ${blades}
    <path class="plan-rot" d="M${cx + 34},${cy - R - 10} A${R + 14},${R + 14} 0 0 0 ${cx - 34},${cy - R - 10}"/>
    <path class="plan-rot-head" d="M${cx - 34},${cy - R - 10} l9,-5 l-1,10 z"/>
    <text class="plan-txt" x="${cx}" y="${cy - R - 18}" text-anchor="middle">giro</text>
    <text class="plan-txt" x="6" y="${H - 20}">D1 = ${(g.D1 * 1000).toFixed(0)} mm · β1 = ${beta1.toFixed(1)}°</text>
    <text class="plan-txt" x="6" y="${H - 6}">D2 = ${(g.D2 * 1000).toFixed(0)} mm · β2 = ${g.beta2.toFixed(0)}° · z = ${g.z}</text>
  </svg>`;
}

export function drawImpellerPane(host, r, pump) {
  const p = r.pA ?? pump.at(0, r.optsA);
  const s = r.spec;
  const W = Math.max(280, host.clientWidth || 360);
  const half = Math.floor((W - 8) / 2);
  const g = { ...s, D2: r.D2 };

  // H_t∞ and reaction vs β2 at the current flow (apunte p. 22).
  const pts = [];
  for (let b = 10; b <= 150; b += 2) {
    const cot = 1 / Math.tan(b * RAD);
    const Ht = (p.U2 * (p.U2 - p.cm2 * cot)) / G;
    const c2u = p.U2 - p.cm2 * cot;
    const react = 1 - (p.cm2 ** 2 + c2u ** 2 - p.cm1 ** 2) / (2 * G * Ht);
    pts.push([b, Ht, react]);
  }

  host.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Triángulos de velocidades</h3><span class="note">β desde la tangente · entrada sin prerrotación</span></div>
      <div class="vec-legend"><span><i class="sw-c"></i>c absoluta</span><span><i class="sw-w"></i>w relativa</span><span><i class="sw-u"></i>u del álabe</span><span class="unit">- - c2 sin resbalamiento · escalas distintas</span></div>
      <div class="tri-row">
        ${triangle('1 · entrada', { u: p.U1, cu: 0, cm: p.cm1 }, half)}
        ${triangle('2 · salida', { u: p.U2, cu: p.c2u, cm: p.cm2, cuInf: s.slip ? p.c2uInf : undefined }, half)}
      </div>
      <p class="note">Incidencia en la entrada: ${fmt(p.incidence)}° (β1 del álabe ${fmt(pump.beta1)}° contra ${fmt(p.beta1Flow)}° del flujo). Es cero en el Q de diseño; ${p.incidence > 0.5 ? 'a este caudal (menor) el flujo pega en la cara de presión y aparece la pérdida por choque.' : p.incidence < -0.5 ? 'a este caudal (mayor) el flujo pega del lado de succión: más choque y más ANPAr.' : 'acá prácticamente no hay choque.'}</p>
    </section>
    <section class="card">
      <div class="card-head"><h3>Rodete en planta</h3></div>
      ${planView(g, pump.beta1, W - 22)}
    </section>
    <section class="card">
      <div class="card-head"><h3>Efecto de β2</h3><span class="note">al caudal actual, sin resbalamiento</span></div>
      <div id="betaCharts"></div>
      <p class="note">Hacia adelante (β2 > 90°) da más altura teórica, pero baja el grado de reacción: más energía queda como velocidad y hay que recuperarla en la voluta, con pérdidas. Por eso las bombas usan β2 < 90° (apunte 13, p. 22).</p>
    </section>
    <dl class="stats">
      ${[
        ['U1 / U2', `${fmt(p.U1)} / ${fmt(p.U2)} m/s`], ['cm1 / cm2', `${fmt(p.cm1, 2)} / ${fmt(p.cm2, 2)} m/s`],
        ['c2u (σ = ' + fmt(pump.sigma, 3) + ')', `${fmt(p.c2u)} m/s`], ['H_t∞ / H_TR', `${fmt(p.HtInf)} / ${fmt(p.Htr)} m`],
        ['H real', `${fmt(p.H)} m`], ['Grado de reacción', fmt(p.reaction, 2)],
        ['ηh', fmt(p.etaH, 3)], ['ηv', fmt(p.etaV, 3)], ['ηm', fmt(p.etaM, 3)],
      ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
    </dl>`;

  drawCurves(host.querySelector('#betaCharts'), {
    xMax: 150, xLabel: 'β2 (°): < 90 hacia atrás · 90 radial · > 90 hacia adelante',
    charts: [
      { key: 'ht', title: 'Altura teórica H_t∞', unit: 'm', digits: 1, vline: s.beta2, series: [{ name: 'H_t∞', cls: 's1', pts: pts.map(([b, h]) => [b, h]) }] },
      { key: 'rx', title: 'Grado de reacción', unit: '', digits: 2, yMax: 1, vline: s.beta2, series: [{ name: 'σ', cls: 's1', pts: pts.map(([b, , x]) => [b, Math.max(0, x)]) }] },
    ],
  });
}
