// "Plano" (technical drawing) style shared by the three 3-D views: flat light-grey
// fills with crisp black edges, dash-dot centre lines, ISO dimension lines with arrows,
// level marks (▽), flow arrows, ISA instrument bubbles and equipment tags, and an
// orthographic camera that keeps the orbit controls.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const INK = 0x1d2329;
export const INK_BLUEPRINT = 0xe6f0fb;

// Materials are cached per clipping-plane set, so a cut view and an uncut one never
// share a material by accident.
const clipIds = new WeakMap();
let clipCount = 0;
function clipKey(planes) {
  if (!planes || !planes.length) return '-';
  return planes.map((p) => {
    if (!clipIds.has(p)) clipIds.set(p, ++clipCount);
    return clipIds.get(p);
  }).join(',');
}

const flatCache = new Map();
/** Flat fill (no lighting) pushed back slightly so its edges draw on top. */
export function flatMaterial(color, opts = {}) {
  const key = `${color}-${opts.opacity ?? 1}-${clipKey(opts.clippingPlanes)}`;
  if (!flatCache.has(key)) {
    flatCache.set(key, new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, depthWrite: (opts.opacity ?? 1) >= 1,
      clippingPlanes: opts.clippingPlanes ?? null,
    }));
  }
  return flatCache.get(key);
}

const outlineCache = new Map();
/**
 * Silhouette outline (inverted hull): the back faces pushed out along the normals, in ink.
 * Gives curved parts (pipes, spheres, tori) the contour a drawing needs from any angle.
 */
