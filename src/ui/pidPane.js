// "Esquema" tab: P&ID of the installation with ISA-style symbols (tanks, centrifugal
// pumps, gate and check valves, pressure indicators PI) and live data on it: line sizes
// and velocities, flow, pressures and the state of each pump. Exports to SVG or PNG.

import { lineList, velocity } from '../physics/piping.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function palette(dark) {
  return dark
    ? { ink: '#e6f0fb', paper: '#0f2a4a', muted: '#8fa8c4', water: '#2c5f94', off: '#8fa8c4', cav: '#ff8a8a', vac: '#ffb27a' }
    : { ink: '#1d2329', paper: '#ffffff', muted: '#6b7480', water: '#cfe3f7', off: '#9aa3ad', cav: '#d03b3b', vac: '#d0611b' };
}

/**
 * @param host element
 * @param d { mode, Qd, Q, pumps: [{ Q, H, n, active, cavitates }], kPa: { key: kPa }, Hs, Hgeo, valve, dark }
 */
export function drawPidPane(host, d) {
  const c = palette(d.dark);
  const W = 660;
  const H = 400;
  const lines = lineList(d.Qd, d.mode);
  const out = [];
  const T = (x, y, s, o = {}) => out.push(`<text x="${x}" y="${y}" font-size="${o.size ?? 10}" font-family="${MONO}" fill="${o.fill ?? c.ink}" text-anchor="${o.anchor ?? 'start'}"${o.bold ? ' font-weight="700"' : ''}>${s}</text>`);
  const P = (pts, o = {}) => out.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${o.stroke ?? c.ink}" stroke-width="${o.w ?? 2}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`);
  const arrow = (x, y, dx, dy, col = c.ink) => {
    const a = Math.atan2(dy, dx);
    const pt = (r, t) => `${x + r * Math.cos(a + t)},${y + r * Math.sin(a + t)}`;
    out.push(`<polygon points="${pt(6, 0)} ${pt(6, 2.5)} ${pt(6, -2.5)}" fill="${col}"/>`);
  };
  // A process line: polyline with flow arrows on long segments and an optional line tag.
  const line = (pts, info, flowQ, o = {}) => {
    const col = flowQ > 1e-6 ? c.ink : c.off;
    P(pts, { stroke: col, dash: flowQ > 1e-6 ? null : '5 3' });
    let best = null;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len > 50 && flowQ > 1e-6) arrow((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, col);
      if (y0 === y1 && (!best || len > best.len)) best = { x: (x0 + x1) / 2, y: y0, len };
    }
    if (info && best && !o.noTag) {
      const v = flowQ > 1e-6 ? `${velocity(flowQ, info.di).toFixed(2)} m/s` : 'sin flujo';
      const y0 = o.below ? best.y + 14 : best.y - 14;
      T(best.x + (o.tagDx ?? 0), y0, info.tag, { anchor: 'middle', bold: true, size: 9.5 });
      T(best.x + (o.tagDx ?? 0), y0 + 10, `DN${info.dn} · ${v}`, { anchor: 'middle', size: 8.5, fill: c.muted });
    }
  };
  // ISA pressure indicator: bubble joined to the tap with an instrument (dashed) line.
  const pi = (x, y, bx, by, no, key) => {
    const kPa = d.kPa[key];
    out.push(`<line x1="${x}" y1="${y}" x2="${bx}" y2="${by}" stroke="${c.ink}" stroke-width="1" stroke-dasharray="3 2"/>`);
    out.push(`<circle cx="${bx}" cy="${by}" r="14" fill="${c.paper}" stroke="${c.ink}" stroke-width="1.4"/>`);
    out.push(`<line x1="${bx - 14}" y1="${by}" x2="${bx + 14}" y2="${by}" stroke="${c.ink}" stroke-width="1"/>`);
    T(bx, by - 3, 'PI', { anchor: 'middle', size: 9, bold: true });
    T(bx, by + 10, no, { anchor: 'middle', size: 8.5 });
    if (Number.isFinite(kPa)) T(bx + 18, by + 4, `${kPa.toFixed(0)} kPa`, { size: 9.5, bold: true, fill: kPa < 0 ? c.vac : c.ink });
  };
  // Centrifugal pump: circle, tangential discharge at the top, base triangle.
  const pump = (cx, cy, i) => {
    const s = d.pumps[i] ?? { active: false };
    const col = !s.active ? c.off : s.cavitates ? c.cav : c.ink;
    const r = 17;
    out.push(`<path d="M${cx - 11},${cy + 13} L${cx - 16},${cy + 22} L${cx + 16},${cy + 22} L${cx + 11},${cy + 13}" fill="none" stroke="${col}" stroke-width="1.4"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.paper}" stroke="${col}" stroke-width="2"/>`);
    out.push(`<line x1="${cx}" y1="${cy - r}" x2="${cx + r + 4}" y2="${cy - r}" stroke="${col}" stroke-width="2"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${col}"/>`);
    const letter = String.fromCharCode(65 + i);
    T(cx, cy + 36, `P-101${d.mode === 'single' ? '' : letter}`, { anchor: 'middle', bold: true, fill: col });
    T(cx, cy + 47, s.active ? `${(s.Q * 3600).toFixed(0)} m³/h · ${s.H.toFixed(1)} m` : 'sin aporte', { anchor: 'middle', size: 8.5, fill: col });
    if (s.cavitates) T(cx, cy + 58, 'CAVITA', { anchor: 'middle', size: 8.5, bold: true, fill: c.cav });
    return { inlet: [cx - r, cy], outlet: [cx + r + 4, cy - r] };
  };
  // Gate valve (bow-tie with hand-wheel stem) and check valve (bow-tie, one side filled).
  const gate = (x, y, vertical = false) => {
    const pts = vertical ? `${x - 7},${y - 9} ${x + 7},${y - 9} ${x - 7},${y + 9} ${x + 7},${y + 9}` : `${x - 9},${y - 7} ${x - 9},${y + 7} ${x + 9},${y - 7} ${x + 9},${y + 7}`;
    out.push(`<polygon points="${pts}" fill="${c.paper}" stroke="${c.ink}" stroke-width="1.6"/>`);
    out.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y - 16}" stroke="${c.ink}" stroke-width="1.4"/><line x1="${x - 6}" y1="${y - 16}" x2="${x + 6}" y2="${y - 16}" stroke="${c.ink}" stroke-width="1.6"/>`);
  };
  const check = (x, y) => {
    out.push(`<polygon points="${x - 9},${y - 7} ${x - 9},${y + 7} ${x},${y}" fill="${c.paper}" stroke="${c.ink}" stroke-width="1.6"/>`);
    out.push(`<polygon points="${x + 9},${y - 7} ${x + 9},${y + 7} ${x},${y}" fill="${c.ink}" stroke="${c.ink}" stroke-width="1.6"/>`);
  };
  // Atmospheric tank with liquid level and level mark.
  const tank = (x, y, w, h, levelFrac, tagTxt, service, el) => {
    const ly = y + h * (1 - levelFrac);
    out.push(`<rect x="${x}" y="${ly}" width="${w}" height="${y + h - ly}" fill="${c.water}" stroke="none"/>`);
    out.push(`<path d="M${x},${y} L${x},${y + h} L${x + w},${y + h} L${x + w},${y}" fill="none" stroke="${c.ink}" stroke-width="2"/>`);
    out.push(`<line x1="${x - 4}" y1="${y}" x2="${x + w + 4}" y2="${y}" stroke="${c.ink}" stroke-width="1" stroke-dasharray="4 3"/>`);
    out.push(`<line x1="${x}" y1="${ly}" x2="${x + w}" y2="${ly}" stroke="${c.ink}" stroke-width="1"/>`);
    out.push(`<polygon points="${x + w - 18},${ly - 9} ${x + w - 8},${ly - 9} ${x + w - 13},${ly - 1}" fill="none" stroke="${c.ink}" stroke-width="1.2"/>`);
    T(x + w - 22, ly - 2, `N.A. ${el}`, { anchor: 'end', size: 8.5 });
    T(x + w / 2, y - 18, tagTxt, { anchor: 'middle', bold: true });
    T(x + w / 2, y - 7, service, { anchor: 'middle', size: 8.5, fill: c.muted });
  };
  const elev = (v) => `${v > 0.004 ? '+' : v < -0.004 ? '−' : '±'}${Math.abs(v).toFixed(2)} m`;

  // ---- Layout ----
  const yS = 290; // suction / pump axis
  const yD = 90; // discharge header
  const xTank2 = 560;
  tank(22, 200, 100, 110, 0.62, 'TK-01', 'tanque de aspiración', elev(d.Hs));
  // Elevated discharge tank on a support.
  tank(xTank2, 50, 80, 80, 0.55, 'TK-02', 'tanque elevado', elev(d.Hs + d.Hgeo));
  out.push(`<path d="M${xTank2 + 10},130 L${xTank2 + 10},${H - 30} M${xTank2 + 70},130 L${xTank2 + 70},${H - 30} M${xTank2 + 10},170 L${xTank2 + 70},210 M${xTank2 + 70},170 L${xTank2 + 10},210" stroke="${c.muted}" stroke-width="1" fill="none"/>`);
  out.push(`<line x1="10" y1="${H - 30}" x2="${W - 10}" y2="${H - 30}" stroke="${c.muted}" stroke-width="1"/>`);
  T(W - 12, H - 34, 'escala vertical no representativa', { anchor: 'end', size: 8, fill: c.muted });

  const Qtot = d.Q;
  const QA = d.pumps[0]?.Q ?? 0;
  const QB = d.pumps[1]?.Q ?? 0;
  const nozzle = [122, yS];
  let riserX;
  let riserBottom;
  if (d.mode === 'single') {
    const p = pump(250, yS, 0);
    line([nozzle, p.inlet], lines.suction, Qtot);
    pi(180, yS, 180, yS - 50, '01', 'suction');
    riserX = 320;
    line([p.outlet, [riserX, p.outlet[1]]], null, Qtot);
    riserBottom = p.outlet[1];
  } else if (d.mode === 'series') {
    const a = pump(200, yS, 0);
    const b = pump(340, yS, 1);
    line([nozzle, a.inlet], lines.suction, Qtot, { noTag: false });
    pi(160, yS, 160, yS - 50, '01', 'suction');
    line([a.outlet, [260, a.outlet[1]], [260, yS], b.inlet], lines.between, Qtot);
    pi(285, yS, 285, yS - 50, '02', 'between');
    riserX = 400;
    line([b.outlet, [riserX, b.outlet[1]]], null, Qtot);
    riserBottom = b.outlet[1];
  } else {
    const yA = yS - 50;
    const yB = yS + 30;
    const a = pump(250, yA, 0);
    const b = pump(250, yB, 1);
    const xh = 165;
    line([nozzle, [xh, yS]], lines.suction, Qtot, { below: true, tagDx: 16 });
    pi(140, yS, 140, yS + 60, '01', 'suction');
    out.push(`<circle cx="${xh}" cy="${yS}" r="2.5" fill="${c.ink}"/>`);
    line([[xh, yS], [xh, yA], a.inlet], lines.suctionBranch, QA, { tagDx: 6 });
    line([[xh, yS], [xh, yB], b.inlet], null, QB);
    riserX = 360;
    line([a.outlet, [riserX, a.outlet[1]]], lines.dischargeBranch, QA, { tagDx: 0 });
    line([b.outlet, [riserX, b.outlet[1]]], null, QB);
    for (const [y, l] of [[a.outlet[1], 'A'], [b.outlet[1], 'B']]) {
      check(318, y);
      T(318, y + 18, `CV-${l}`, { anchor: 'middle', size: 8.5, bold: true });
    }
    out.push(`<circle cx="${riserX}" cy="${a.outlet[1]}" r="2.5" fill="${c.ink}"/>`);
    riserBottom = b.outlet[1];
  }
  // Discharge: riser, header to the valve and the elevated tank.
  const xValve = riserX + (xTank2 - riserX) * 0.45;
  line([[riserX, riserBottom], [riserX, yD], [xValve - 9, yD]], lines.discharge, Qtot, { tagDx: -10 });
  line([[xValve + 9, yD], [xTank2 - 20, yD], [xTank2 - 20, 70], [xTank2, 70]], null, Qtot);
  gate(xValve, yD);
  T(xValve, yD - 30, 'V-01', { anchor: 'middle', bold: true });
  T(xValve, yD + 20, `abierta ${(d.valve * 100).toFixed(0)} %`, { anchor: 'middle', size: 8.5, fill: c.muted });
  pi(riserX, (riserBottom + yD) / 2, riserX + 40, (riserBottom + yD) / 2, d.mode === 'series' ? '03' : '02', 'discharge');
  pi(xValve + 50, yD, xValve + 50, yD + 46, d.mode === 'series' ? '04' : '03', 'valveOut');

  // Title block.
  const modeTxt = { single: 'una bomba', series: 'dos bombas en serie', parallel: 'dos bombas en paralelo' }[d.mode];
  const bx = 10;
  const by = 10;
  out.push(`<rect x="${bx}" y="${by}" width="200" height="44" fill="${c.paper}" stroke="${c.ink}" stroke-width="1.2"/>`);
  out.push(`<line x1="${bx}" y1="${by + 18}" x2="${bx + 200}" y2="${by + 18}" stroke="${c.ink}" stroke-width="0.8"/>`);
  T(bx + 6, by + 13, 'P&amp;ID · BOMBEO DE AGUA', { bold: true, size: 9.5 });
  T(bx + 6, by + 30, `${modeTxt} · Q = ${(Qtot * 3600).toFixed(0)} m³/h`, { size: 8.5 });
  T(bx + 6, by + 41, `Bomba Lab · ${new Date().toLocaleDateString('sv')}`, { size: 8.5, fill: c.muted });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="P&amp;ID de la instalación"><rect width="${W}" height="${H}" fill="${c.paper}"/>${out.join('')}</svg>`;
  const lineRows = Object.values(lines).map((l) => `<tr><td>${l.tag}</td><td>${l.service}</td><td>DN${l.dn} (${l.nps})</td><td>${(l.di * 1000).toFixed(1)} mm</td></tr>`).join('');
  host.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Esquema P&amp;ID</h3><span class="note">símbolos ISA 5.1 · datos en vivo</span></div>
      <div class="pid">${svg}</div>
      <div class="design-actions">
        <button class="btn ghost" id="pidSvg">Descargar SVG</button>
        <button class="btn ghost" id="pidPng">Descargar PNG</button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Lista de líneas</h3><span class="note">dimensionadas a Q de diseño · aspiración ≤ 1.5 m/s, descarga ≤ 2.5 m/s</span></div>
      <table class="data"><tr><th>Línea</th><th>Servicio</th><th>Diámetro</th><th>Di (Sch 40)</th></tr>${lineRows}</table>
    </section>`;
  host.querySelector('#pidSvg').addEventListener('click', () => download(new Blob([svg], { type: 'image/svg+xml' }), 'pid-bomba-lab.svg'));
  host.querySelector('#pidPng').addEventListener('click', () => svgToPng(svg, W, H).then((b) => download(b, 'pid-bomba-lab.png')));
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Rasterize an SVG string at 2× for a sharp PNG. */
export function svgToPng(svg, W, H, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg.replace('width="100%"', `width="${W}" height="${H}"`)], { type: 'image/svg+xml' }));
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = W * scale;
      cv.height = H * scale;
      const ctx = cv.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      cv.toBlob(resolve, 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
}
