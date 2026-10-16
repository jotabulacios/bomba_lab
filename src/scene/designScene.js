// Design view: the pump at real scale, so changing D2, b2, β2, z or D1 changes what you
// see. Every part is a closed solid with real thickness (volute casing with suction nozzle
// and stuffing box, back shroud and hub, front shroud with its neck, blades, wear ring,
// shaft with key and nut, flanges with bolt holes), so it can be cut:
//   A-A  transversal, perpendicular to the axis (the volute spiral, tongue and blades),
//   B-B  meridional, through the axis (impeller profile b1, b2, D1, D2, volute section).
// Cut faces are hatched per part (casing 45°, impeller −45°, wear ring dense, shaft
// plain). A translucent ghost shows the reference design; dimensions have ISO arrows and
// live values. In "Plano" style the camera is orthographic and the parts are drawn flat
// with ink edges, centre lines and the cut trace.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { impellerProfile, bladeRow, voluteGeometry } from './pumpGeometry.js';
import { casingSolid, latheSolid, bladeSolid, signedVolume } from './solids.js';
import { SectionCaps } from './sectionCaps.js';
import { applyPlanStyle, setOrthographic, resizeOrtho, INK, INK_BLUEPRINT } from './drawingStyle.js';

const S = 6; // display units per metre

function label(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return new CSS2DObject(el);
}

const line = (pts, mat) => {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  l.computeLineDistances();
  return l;
};

/** BufferGeometry from a pure solid, with outward-facing triangles. */
function toGeometry({ pos, idx }) {
  if (signedVolume({ pos, idx }) < 0) {
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** z copies of one solid rotated about the axis, merged (keeps edges and outlines simple). */
function rotatedCopies({ pos, idx }, z) {
  const P = [];
  const I = [];
  const nv = pos.length / 3;
  for (let k = 0; k < z; k++) {
    const a = (k * 2 * Math.PI) / z;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let i = 0; i < pos.length; i += 3) P.push(c * pos[i] - s * pos[i + 1], s * pos[i] + c * pos[i + 1], pos[i + 2]);
    for (const i of idx) I.push(i + k * nv);
  }
  return { pos: P, idx: I };
}

/** Annular flange with bolt holes, extruded along +z from z = 0 to t. */
function flangeGeometry(rIn, rOut, t, holes) {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const hole = (x, y, r) => {
    const h = new THREE.Path();
    h.absarc(x, y, r, 0, Math.PI * 2, true);
    sh.holes.push(h);
  };
  hole(0, 0, rIn);
  const pcd = (rIn + rOut) / 2 + (rOut - rIn) * 0.08;
  const rb = Math.min((rOut - rIn) * 0.18, (Math.PI * pcd) / holes * 0.3);
  for (let i = 0; i < holes; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / holes;
    hole(pcd * Math.cos(a), pcd * Math.sin(a), rb);
  }
  return new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 40 });
}

/** All the sizes of the drawing (display units) from the hydraulic design g (metres). */
export function layout(g) {
  const D2s = g.D2 * S;
  const R2 = D2s / 2;
  const r1 = (g.D1 / 2) * S;
  const b1 = g.b1 * S;
  const b2 = g.b2 * S;
  const ts = Math.max(0.025 * D2s, 0.006 * S); // shroud thickness
  const gap = 0.012 * D2s; // impeller–casing side gap
  const tw = Math.max(0.04 * D2s, 0.008 * S); // casing wall
  const rs = Math.min(0.075 * D2s, 0.5 * r1); // shaft radius
  const rh = Math.min(1.8 * rs, 0.75 * r1); // hub radius
  const c = 0.004 * D2s; // wear-ring clearance
  const tWR = 0.02 * D2s; // wear-ring thickness
  const rN = r1 + ts + c + tWR; // suction nozzle bore
  const zb = -ts - gap;
  const zf1 = b1 + ts + gap;
  const zf2 = b2 + ts + gap;
  const zN = zf1 + 0.45 * D2s; // suction flange face
  const zS = zb - 0.28 * D2s; // stuffing box end
  const Lw = 0.08 * D2s; // wear ring length
  const throat = g.throat ?? { R3: 1.07 * (g.D2 / 2), rho: 0.25 * (g.D2 / 2) };
  const R3 = throat.R3 * S;
  const rho1 = throat.rho * S;
  const rho0 = 0.15 * rho1;
  const zc = (zb + zf2) / 2;
  const yTop = Math.max(R2 * 1.9, R3 + 2 * rho1 + 2 * tw);
  const Rmax = R3 + 2 * rho1 + tw;
  return { D2s, R2, r1, b1, b2, ts, gap, tw, rs, rh, c, tWR, rN, zb, zf1, zf2, zN, zS, Lw, R3, rho0, rho1, zc, yTop, Rmax };
}

