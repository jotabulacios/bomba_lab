// Title block (cajetín) of the design drawing and "save the drawing as PNG": the WebGL
// frame plus every visible HTML annotation (dimension labels, cut letters, title block)
// redrawn on a 2-D canvas at their screen positions.

const $ = (id) => document.getElementById(id);

/**
 * @param d { z, beta2, D2mm, Qh, H, n, view, scale }
 */
export function updateTitleBlock(d) {
  $('tbTitle').textContent = `BOMBA CENTRÍFUGA · RODETE z = ${d.z}, β2 = ${d.beta2.toFixed(0)}°, D2 = ${d.D2mm.toFixed(0)} mm`;
  $('tbView').textContent = d.view;
  $('tbScale').textContent = d.scale;
  $('tbDesign').textContent = `Q ${d.Qh.toFixed(0)} m³/h · H ${d.H.toFixed(1)} m · n ${d.n.toFixed(0)} rpm`;
  $('tbDate').textContent = new Date().toLocaleDateString('es-AR');
}

function drawElement(ctx, el, ox, oy) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const cs = getComputedStyle(el);
  const x = r.left - ox;
  const y = r.top - oy;
  const bg = cs.backgroundColor;
  if (bg && bg !== 'transparent' && !bg.endsWith(', 0)')) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, r.width, r.height);
  }
  const bw = parseFloat(cs.borderTopWidth) || 0;
  if (bw > 0 && cs.borderTopStyle !== 'none') {
    ctx.strokeStyle = cs.borderTopColor;
    ctx.lineWidth = bw;
    ctx.strokeRect(x + bw / 2, y + bw / 2, r.width - bw, r.height - bw);
  }
  if (el.children.length) {
    for (const c of el.children) drawElement(ctx, c, ox, oy);
    return;
  }
  const text = el.textContent.trim();
  if (!text) return;
  ctx.fillStyle = cs.color;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = cs.textAlign === 'center' ? 'center' : 'left';
  const px = ctx.textAlign === 'center' ? x + r.width / 2 : x + (parseFloat(cs.paddingLeft) || 0) + bw;
  ctx.fillText(text, px, y + r.height / 2);
}

/**
 * Save the current design drawing.
 * @param view    a scene with render() and renderer
 * @param host    the viewport element (background and annotations)
 * @param selector annotations to include
 */
export function exportDrawing(view, host, selector, name) {
  const gl = view.renderer.domElement;
  const box = gl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement('canvas');
  cv.width = Math.round(box.width * dpr);
  cv.height = Math.round(box.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const hostBg = getComputedStyle(host).backgroundColor;
  ctx.fillStyle = hostBg && !hostBg.endsWith(', 0)') ? hostBg : '#ffffff';
  ctx.fillRect(0, 0, box.width, box.height);
  view.render(); // the drawing buffer is only valid right after a render
  ctx.drawImage(gl, 0, 0, box.width, box.height);
  for (const el of host.querySelectorAll(selector)) {
    if (el.offsetParent === null || getComputedStyle(el).display === 'none') continue;
    drawElement(ctx, el, box.left, box.top);
  }
  cv.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