export function outlineMaterial(width, dark, clippingPlanes = null) {
  const key = `${width}-${dark}-${clipKey(clippingPlanes)}`;
  if (!outlineCache.has(key)) {
    const m = new THREE.MeshBasicMaterial({ color: dark ? INK_BLUEPRINT : INK, side: THREE.BackSide, clippingPlanes });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${width.toFixed(5)};`);
    };
    m.customProgramCacheKey = () => `outline-${width}`;
    outlineCache.set(key, m);
  }
  return outlineCache.get(key);
}

const NO_OUTLINE = new Set(['BoxGeometry', 'PlaneGeometry', 'CircleGeometry', 'EdgesGeometry']);

const edgeCache = new Map();
export function edgeMaterial(dark, clippingPlanes = null) {
  const key = `${dark}-${clipKey(clippingPlanes)}`;
  if (!edgeCache.has(key)) edgeCache.set(key, new THREE.LineBasicMaterial({ color: dark ? INK_BLUEPRINT : INK, clippingPlanes }));
  return edgeCache.get(key);
}

/**
 * Switch every mesh under `root` between its own material and the drawing style:
 * flat fill (userData.planColor or a default grey) plus black feature edges.
 * Meshes with userData.noPlan keep their material (e.g. water, particles).
 */
export function applyPlanStyle(root, on, dark = false, outlineWidth = 0.025) {
  const fillDefault = dark ? 0x1e3a5c : 0xeef0f2;
  const meshes = [];
  // Instanced meshes (particles, bubbles) and fat lines keep their look.
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && !o.material?.isLineMaterial && !o.userData.noPlan && !o.userData.isOutline && !o.userData.isStencil) meshes.push(o);
  });
  for (const o of meshes) {
    if (on) {
      if (!o.userData.matOrig) o.userData.matOrig = o.material;
      const clip = o.userData.matOrig.clippingPlanes ?? null;
      const fill = dark ? (o.userData.planColorDark ?? fillDefault) : (o.userData.planColor ?? fillDefault);
      o.material = flatMaterial(fill, { clippingPlanes: clip, opacity: o.userData.planOpacity ?? 1 });
      if (!o.userData.edges) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, o.userData.edgeAngle ?? 28), edgeMaterial(dark, clip));
        e.userData.isEdge = true;
        o.add(e);
        o.userData.edges = e;
      }
      if (o.userData.edges) { o.userData.edges.visible = true; o.userData.edges.material = edgeMaterial(dark, clip); }
      const solid = (o.userData.planOpacity ?? 1) >= 1 && !NO_OUTLINE.has(o.geometry.type) && !o.userData.noOutline;
      if (solid && !o.userData.outline) {
        const h = new THREE.Mesh(o.geometry, outlineMaterial(outlineWidth, dark, clip));
        h.userData.isOutline = true;
        h.raycast = () => {};
        o.add(h);
        o.userData.outline = h;
      }
      if (o.userData.outline) { o.userData.outline.visible = solid; o.userData.outline.material = outlineMaterial(outlineWidth, dark, clip); }
    } else if (o.userData.matOrig) {
      o.material = o.userData.matOrig;
      if (o.userData.edges) o.userData.edges.visible = false;
      if (o.userData.outline) o.userData.outline.visible = false;
    }
  }
}

/** Dash-dot centre line (approximated with a long-dash pattern). */
export function centerLine(a, b, dark = false) {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineDashedMaterial({ color: dark ? INK_BLUEPRINT : 0x6b7480, dashSize: 0.32, gapSize: 0.1 }));
  l.computeLineDistances();
  l.userData.drawing = true;
  return l;
}

function css(cls, html) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return new CSS2DObject(el);
}

/**
 * ISO dimension between points a and b, offset along `dir` (unit vector): extension
 * lines, a dimension line with two arrowheads and the value as text.
 */
export function dimension(a, b, dir, offset, text, dark = false) {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: dark ? INK_BLUEPRINT : INK });
  const a2 = a.clone().addScaledVector(dir, offset);
  const b2 = b.clone().addScaledVector(dir, offset);
  const ext = offset * 0.15 * Math.sign(offset || 1);
  const seg = (p, q) => g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), mat));
  seg(a.clone().addScaledVector(dir, Math.sign(offset) * 0.03), a2.clone().addScaledVector(dir, ext));
  seg(b.clone().addScaledVector(dir, Math.sign(offset) * 0.03), b2.clone().addScaledVector(dir, ext));
  seg(a2, b2);
  const len = a2.distanceTo(b2);
  const head = Math.min(0.09, len * 0.2);
  const along = b2.clone().sub(a2).normalize();
  for (const [p, d] of [[a2, along], [b2, along.clone().negate()]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.32, head, 10), new THREE.MeshBasicMaterial({ color: dark ? INK_BLUEPRINT : INK }));
    cone.position.copy(p).addScaledVector(d, head / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate());
    cone.userData.noPlan = true;
    g.add(cone);
  }
  const t = css('iso-dim', text);
  t.position.copy(a2).add(b2).multiplyScalar(0.5);
  g.add(t);
  g.userData.drawing = true;
  return g;
}

/** Level mark ▽ with its elevation, e.g. "▽ +2.00 m". */
export function levelMark(pos, text) {
  const t = css('level-mark', `<span class="tri">▽</span>${text}`);
  t.position.copy(pos);
  t.center.set(0, 1);
  return t;
}

/** ISA instrument bubble: function letters over the loop number, and a live value. */
export function instrumentBubble(pos, letters, number) {
  const t = css('isa-bubble', `<div class="circle"><b>${letters}</b><span>${number}</span></div><div class="val"></div>`);
  t.position.copy(pos);
  return t;
}

/** Equipment / line tag. */
export function tag(pos, html, cls = 'eq-tag') {
  const t = css(cls, html);
  t.position.copy(pos);
  return t;
}

/** Flow arrow (cone) at `pos` pointing along `dir`. */
export function flowArrow(pos, dir, size, color = INK) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(size * 0.45, size, 14), new THREE.MeshBasicMaterial({ color }));
  cone.position.copy(pos);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  cone.userData.noPlan = true;
  cone.userData.drawing = true;
  return cone;
}

/**
 * Swap a view between its perspective camera and an orthographic one with the same
 * framing (OrbitControls keep working: they drive whichever camera they are given).
 */
export function setOrthographic(view, on) {
  if (!view.perspective) view.perspective = view.camera;
  const persp = view.perspective;
  if (on) {
    if (!view.ortho) view.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 500);
    const o = view.ortho;
    const dist = persp.position.distanceTo(view.controls.target);
    const h = 2 * dist * Math.tan((persp.fov * Math.PI) / 360);
    const w = h * persp.aspect;
    Object.assign(o, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    o.position.copy(persp.position);
    o.quaternion.copy(persp.quaternion);
    o.zoom = 1;
    o.updateProjectionMatrix();
    view.camera = o;
  } else {
    if (view.camera !== persp && view.ortho) persp.position.copy(view.ortho.position);
    view.camera = persp;
  }
  view.controls.object = view.camera;
  view.controls.update();
}

/** Keep an orthographic camera's frustum in step with the viewport aspect. */
export function resizeOrtho(view, aspect) {
  const o = view.ortho;
  if (!o) return;
  const h = o.top - o.bottom;
  o.left = (-h * aspect) / 2;
  o.right = (h * aspect) / 2;
  o.updateProjectionMatrix();
}
