// Small multiples of the pump characteristics sharing the Q axis (no dual axes):
// H–Q with the system curve and the operating point, η–Q, P–Q and ANPA–Q with the
// cavitation zone. One crosshair and tooltip follow the pointer across all charts.

const W_MIN = 280;
const H_CHART = 150;
const M = { l: 42, r: 12, t: 22, b: 18 };

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

function ticks(max, target) {
  const step = niceStep(max, target);
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Linear interpolation of y at x on a polyline sorted by x (null outside). */
function yAt(pts, x) {
  if (!pts.length || x < pts[0][0] || x > pts.at(-1)[0]) return null;
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return null;
}

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

/**
 * @param host element
 * @param model {
 *   xMax: number (m³/h), xLabel,
 *   charts: [{ key, title, unit, digits, yMax?, vline?, series: [{ name, cls, dash?, points?, pts: [[x, y]] }],
 *              markers?: [{ x, y, label, cls }], bands?: [{ x0, x1, label, cls }] }]
 * }
 */
export function drawCurves(host, model) {
  const W = Math.max(W_MIN, host.clientWidth || 360);
  const iw = W - M.l - M.r;
  const ih = H_CHART - M.t - M.b;
  const X = (x) => M.l + (x / model.xMax) * iw;
  const xt = ticks(model.xMax, 5);

  const blocks = model.charts.map((c) => {
    const ys = c.series.flatMap((s) => s.pts.map((p) => p[1])).filter((v) => Number.isFinite(v));
    const yMax = c.yMax ?? Math.max(1e-9, ...ys) * 1.08;
    const yt = ticks(yMax, 3);
    const top = yt.at(-1) >= yMax ? yt.at(-1) : yMax;
    const Y = (y) => M.t + ih - (y / top) * ih; // lines past the frame are clipped, not flattened
    const clip = `cv-clip-${c.key}-${Math.random().toString(36).slice(2, 7)}`;
    const path = (pts) => pts.filter((p) => Number.isFinite(p[1])).map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const legend = c.series.length > 1
      ? `<g class="cv-legend">${c.series.map((s, i) => `<g transform="translate(${M.l + i * 96},${10})">${s.points ? `<rect class="cv-pt ${s.cls}" x="3" y="-4" width="8" height="8"/>` : `<line class="cv-line ${s.cls}" x1="0" x2="14" y1="0" y2="0" ${s.dash ? 'stroke-dasharray="4 3"' : ''}/>`}<text x="18" y="3">${s.name}</text></g>`).join('')}</g>`
      : '';
    const svg = `<svg class="cv" viewBox="0 0 ${W} ${H_CHART}" width="${W}" height="${H_CHART}" role="img" aria-label="${c.title}">
      ${legend}
      <text class="cv-unit" x="${M.l - 6}" y="${M.t - 6}" text-anchor="end">${c.unit}</text>
      <g class="cv-grid">${yt.map((v) => `<line x1="${M.l}" x2="${M.l + iw}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>
      ${(c.bands ?? []).map((b) => `<rect class="cv-band ${b.cls}" x="${X(b.x0)}" y="${M.t}" width="${Math.max(0, X(Math.min(b.x1, model.xMax)) - X(b.x0))}" height="${ih}"/>
        <text class="cv-band-label" x="${X(b.x0) + 4}" y="${M.t + 11}">${b.label}</text>`).join('')}
      ${Number.isFinite(c.vline) ? `<line class="cv-op" x1="${X(c.vline)}" x2="${X(c.vline)}" y1="${M.t}" y2="${M.t + ih}"/>` : ''}
      <defs><clipPath id="${clip}"><rect x="${M.l}" y="${M.t - 2}" width="${iw}" height="${ih + 4}"/></clipPath></defs>
      <g clip-path="url(#${clip})">${c.series.map((s) => (s.points
        ? s.pts.filter((p) => Number.isFinite(p[1])).map((p) => `<rect class="cv-pt ${s.cls}" x="${(X(p[0]) - 4).toFixed(1)}" y="${(Y(p[1]) - 4).toFixed(1)}" width="8" height="8"/>`).join('')
        : `<path class="cv-line ${s.cls}" d="${path(s.pts)}" ${s.dash ? 'stroke-dasharray="4 3"' : ''}/>`)).join('')}</g>
      ${(c.markers ?? []).map((m) => `<circle class="cv-marker ${m.cls}" cx="${X(m.x)}" cy="${Y(m.y)}" r="5"/>`
        + (m.label ? `<text class="cv-mlabel" x="${X(m.x) + 8}" y="${Y(m.y) - 7}">${m.label}</text>` : '')).join('')}
      <g class="cv-axis">
        ${yt.map((v) => `<text x="${M.l - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
        ${xt.map((v) => `<text x="${X(v)}" y="${H_CHART - 4}" text-anchor="middle">${v}</text>`).join('')}
      </g>
      <line class="cv-cross" x1="0" x2="0" y1="${M.t}" y2="${M.t + ih}" visibility="hidden"/>
      <rect class="cv-hit" x="${M.l}" y="${M.t}" width="${iw}" height="${ih}"/>
    </svg>`;
    return { c, svg };
  });

  host.innerHTML = `${blocks.map((b) => `<figure class="cv-fig"><figcaption>${b.c.title}</figcaption>${b.svg}</figure>`).join('')}
    <p class="cv-xlabel">${model.xLabel}</p>`;

  const t = tooltip();
  const svgs = [...host.querySelectorAll('svg.cv')];
  const move = (e, svg) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const x = Math.min(Math.max(((px - M.l) / iw) * model.xMax, 0), model.xMax);
    for (const s of svgs) {
      const cr = s.querySelector('.cv-cross');
      cr.setAttribute('x1', X(x));
      cr.setAttribute('x2', X(x));
      cr.setAttribute('visibility', 'visible');
    }
    const rows = model.charts.flatMap((c) => c.series.map((s) => {
      // Measured points are not interpolated: show one only when the cursor is on it.
      const near = s.points ? s.pts.find((p) => Math.abs(p[0] - x) < model.xMax * 0.025) : null;
      const y = s.points ? (near ? near[1] : null) : yAt(s.pts, x);
      return y === null ? '' : `<div><i class="sw ${s.cls}"></i>${s.name}: <b>${y.toFixed(c.digits ?? 1)}</b> ${c.unit}</div>`;
    })).join('');
    t.hidden = false;
    t.innerHTML = `<div><b>Q = ${x.toFixed(0)} m³/h</b></div>${rows}`;
    t.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 240)}px`;
    t.style.top = `${e.clientY + 14}px`;
  };
  for (const s of svgs) {
    const hit = s.querySelector('.cv-hit');
    hit.addEventListener('pointermove', (e) => move(e, s));
    hit.addEventListener('pointerleave', () => {
      t.hidden = true;
      for (const o of svgs) o.querySelector('.cv-cross').setAttribute('visibility', 'hidden');
    });
  }
}

/** Plain table of the same data (accessibility / exact values). */
export function curvesTable(table, rows) {
  table.innerHTML = `<tr><th>Q (m³/h)</th><th>H (m)</th><th>H sist (m)</th><th>ηT (%)</th><th>P (kW)</th><th>ANPAd (m)</th><th>ANPAr (m)</th></tr>${
    rows.map((r) => `<tr><td>${r.Q.toFixed(0)}</td><td>${r.H.toFixed(1)}</td><td>${r.Hs.toFixed(1)}</td><td>${(r.eta * 100).toFixed(1)}</td><td>${r.P.toFixed(1)}</td><td>${r.npsha.toFixed(2)}</td><td>${r.npshr.toFixed(2)}</td></tr>`).join('')}`;
}