export class DesignScene {
  constructor(renderer, host) {
    this.renderer = renderer;
    this.host = host;
    this.scene = new THREE.Scene();
    this.lights = [new THREE.HemisphereLight(0xffffff, 0x8d949c, 1.0), new THREE.DirectionalLight(0xffffff, 1.5)];
    this.lights[1].position.set(3, 4, 6);
    this.scene.add(...this.lights);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.18, rotateSpeed: 0.45, zoomSpeed: 0.7, minDistance: 1.5, maxDistance: 40 });
    this.controls.enabled = false;
    this.controls.addEventListener('change', () => this.onView?.());
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer design-labels';
    this.labels.domElement.style.display = 'none';
    host.appendChild(this.labels.domElement);

    const phys = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide, ...extra });
    this.mat = {
      blade: phys(0xc9b48f, { clearcoat: 0.3 }),
      hub: phys(0xb9a27c),
      shroud: phys(0xb9a27c),
      casing: phys(0x3f6fb5),
      ring: phys(0xb07a3e),
      shaft: phys(0xa9b1ba, { metalness: 0.8, roughness: 0.3 }),
      ghost: new THREE.MeshBasicMaterial({ color: 0x8a939d, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      ghostEdge: new THREE.LineBasicMaterial({ color: 0x8a939d, transparent: true, opacity: 0.6 }),
      dim: new THREE.LineBasicMaterial({ color: 0x5b6570 }),
      dimHi: new THREE.LineBasicMaterial({ color: 0x2a78d6 }),
      dimHead: new THREE.MeshBasicMaterial({ color: 0x5b6570 }),
      dimHeadHi: new THREE.MeshBasicMaterial({ color: 0x2a78d6 }),
      trace: new THREE.LineDashedMaterial({ color: 0xd0611b, dashSize: 0.16, gapSize: 0.05, depthTest: false }),
      center: new THREE.LineDashedMaterial({ color: 0x6b7480, dashSize: 0.2, gapSize: 0.05 }),
    };
    this.current = new THREE.Group();
    this.ghost = new THREE.Group();
    this.dims = new THREE.Group();
    this.annot = new THREE.Group(); // cut trace, cut title and centre lines
    this.scene.add(this.current, this.ghost, this.dims, this.annot);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.caps = new SectionCaps(this.plane, 12);
    this.scene.add(this.caps.root);
    this.cut = { kind: 'none', pos: 0, angle: 0 };
    this.plan = false;
    this.dark = false;
    this.showVolute = true;
    this.highlightKey = null;
    this.fitted = false;
    this.camKind = 'iso';
  }

  /** Reference design: thin blades, outline rings and the old volute tube, translucent. */
  buildGhost(g) {
    this.ghost.traverse((o) => o.geometry?.dispose?.());
    this.ghost.clear();
    const R2 = (g.D2 / 2) * S;
    const prof = impellerProfile({ r1: (g.D1 / 2) * S, r2: R2, b1: g.b1 * S, b2: g.b2 * S, beta1: g.beta1, beta2: g.beta2 });
    this.ghost.add(bladeRow(prof, Math.max(g.t * S * 0.5, 0.006), g.z, this.mat.ghost));
    const back = new THREE.Mesh(new THREE.CircleGeometry(R2, 96), this.mat.ghost);
    back.position.z = -0.002;
    this.ghost.add(back);
    for (const [r, z] of [[R2, 0], [R2, g.b2 * S], [(g.D1 / 2) * S, g.b1 * S]]) {
      const pts = [];
      for (let i = 0; i <= 96; i++) pts.push(new THREE.Vector3(r * Math.cos((i / 96) * 2 * Math.PI), r * Math.sin((i / 96) * 2 * Math.PI), z));
      this.ghost.add(line(pts, this.mat.ghostEdge));
    }
    if (this.showVolute && g.throat) {
      this.ghost.add(new THREE.Mesh(voluteGeometry({
        R3: g.throat.R3 * S, rho0: g.throat.rho * S * 0.15, rho1: g.throat.rho * S, zc: (g.b2 * S) / 2, yTop: R2 * 1.9,
      }), this.mat.ghost));
    }
  }

  /** The current design as closed solids, grouped by part for the hatching. */
  buildCurrent(g) {
    this.current.traverse((o) => { o.geometry?.dispose?.(); });
    this.current.clear();
    const L = layout(g);
    this.L = L;
    const prof = impellerProfile({ r1: L.r1, r2: L.R2, b1: L.b1, b2: L.b2, beta1: g.beta1, beta2: g.beta2 });
    this.prof = prof;
    const mesh = (geom, mat, part) => {
      const m = new THREE.Mesh(geom, mat);
      m.userData.part = part;
      this.current.add(m);
      return m;
    };
    const parts = { casing: [], impeller: [], ring: [], shaft: [] };
    // Impeller: back shroud + hub (with the boss into the eye), front shroud with its neck, blades.
    const noseZ = 0.55 * L.b1;
    const hubProfile = [[L.rs, -L.ts], [L.R2, -L.ts], [L.R2, 0], [L.rh, 0], [L.rh * 0.9, noseZ], [L.rs, noseZ]];
    parts.impeller.push(mesh(toGeometry(latheSolid(hubProfile, 128)), this.mat.hub, 'hub'));
    const inner = [];
    const outer = [];
    for (let i = 0; i <= 20; i++) {
      const r = L.R2 + ((L.r1 - L.R2) * i) / 20;
      inner.push([r, prof.bAt(r)]);
    }
    for (let i = 0; i <= 20; i++) {
      const r = L.r1 + L.ts + ((L.R2 - L.r1 - L.ts) * i) / 20;
      outer.push([r, prof.bAt(r) + L.ts]);
    }
    const neckTop = L.zf1 + L.Lw;
    const shroudProfile = [...inner, [L.r1, neckTop], [L.r1 + L.ts, neckTop], ...outer];
    const shroud = mesh(toGeometry(latheSolid(shroudProfile, 128)), this.mat.shroud, 'shroud');
    parts.impeller.push(shroud);
    const half = Math.max(g.t * S * 0.5, 0.006);
    parts.impeller.push(mesh(toGeometry(rotatedCopies(bladeSolid(prof, half), g.z)), this.mat.blade, 'blades'));
    // Wear ring in the casing bore, around the shroud neck.
    parts.ring.push(mesh(toGeometry(latheSolid([[L.r1 + L.ts + L.c, L.zf1], [L.rN, L.zf1], [L.rN, neckTop], [L.r1 + L.ts + L.c, neckTop]], 128)), this.mat.ring, 'ring'));
    // Shaft, impeller nut and key.
    const z0 = L.zS - 0.35 * L.D2s;
    const nutH = 0.8 * L.rs;
    const z1 = noseZ + nutH * 0.9;
    const shaft = mesh(new THREE.CylinderGeometry(L.rs, L.rs, z1 - z0, 48), this.mat.shaft, 'shaft');
    shaft.geometry.rotateX(Math.PI / 2);
    shaft.geometry.translate(0, 0, (z0 + z1) / 2);
    const nut = mesh(new THREE.CylinderGeometry(1.5 * L.rs, 1.5 * L.rs, nutH, 6), this.mat.shaft, 'nut');
    nut.geometry.rotateX(Math.PI / 2);
    nut.geometry.translate(0, 0, noseZ + nutH / 2);
    nut.userData.edgeAngle = 20;
    const key = mesh(new THREE.BoxGeometry(0.45 * L.rs, 0.4 * L.rs, noseZ + L.ts * 0.8), this.mat.shaft, 'key');
    key.position.set(0, L.rs, (noseZ - L.ts * 0.8) / 2);
    parts.shaft.push(shaft, nut, key);
    // Casing: volute + walls swept round the axis, discharge diffuser, flanges.
    if (this.showVolute) {
      parts.casing.push(mesh(toGeometry(casingSolid({ ...L, rS: L.rs * 1.25 }, 144)), this.mat.casing, 'casing'));
      const r0 = L.rho1;
      const rT = 1.25 * L.rho1;
      const diff = toGeometry(latheSolid([[r0, 0], [rT, L.yTop], [rT + L.tw, L.yTop], [r0 + L.tw, 0]], 72));
      diff.rotateX(-Math.PI / 2);
      diff.translate(L.R3 + L.rho1, 0, L.zc);
      parts.casing.push(mesh(diff, this.mat.casing, 'diffuser'));
      const tf = 0.035 * L.D2s;
      const fs = flangeGeometry(L.rN, L.rN + L.tw + 0.11 * L.D2s, tf, 8);
      fs.translate(0, 0, L.zN - tf);
      parts.casing.push(mesh(fs, this.mat.casing, 'flangeS'));
      const fd = flangeGeometry(rT, rT + L.tw + 0.1 * L.D2s, tf, 8);
      fd.rotateX(-Math.PI / 2);
      fd.translate(L.R3 + L.rho1, L.yTop - tf, L.zc);
      parts.casing.push(mesh(fd, this.mat.casing, 'flangeD'));
    }
    for (const m of this.current.children) m.userData.edgeAngle ??= 30;
    this.parts = parts;
    this.caps.size = L.Rmax * 3.2 + L.D2s;
    this.rebuildCaps();
    return prof;
  }

  /**
   * @param g current geometry { D2, D1, b1, b2, beta1, beta2, z, t, throat }
   * @param ref reference geometry (same fields) or null
   */
  setDesign(g, ref) {
    this.g = g;
    this.lastArgs = [g, ref];
    const prof = this.buildCurrent(g);
    if (ref) this.buildGhost(ref); else this.ghost.clear();
    this.ghostOn = !!ref;
    this.buildDims(g, prof);
    this.updateCut();
    if (!this.fitted) { this.fitTo(ref ?? g); this.fitted = true; }
    this.onView?.();
  }

  // ---------- Cut ----------

  /** 'none' | 'A' | 'B' */
  setCut(kind) {
    this.cut.kind = kind;
    this.cut.pos = 0;
    this.updateCut();
    if (kind === 'A') this.setCamera('front');
    else if (kind === 'B') this.setCamera('section');
  }

  /** Offset of the plane from its default position, −1…1. */
  setCutPos(v) { this.cut.pos = v; this.updateCut(); }

  /** Meridional plane angle (degrees, B-B only). */
  setCutAngle(deg) {
    this.cut.angle = deg;
    this.updateCut();
    if (this.cut.kind === 'B' && this.camKind === 'section') this.setCamera('section');
  }

  /** Plane normal and constant for the current cut (keeps n·p + c ≥ 0). */
  planeFor() {
    const L = this.L;
    if (this.cut.kind === 'A') {
      const v = this.cut.pos;
      const z = L.zc + v * (v > 0 ? L.zN - L.zc : L.zc - L.zS);
      return { n: new THREE.Vector3(0, 0, -1), c: z, z };
    }
    const a = (this.cut.angle * Math.PI) / 180;
    return { n: new THREE.Vector3(Math.cos(a), Math.sin(a), 0), c: this.cut.pos * L.Rmax * 0.8, a };
  }

  updateCut() {
    if (!this.L) return;
    const on = this.cut.kind !== 'none';
    if (on) {
      const { n, c } = this.planeFor();
      this.plane.normal.copy(n);
      this.plane.constant = c;
      this.caps.update();
    }
    const clip = on ? [this.plane] : null;
    for (const m of Object.values(this.mat)) if (m.isMeshPhysicalMaterial) { m.clippingPlanes = clip; m.needsUpdate = true; }
    this.caps.setVisible(on);
    this.ghost.visible = this.ghostOn && !on;
    this.applyLook();
    this.buildAnnotations();
    this.onView?.();
  }

  /** Materials for the current style and cut: translucent casing only when uncut. */
  applyLook() {
    const on = this.cut.kind !== 'none';
    for (const k of ['casing', 'shroud']) {
      const m = this.mat[k];
      const op = on ? 1 : k === 'casing' ? 0.22 : 0.3;
      m.transparent = op < 1;
      m.opacity = op;
      m.depthWrite = op >= 1;
      m.needsUpdate = true;
    }
    for (const m of this.current.children) {
      m.userData.planOpacity = on ? 1 : m.userData.part === 'casing' || m.userData.part === 'diffuser' || m.userData.part?.startsWith('flange') ? 0.3 : m.userData.part === 'shroud' ? 0.45 : 1;
    }
    applyPlanStyle(this.current, this.plan, this.dark, this.L ? this.L.D2s * 0.006 : 0.01);
  }

  rebuildCaps() {
    const ink = this.plan ? (this.dark ? '#e6f0fb' : '#1d2329') : null;
    const paper = this.dark ? '#0f2a4a' : '#ffffff';
    const H = this.plan
      ? {
        casing: { fill: paper, ink, dir: 1 },
        impeller: { fill: paper, ink, dir: -1 },
        ring: { fill: paper, ink, dir: 1, dense: true },
        shaft: { fill: this.dark ? '#1e3a5c' : '#e9ecef', ink: null },
      }
      : {
        casing: { fill: '#5d86c6', ink: '#24467a', dir: 1 },
        impeller: { fill: '#dcc8a0', ink: '#7d6237', dir: -1 },
        ring: { fill: '#c99456', ink: '#5e3f1a', dir: 1, dense: true },
        shaft: { fill: '#bfc6ce', ink: null },
      };
    const spacing = (this.L?.D2s ?? 2) * 0.035;
    this.caps.setGroups(['casing', 'impeller', 'ring', 'shaft']
      .filter((k) => this.parts?.[k]?.length)
      .map((k) => ({ meshes: this.parts[k], hatch: { ...H[k], spacing: k === 'ring' ? spacing * 0.7 : spacing } })));
    this.caps.setVisible(this.cut.kind !== 'none');
  }

  /** Cut trace with arrows and letters, the section title, centre lines. */
  buildAnnotations() {
    for (const o of [...this.annot.children]) if (o.isCSS2DObject) o.element.remove();
    this.annot.traverse((o) => o.geometry?.dispose?.());
    this.annot.clear();
    const L = this.L;
    if (!L) return;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // Centre lines (plan style): the axis, and the two diameters of the front view.
    if (this.plan) {
      const e = L.Rmax * 1.12;
      for (const [a, b] of [[V(0, 0, L.zS - 0.5 * L.D2s), V(0, 0, L.zN + 0.25 * L.D2s)], [V(-e, 0, L.zN), V(e, 0, L.zN)], [V(0, -e, L.zN), V(0, e + L.yTop * 0.2, L.zN)]]) {
        this.annot.add(line([a, b], this.mat.center));
      }
    }
    if (this.cut.kind === 'none') return;
    const letter = this.cut.kind;
    // The trace only makes sense where the plane is seen edge-on.
    const edgeOn = letter === 'A' ? this.camKind !== 'front' : this.camKind !== 'side' && this.camKind !== 'section';
    const p = this.planeFor();
    const E = L.Rmax * 1.18;
    let ends;
    let titlePos;
    if (letter === 'A') {
      // Trace of the transversal plane, seen from the side: a line across at z.
      ends = [V(0, -E, p.z), V(0, E + L.yTop * 0.15, p.z)];
      titlePos = V(0, -L.Rmax - 0.12 * L.D2s, p.z);
    } else {
      const t = V(-Math.sin(p.a), Math.cos(p.a), 0);
      const base = p.n.clone().multiplyScalar(-p.c);
      ends = [base.clone().addScaledVector(t, -E).setZ(L.zN + 0.05), base.clone().addScaledVector(t, E).setZ(L.zN + 0.05)];
      titlePos = base.clone().addScaledVector(t, -L.Rmax - 0.12 * L.D2s).setZ(L.zc);
    }
    const title = label('cut-title', `CORTE ${letter}-${letter}`);
    title.position.copy(titlePos);
    this.annot.add(title);
    if (!edgeOn) return;
    const tr = line(ends, this.mat.trace);
    tr.renderOrder = 20;
    this.annot.add(tr);
    // Arrows at both ends point the way the section is viewed (towards the kept part).
    const head = 0.06 * L.D2s;
    for (const end of ends) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.35, head, 12), new THREE.MeshBasicMaterial({ color: 0xd0611b, depthTest: false }));
      cone.position.copy(end).addScaledVector(p.n, head * 0.9);
      cone.quaternion.setFromUnitVectors(V(0, 1, 0), p.n);
      cone.renderOrder = 20;
      this.annot.add(cone);
      const stub = line([end, end.clone().addScaledVector(p.n, head * 0.4)], this.mat.trace);
      this.annot.add(stub);
      const lt = label('cut-letter', letter);
      lt.position.copy(end).addScaledVector(p.n, head * 1.9);
      this.annot.add(lt);
    }
  }

  // ---------- Dimensions ----------

  buildDims(g, prof) {
    for (const o of [...this.dims.children]) if (o.isCSS2DObject) o.element.remove();
    this.dims.traverse((o) => o.geometry?.dispose?.());
    this.dims.clear();
    this.dimParts = {};
    const L = this.L;
    const R2 = L.R2;
    const R1 = L.r1;
    const zf = L.b2 + L.ts + 0.02;
    const head = 0.045 * L.D2s;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const reg = (key, objs, lbl) => {
      this.dimParts[key] = { objs, lbl };
      for (const o of objs) this.dims.add(o);
      this.dims.add(lbl);
    };
    // Dimension line with ISO arrowheads at both ends.
    const arrowLine = (a, b) => {
      const objs = [line([a, b], this.mat.dim)];
      const d = b.clone().sub(a).normalize();
      for (const [p, dir] of [[a, d], [b, d.clone().negate()]]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.28, head, 10), this.mat.dimHead);
        cone.position.copy(p).addScaledVector(dir, head / 2);
        cone.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().negate());
        objs.push(cone);
      }
      return objs;
    };
    const diameter = (key, R, ang, z, text) => {
      const u = V(Math.cos(ang), Math.sin(ang), 0);
      const lb = label('dim-label', text);
      lb.position.copy(u).multiplyScalar(R * 0.62).setZ(z);
      reg(key, arrowLine(u.clone().multiplyScalar(-R).setZ(z), u.clone().multiplyScalar(R).setZ(z)), lb);
    };
    // In the meridional cut, diameters lie in the cut plane (seen as vertical dimensions).
    const B = this.cut.kind === 'B';
    const angB = B ? ((this.cut.angle + 90) * Math.PI) / 180 : null;
    diameter('D2mm', R2, B ? angB : -0.35, B ? L.zf2 + L.tw + 0.1 * L.D2s : zf, `⌀D2 ${(g.D2 * 1000).toFixed(0)}`);
    diameter('D1mm', R1, B ? angB : 2.3, B ? L.zN + 0.08 * L.D2s : L.b1 + L.ts + 0.02, `⌀D1 ${(g.D1 * 1000).toFixed(0)}`);
    // b2: axial width at the outlet, with extension lines (edge-on in the front view).
    if (B || this.camKind !== 'front') {
      const u = B ? V(Math.cos(angB), Math.sin(angB), 0) : V(1, 0, 0);
      const x = R2 + 0.1 * L.D2s;
      const P = (r, z) => u.clone().multiplyScalar(r).setZ(z);
      const objs = [...arrowLine(P(x, 0), P(x, L.b2)), line([P(R2, 0), P(x + 0.03 * L.D2s, 0)], this.mat.dim), line([P(R2, L.b2), P(x + 0.03 * L.D2s, L.b2)], this.mat.dim)];
      const lb = label('dim-label', `b2 ${(g.b2 * 1000).toFixed(1)}`);
      lb.position.copy(P(x + 0.06 * L.D2s, L.b2 / 2));
      lb.center.set(0, 0.5);
      reg('b2mm', objs, lb);
    }
    // b1 in the meridional section.
    if (B) {
      const u = V(Math.cos(angB), Math.sin(angB), 0);
      const P = (r, z) => u.clone().multiplyScalar(r).setZ(z);
      const x = R1 * 0.55;
      const lb = label('dim-label', `b1 ${(g.b1 * 1000).toFixed(1)}`);
      lb.position.copy(P(x, L.b1 / 2));
      lb.center.set(1.05, 0.5);
      reg('b1', arrowLine(P(x, 0), P(x, L.b1)), lb);
    }
    if (!B) {
      // β2: angle between the blade tip direction and the tangent (opposite to u).
      const th = prof.thetaAt(R2);
      const tip = V(R2 * Math.cos(th), R2 * Math.sin(th), zf);
      const tang = V(Math.sin(th), -Math.cos(th), 0);
      const r = R2 * 0.995;
      const thIn = prof.thetaAt(r);
      const inner = V(r * Math.cos(thIn), r * Math.sin(thIn), zf);
      const bladeDir = tip.clone().sub(inner).normalize();
      const Lb = R2 * 0.35;
      const l1 = line([tip, tip.clone().addScaledVector(tang, Lb)], this.mat.dim);
      const l2 = line([tip, tip.clone().addScaledVector(bladeDir, Lb)], this.mat.dim);
      const a0 = Math.atan2(tang.y, tang.x);
      let da = Math.atan2(bladeDir.y, bladeDir.x) - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const arcPts = [];
      for (let i = 0; i <= 20; i++) {
        const a = a0 + (da * i) / 20;
        arcPts.push(tip.clone().add(V(Math.cos(a) * Lb * 0.6, Math.sin(a) * Lb * 0.6, 0)));
      }
      const lb = label('dim-label', `β2 ${g.beta2.toFixed(0)}°`);
      const mid = a0 + da / 2;
      lb.position.copy(tip).add(V(Math.cos(mid) * Lb * 0.85, Math.sin(mid) * Lb * 0.85, 0));
      reg('beta2', [l1, l2, line(arcPts, this.mat.dim)], lb);
      const lz = label('dim-label', `z = ${g.z}`);
      lz.position.set(-R2 * 0.55, -R2 * 0.7, zf);
      reg('z', [], lz);
    }
    // Volute throat (only visible on the transversal cut): diameter of the last section.
    if (this.cut.kind === 'A' && this.showVolute) {
      const zz = this.planeFor().z + 0.02;
      const lb = label('dim-label', `⌀ garganta ${((2 * L.rho1) / S * 1000).toFixed(0)}`);
      lb.position.set(L.R3 + L.rho1, -0.09 * L.D2s, zz);
      reg('Qdh', arrowLine(V(L.R3, -0.04 * L.D2s, zz), V(L.R3 + 2 * L.rho1, -0.04 * L.D2s, zz)), lb);
    }
    this.highlight(this.highlightKey);
  }

  /** Emphasise the dimension that a hovered slider controls (null clears). */
  highlight(key) {
    this.highlightKey = key;
    for (const [k, part] of Object.entries(this.dimParts ?? {})) {
      const on = k === key;
      for (const o of part.objs) o.material = o.isMesh ? (on ? this.mat.dimHeadHi : this.mat.dimHead) : on ? this.mat.dimHi : this.mat.dim;
      part.lbl.element.classList.toggle('hi', on);
    }
  }

  // ---------- Style, camera ----------

  setPlanStyle(on, dark) {
    const changed = on !== this.plan;
    this.plan = on;
    this.dark = dark;
    const ink = on ? (dark ? INK_BLUEPRINT : INK) : 0x5b6570;
    this.mat.dim.color.setHex(ink);
    this.mat.dimHead.color.setHex(ink);
    this.mat.center.color.setHex(dark ? 0x8fa8c4 : 0x6b7480);
    this.labels.domElement.classList.toggle('plan', on);
    if (changed) { setOrthographic(this, on); if (this.L) this.setCamera(this.camKind); }
    this.rebuildCaps();
    this.applyLook();
    this.buildAnnotations();
    this.onView?.();
  }

  setVolute(on) {
    this.showVolute = on;
    if (this.lastArgs) this.setDesign(...this.lastArgs);
  }

  fitTo() { this.setCamera(this.camKind); }

  /** 'front' | 'side' | 'iso' | 'section' (looking at the meridional cut). */
  setCamera(kind) {
    this.camKind = kind;
    const L = this.L;
    if (!L) return;
    // Frame the whole drawing (casing, diffuser and flanges, or the impeller alone) with
    // room for the dimensions, the cut title and the title block.
    const Rx = this.showVolute ? L.Rmax : L.R2;
    const yTop = this.showVolute ? L.yTop : L.R2;
    const zMin = L.zS - 0.35 * L.D2s;
    const zMax = L.zN + 0.1 * L.D2s;
    const yMid = (yTop - Rx) / 2;
    const t = this.controls.target;
    let w;
    let h = yTop + Rx;
    if (kind === 'front') {
      t.set(0, yMid, L.zc);
      w = 2 * Rx;
    } else if (kind === 'side' || kind === 'section') {
      t.set(0, yMid, (zMin + zMax) / 2);
      w = zMax - zMin + 0.3 * L.D2s;
    } else {
      t.set(0, yMid, L.zc);
      w = 2 * Rx + 0.5 * (zMax - zMin);
      h *= 1.15;
    }
    const aspect = (this.perspective ?? this.camera).aspect || 1;
    const H = Math.max(h, w / aspect) * 1.3;
    const d = H / (2 * Math.tan((32 * Math.PI) / 360));
    if (kind === 'front') this.camera.position.set(t.x, t.y, t.z + d);
    else if (kind === 'side') this.camera.position.set(t.x - d, t.y + 0.01, t.z + 0.01);
    else if (kind === 'section') {
      const a = (this.cut.angle * Math.PI) / 180;
      this.camera.position.set(t.x - d * Math.cos(a), t.y - d * Math.sin(a) + 0.01, t.z + 0.01);
    } else this.camera.position.copy(t).add(new THREE.Vector3(0.55, 0.45, 1).normalize().multiplyScalar(d));
    if (this.camera.isOrthographicCamera) {
      Object.assign(this.camera, { left: (-H * aspect) / 2, right: (H * aspect) / 2, top: H / 2, bottom: -H / 2, zoom: 1 });
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.buildDims(this.g, this.prof);
    this.buildAnnotations();
    this.onView?.();
  }

  /** Name of the current view for the title block. */
  viewName() {
    if (this.cut.kind !== 'none') return `Corte ${this.cut.kind}-${this.cut.kind}`;
    return { front: 'Frente', side: 'Lateral', section: 'Lateral', iso: 'Isométrica' }[this.camKind] ?? 'Isométrica';
  }

  /** Approximate drawing scale on screen (orthographic only), e.g. "1:5". */
  scaleText() {
    const cam = this.camera;
    if (!cam.isOrthographicCamera) return 'sin escala (perspectiva)';
    const hPx = this.renderer.domElement.clientHeight || 1;
    const units = (cam.top - cam.bottom) / cam.zoom;
    const pxPerMetre = (hPx / units) * S;
    const ratio = 3779.5 / pxPerMetre; // 96 px per inch
    const std = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 25, 50];
    if (ratio < 1) return `≈ ${(1 / ratio).toFixed(1)}:1`;
    const s = std.reduce((best, v) => (Math.abs(Math.log(v / ratio)) < Math.abs(Math.log(best / ratio)) ? v : best), 1);
    return `≈ 1:${s}`;
  }

  setLabelsVisible(on) { this.labels.domElement.style.display = on ? '' : 'none'; }

  resize(w, h) {
    const cam = this.perspective ?? this.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    resizeOrtho(this, w / h);
    this.labels.setSize(w, h);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
