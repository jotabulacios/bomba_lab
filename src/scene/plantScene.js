// The whole installation in 3D: suction tank, pump(s) on their bases, discharge line with
// a valve, and the elevated discharge tank, laid out for one pump, two in series or two
// in parallel. Particles run along every pipe at a speed proportional to that branch's
// flow and are coloured by gauge pressure (vacuum ↔ pressure); gauges and labels show
// the live numbers. Elevations use a compressed vertical scale (y = 3·asinh(z/3)) so a
// 2 m suction lift and a 120 m lift both fit; the labels give the true values.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { applyPlanStyle, flatMaterial, levelMark, instrumentBubble, tag, flowArrow, declutterLabels, setOrthographic, resizeOrtho, INK, INK_BLUEPRINT } from './drawingStyle.js';
import { lineList, velocity } from '../physics/piping.js';

const Y = (z) => 3 * Math.asinh(z / 3); // display height of an elevation z (m)
const PIPE_R = 0.16;
const EYE_FACE = 0.42; // pump axis → face of the pipe's mating flange at the suction
const SUCT_X = -4.6; // suction tank centre
const DISCH_X = 6.4; // discharge tank centre

// Diverging gauge-pressure colours: vacuum (orange) ← 0 (grey) → pressure (blue).
const VAC = new THREE.Color(0xeb6834);
const ZERO = new THREE.Color(0xb9bec4);
const PRES = new THREE.Color(0x2a78d6);
function pressureColor(p, pMax, out) {
  if (p >= 0) return out.copy(ZERO).lerp(PRES, Math.min(1, p / Math.max(pMax, 1)));
  return out.copy(ZERO).lerp(VAC, Math.min(1, -p / 8));
}

function label(cls, html) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return new CSS2DObject(el);
}

/** Polyline helper: total length, point and tangent at arc length s. */
function polyline(points) {
  const segs = [];
  let L = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = a.distanceTo(b);
    segs.push({ a, b, len, s0: L });
    L += len;
  }
  return {
    points, length: L,
    at(s, out = new THREE.Vector3()) {
      const t = Math.min(Math.max(s, 0), L);
      const seg = segs.find((g) => t <= g.s0 + g.len) ?? segs[segs.length - 1];
      return out.copy(seg.a).lerp(seg.b, seg.len ? (t - seg.s0) / seg.len : 0);
    },
  };
}

export class PlantScene {
  constructor(renderer, host) {
    this.renderer = renderer;
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d949c, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 8);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.18, rotateSpeed: 0.45, zoomSpeed: 0.7, panSpeed: 0.6,
      minDistance: 4, maxDistance: 80, maxPolarAngle: Math.PI / 2 - 0.02,
    });
    this.controls.enabled = false;

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    host.appendChild(this.labels.domElement);

    const std = (color, metalness = 0.4, roughness = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
    this.mat = {
      pipe: std(0x9aa3ad, 0.5, 0.4, { transparent: true, opacity: 0.55, depthWrite: false }),
      flange: std(0x7c858f, 0.6, 0.4),
      tank: std(0xc9d3dc, 0.1, 0.3, { transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      tankEdge: new THREE.LineBasicMaterial({ color: 0x7c858f }),
      water: std(0x3d8fe0, 0.0, 0.2, { transparent: true, opacity: 0.45, depthWrite: false }),
      ground: std(0x6f7a72, 0.0, 0.95, { transparent: true, opacity: 0.35 }),
      casing: std(0x3f6fb5, 0.45, 0.35),
      motor: std(0x5a6470, 0.5, 0.4),
      base: std(0x50565d, 0.3, 0.6),
      off: std(0x8a9096, 0.2, 0.6),
      cav: std(0xd03b3b, 0.3, 0.4, { emissive: new THREE.Color(0x5a0000) }),
      valve: std(0xc0392b, 0.4, 0.4),
      wheel: std(0x2c3e50, 0.5, 0.4),
      dim: new THREE.LineDashedMaterial({ color: 0x5b6570, dashSize: 0.18, gapSize: 0.12 }),
      gauge: std(0xf2f3f5, 0.2, 0.4),
      particle: new THREE.MeshBasicMaterial({ vertexColors: false }),
    };
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.parts = new THREE.Group();
    this.world.add(this.parts);

    const N = 700;
    this.particles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial(), N);
    this.particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.particles.frustumCulled = false;
    this.particles.userData.noPlan = true;
    this.world.add(this.particles);
    this.pp = Array.from({ length: N }, () => ({ path: 0, s: Math.random(), off: new THREE.Vector3() }));
    this.rot = [0, 0];
    this.layoutKey = '';
    this.showFlow = true;
    this.pumpObjects = [];
  }

  /**
   * @param d { mode, Hs, Hgeo, valve, Q, branches: { QA, QB }, pumps: [{ n, Q, H, active, cavitates }],
   *            profile: pressureProfile() points, rho, pipeArea }
   */
  setState(d) {
    const key = JSON.stringify([d.mode, d.Hs.toFixed(2), d.Hgeo.toFixed(1), (d.Qd * 3600).toFixed(0)]);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.mode = d.mode;
      this.build(d);
      this.buildDrawing(d);
      this.setPlanStyle(this.plan ?? false, this.dark ?? false);
      this.frame();
    }
    this.d = d;
    const P = Object.fromEntries(d.profile.map((x) => [x.key, x.p]));
    this.pressure = P;
    // Path pressures (start → end) and flows.
    const [QA, QB] = [d.branches.QA, d.branches.QB];
    for (const path of this.paths) {
      path.Q = { main: d.Q, A: QA, B: QB }[path.flow];
      path.p0 = P[path.from] ?? 0;
      path.p1 = P[path.to] ?? 0;
    }
    this.pMax = Math.max(1, ...d.profile.map((x) => x.p));
    // Pumps: colour by state, labels.
    this.pumpObjects.forEach((po, i) => {
      const s = d.pumps[i];
      const m = !s.active ? this.mat.off : s.cavitates ? this.mat.cav : this.mat.casing;
      if (this.plan) {
        // Drawing style: keep the flat fill, tint it by state (off grey, cavitating red).
        po.casing.userData.matOrig = m;
        const fill = this.dark ? (!s.active ? 0x33465c : s.cavitates ? 0x6b2a2a : 0x1e3a5c) : (!s.active ? 0xd5d9de : s.cavitates ? 0xf6c9c9 : 0xeef0f2);
        po.casing.material = flatMaterial(fill);
      } else po.casing.material = m;
      po.label.element.innerHTML = s.active
        ? `<b>Bomba ${i + 1}${s.cavitates ? ' · <span class="cav">cavita</span>' : ''}</b>${(s.Q * 3600).toFixed(0)} m³/h · ${s.H.toFixed(1)} m · ${s.n.toFixed(0)} rpm`
        : `<b>Bomba ${i + 1} · sin aporte</b>su altura a Q = 0 no llega a la del colector`;
    });
    // Gauges.
    for (const g of this.gauges) {
      const p = P[g.key];
      const kPa = (p * d.rho * 9.80665) / 1000;
      g.label.element.innerHTML = `${g.name}<b>${kPa >= 0 ? '' : '−'}${Math.abs(kPa).toFixed(0)} kPa</b><span>${p.toFixed(1)} m</span>`;
      g.label.element.classList.toggle('vac', p < 0);
    }
    for (const b of this.bubbles ?? []) {
      const p = P[b.key];
      const kPa = (p * d.rho * 9.80665) / 1000;
      b.obj.element.querySelector('.val').textContent = `${kPa.toFixed(0)} kPa`;
      b.obj.element.classList.toggle('vac', p < 0);
    }
    this.eqTags?.forEach((t, i) => {
      const s = d.pumps[i];
      if (!s) return;
      t.element.innerHTML = `<b>P-101${String.fromCharCode(65 + i)}</b>${s.active ? `${(s.Q * 3600).toFixed(0)} m³/h · ${s.H.toFixed(1)} m · ${s.n.toFixed(0)} rpm` : 'sin aporte'}${s.cavitates ? ' · <span class="cav">CAVITA</span>' : ''}`;
    });
    for (const lt of this.lineTags ?? []) {
      const Q = { main: d.Q, A: QA, B: QB }[lt.flow];
      lt.obj.element.innerHTML = `<b>${lt.line.tag}</b>DN${lt.line.dn} · ${velocity(Q, lt.line.di).toFixed(2)} m/s`;
    }
    this.valveWheel.rotation.z = d.valve * Math.PI * 3;
    this.valveGate.scale.y = Math.max(0.05, 1 - d.valve);
    this.valveLabel.element.innerHTML = `Válvula <b>${(d.valve * 100).toFixed(0)} %</b>`;
  }

  build(d) {
    this.parts.traverse((o) => { o.geometry?.dispose?.(); if (o.isCSS2DObject) o.element.remove(); });
    this.parts.clear();
    for (const el of this.host.querySelectorAll('.plant-label')) el.remove();
    const add = (o) => { this.parts.add(o); return o; };
    const ySuct = Y(d.Hs); // suction tank level (pump axis at y = 0)
    const yDisch = Y(d.Hs + d.Hgeo);
    const yGround = Math.min(ySuct, 0) - 2.2;

    // Ground.
    const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(40, 18), this.mat.ground));
    this.ground = ground;
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(1, yGround, 0);

    // Tanks.
    const tank = (cx, level, bottom) => {
      const h = Math.max(level - bottom + 0.8, 1.5);
      const box = add(new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), this.mat.tank));
      box.userData.planOpacity = 0.35;
      box.position.set(cx, bottom + h / 2, 0);
      const edges = add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3, h, 3)), this.mat.tankEdge));
      edges.position.copy(box.position);
      edges.userData.mode3d = true;
      const wh = Math.max(level - bottom, 0.05);
      const water = add(new THREE.Mesh(new THREE.BoxGeometry(2.94, wh, 2.94), this.mat.water));
      water.userData.planColor = 0xcfe3f7;
      water.userData.planColorDark = 0x2c5f94;
      water.userData.planOpacity = 0.7;
      water.position.set(cx, bottom + wh / 2, 0);
      return box;
    };
    tank(SUCT_X, ySuct, Math.min(ySuct - 1.8, yGround));
    const upperBottom = yDisch - 1.6;
    tank(DISCH_X, yDisch, upperBottom);
    if (upperBottom > yGround + 0.3) {
      // Tower legs for the elevated tank.
      for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
        const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, upperBottom - yGround), this.mat.flange));
        leg.position.set(DISCH_X + dx, (upperBottom + yGround) / 2, dz);
      }
    }

    // Pumps and pipe network for the selected layout.
    const pumps = d.mode === 'single' ? [new THREE.Vector3(0, 0, 0)]
      : d.mode === 'series' ? [new THREE.Vector3(-1.2, 0, 0), new THREE.Vector3(1.6, 0, 0)]
        : [new THREE.Vector3(0, 0, -1.7), new THREE.Vector3(0, 0, 1.7)];
    this.pumpObjects = pumps.map((pos, i) => this.pumpModel(pos, yGround, i));
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const sIn = V(SUCT_X + 0.6, Math.min(ySuct - 0.7, -0.4), 0); // intake inside the suction tank
    const xHeader = -2.5;
    const yRise = 2.0;
    const xValve = 3.2;
    const paths = [];
    const path = (pts, flow, from, to) => paths.push({ ...polyline(pts), flow, from, to });
    const eye = (p) => V(p.x - EYE_FACE, 0, p.z); // the suction pipe ends on the pump's flange
    const top = (p) => V(p.x + 0.0, 0.85, p.z);
    if (d.mode === 'single') {
      path([sIn, V(xHeader, sIn.y, 0), V(xHeader, 0, 0), eye(pumps[0])], 'main', 'tank1', 'suction');
      path([top(pumps[0]), V(0, yRise, 0), V(xValve, yRise, 0)], 'main', 'discharge', 'valveIn');
    } else if (d.mode === 'series') {
      path([sIn, V(xHeader, sIn.y, 0), V(xHeader, 0, 0), eye(pumps[0])], 'main', 'tank1', 'suction');
      path([top(pumps[0]), V(pumps[0].x, 1.4, 0), V(0.4, 1.4, 0), V(0.4, 0, 0), eye(pumps[1])], 'main', 'between', 'between');
      path([top(pumps[1]), V(pumps[1].x, yRise, 0), V(xValve, yRise, 0)], 'main', 'discharge', 'valveIn');
    } else {
      path([sIn, V(xHeader, sIn.y, 0), V(xHeader, 0, 0)], 'main', 'tank1', 'suction');
      for (const [i, p] of pumps.entries()) {
        const f = i ? 'B' : 'A';
        path([V(xHeader, 0, 0), V(xHeader, 0, p.z), eye(p)], f, 'suction', 'suction');
        path([top(p), V(p.x, yRise, p.z), V(1.2, yRise, p.z), V(1.2, yRise, 0)], f, 'discharge', 'discharge');
      }
      path([V(1.2, yRise, 0), V(xValve, yRise, 0)], 'main', 'discharge', 'valveIn');
    }
    path([V(xValve + 0.9, yRise, 0), V(DISCH_X - 2.0, yRise, 0), V(DISCH_X - 2.0, yDisch + 0.5, 0), V(DISCH_X - 0.3, yDisch + 0.5, 0)], 'main', 'valveOut', 'tank2');
    path([V(xValve, yRise, 0), V(xValve + 0.9, yRise, 0)], 'main', 'valveIn', 'valveOut');
    this.paths = paths;

    // Pipes (tubes along each polyline, with flanged elbows).
    for (const pth of paths) {
      for (let i = 1; i < pth.points.length; i++) {
        const a = pth.points[i - 1];
        const b = pth.points[i];
        const len = a.distanceTo(b);
        if (len < 1e-3) continue;
        const tube = add(new THREE.Mesh(new THREE.CylinderGeometry(PIPE_R, PIPE_R, len, 20, 1, true), this.mat.pipe));
        tube.position.copy(a).add(b).multiplyScalar(0.5);
        tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        const joint = add(new THREE.Mesh(new THREE.SphereGeometry(PIPE_R * 1.08, 16, 10), this.mat.flange));
        joint.position.copy(b);
      }
    }

    // Valve: body, gate (closes with the opening) and hand wheel.
    const vc = V(xValve + 0.45, yRise, 0);
    const body = add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), this.mat.valve));
    body.position.copy(vc);
    const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7), this.mat.wheel));
    stem.position.set(vc.x, vc.y + 0.5, 0);
    this.valveWheel = add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 28), this.mat.wheel));
    this.valveWheel.position.set(vc.x, vc.y + 0.85, 0);
    this.valveWheel.rotation.x = Math.PI / 2;
    const spokes = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.03, 0.03), this.mat.wheel);
    this.valveWheel.add(spokes);
    this.valveGate = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, PIPE_R * 2, PIPE_R * 2.2), this.mat.wheel));
    this.valveGate.position.set(vc.x, vc.y + PIPE_R, 0);
    this.valveGate.geometry.translate(0, -PIPE_R, 0);
    this.valveLabel = label('plant-label tag', '');
    this.valveLabel.position.set(vc.x + 0.2, vc.y + 1.5, 0);
    add(this.valveLabel);

    // Gauges at the suction, between pumps (series), discharge and after the valve.
    this.gauges = [];
    const gauge = (key, name, pos) => {
      const g = add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 24), this.mat.gauge));
      g.position.copy(pos);
      g.rotation.x = Math.PI / 2;
      const l = label('plant-label gauge', '');
      l.position.copy(pos).add(new THREE.Vector3(0, 0.42, 0));
      add(l);
      this.gauges.push({ key, name, label: l });
    };
    gauge('suction', 'Aspiración', V(xHeader - 0.9, sIn.y + 0.3, 0));
    if (d.mode === 'series') gauge('between', 'Entre bombas', V(0.4, -0.55, 0.5));
    gauge('discharge', 'Descarga', V(d.mode === 'parallel' ? 2.2 : pumps.at(-1).x + 0.6, yRise + 0.35, 0));
    gauge('valveOut', 'Tras válvula', V(xValve + 1.9, yRise + 0.35, 0));

    // Dimension lines: Hs (pump axis ↔ suction level) and H_geo (level ↔ level).
    const dim = (x, y0, y1, text) => {
      if (Math.abs(y1 - y0) < 0.05) y1 = y0 + 0.05;
      const g = new THREE.BufferGeometry().setFromPoints([V(x, y0, 1.9), V(x, y1, 1.9)]);
      const l = add(new THREE.Line(g, this.mat.dim));
      l.computeLineDistances();
      l.userData.mode3d = true;
      for (const yy of [y0, y1]) {
        const tick = add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(x - 0.2, yy, 1.9), V(x + 0.2, yy, 1.9)]), this.mat.tankEdge));
        tick.userData.mode3d = true;
      }
      const t = label('plant-label dimtxt', text);
      t.position.set(x + (x < 0 ? -0.25 : 0.25), (y0 + y1) / 2, 1.9);
      if (x < 0) t.center.set(1, 0.5);
      add(t);
    };
    dim(SUCT_X - 1.9, 0, ySuct, `Hs = ${d.Hs >= 0 ? '+' : ''}${d.Hs.toFixed(1)} m ${d.Hs >= 0 ? '(en carga)' : '(aspirando)'}`);
    dim(DISCH_X - 1.9, ySuct, yDisch, `H_geo = ${d.Hgeo.toFixed(0)} m`);
    const axis = add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(SUCT_X - 1.9, 0, 1.9), V(2.6, 0, 1.9)]), this.mat.dim));
    axis.computeLineDistances();
    axis.userData.mode3d = true;
    const axisLbl = label('plant-label dimtxt', 'eje de la bomba');
    axisLbl.position.set(2.7, 0, 1.9);
    add(axisLbl);
    const scaleLbl = label('plant-label note', 'escala vertical comprimida');
    scaleLbl.position.set(1, yGround + 0.1, 3.5);
    add(scaleLbl);

    // Distribute particles over paths in proportion to their length.
    const total = paths.reduce((a, p) => a + p.length, 0);
    let acc = 0;
    const cum = paths.map((p) => (acc += p.length / total));
    for (const pt of this.pp) {
      const u = Math.random();
      pt.path = cum.findIndex((c) => u <= c);
      pt.s = Math.random() * paths[pt.path].length;
      pt.off.set(0, (Math.random() - 0.5) * PIPE_R * 1.2, (Math.random() - 0.5) * PIPE_R * 1.2);
    }
    this.yGround = yGround;
    this.ySuct = ySuct;
    this.yDisch = yDisch;
  }

  pumpModel(pos, yGround, i) {
    const g = new THREE.Group();
    g.position.copy(pos);
    // Base and pedestal down to the ground.
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.1), this.mat.base);
    base.position.set(0.55, -0.75, 0);
    g.add(base);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(2.4, Math.max(0.05, -0.81 - yGround), 0.9), this.mat.base);
    ped.position.set(0.55, (-0.81 + yGround) / 2, 0);
    g.add(ped);
    // Volute (axis along x): a short drum with a discharge neck on top.
    const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.42, 40), this.mat.casing);
    casing.rotation.z = Math.PI / 2;
    g.add(casing);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(PIPE_R * 1.1, 0.26, 0.5, 20), this.mat.casing);
    neck.position.set(0, 0.62, 0);
    g.add(neck);
    const eyeFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 24), this.mat.flange);
    eyeFlange.rotation.z = Math.PI / 2;
    eyeFlange.position.set(-0.3, 0, 0);
    g.add(eyeFlange);
    // The suction pipe's mating flange, bolted to the pump's: the pipe ends on its face.
    const pipeFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, EYE_FACE - 0.36, 24), this.mat.flange);
    pipeFlange.rotation.z = Math.PI / 2;
    pipeFlange.position.set(-(EYE_FACE + 0.36) / 2, 0, 0);
    g.add(pipeFlange);
    // Bearing frame, coupling (striped so the rotation is visible) and motor.
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 20), this.mat.flange);
    frame.rotation.z = Math.PI / 2;
    frame.position.set(0.5, 0, 0);
    g.add(frame);
    const coupling = new THREE.Group();
    coupling.position.set(0.85, 0, 0);
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.06), k % 2 ? this.mat.wheel : this.mat.gauge);
      blade.rotation.x = (k * Math.PI) / 4;
      coupling.add(blade);
    }
    g.add(coupling);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.0, 28), this.mat.motor);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(1.45, 0, 0);
    g.add(motor);
    for (let k = 0; k < 10; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.06), this.mat.motor);
      const a = (k / 10) * Math.PI * 2;
      fin.position.set(1.45, 0.38 * Math.cos(a), 0.38 * Math.sin(a));
      fin.rotation.x = a;
      g.add(fin);
    }
    g.userData.pumpIndex = i;
    g.traverse((o) => { o.userData.pumpIndex = i; });
    this.parts.add(g);
    const lbl = label('plant-label pump', '');
    // Series pumps sit close together: put the first label up-left, the second up-right.
    const dx = this.mode === 'series' ? (i === 0 ? -1.4 : 1.6) : 1.2;
    const dy = this.mode === 'series' ? (i === 0 ? 2.6 : 1.1) : 1.0;
    lbl.position.set(pos.x + dx, pos.y + dy, pos.z);
    this.parts.add(lbl);
    return { group: g, casing, coupling, label: lbl };
  }

  /**
   * Annotations of the piping drawing (shown in "Plano" style): equipment and line tags
   * with nominal sizes, flow arrows, level marks ▽, ISA pressure indicators, check valves.
   */
  buildDrawing(d) {
    const g = new THREE.Group();
    g.userData.planOnly = true;
    this.parts.add(g);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const lines = lineList(d.Qd, d.mode);
    // Equipment tags.
    g.add(tag(V(SUCT_X - 1.5, Math.max(this.ySuct, -0.2) + 1.6, -1.5), '<b>TK-01</b>aspiración'));
    g.add(tag(V(DISCH_X + 1.5, this.yDisch + 1.4, -1.5), '<b>TK-02</b>descarga'));
    this.eqTags = this.pumpObjects.map((po) => {
      const t = tag(po.group.position.clone().add(V(0.6, -1.5, 1.4)), '');
      g.add(t);
      return t;
    });
    // Line tags on the longest segment of each kind of path, and flow arrows.
    const kindOf = (path) => (path.flow !== 'main' ? (path.from === 'suction' ? 'suctionBranch' : 'dischargeBranch')
      : path.from === 'between' ? 'between' : path.to === 'suction' || path.from === 'tank1' ? 'suction' : 'discharge');
    const tagged = new Set();
    this.lineTags = [];
    const arrowColor = this.dark ? INK_BLUEPRINT : INK;
    for (const path of this.paths) {
      const kind = kindOf(path);
      let best = null;
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1];
        const b = path.points[i];
        const len = a.distanceTo(b);
        if (len > 0.9) g.add(flowArrow(a.clone().lerp(b, 0.5), b.clone().sub(a), 0.28, arrowColor));
        if (!best || len > best.len) best = { a, b, len };
      }
      const line = lines[kind] ?? lines.discharge;
      // One tag per line number: parallel branches share a size, so only branch A is tagged.
      if (best && !tagged.has(kind) && path.flow !== 'B') {
        tagged.add(kind);
        const t = tag(best.a.clone().lerp(best.b, 0.3).add(V(0, 0.42, 0)), '', 'line-tag');
        g.add(t);
        this.lineTags.push({ obj: t, line, flow: path.flow });
      }
    }
    // Level marks.
    const el = (v) => `${v > 0.004 ? '+' : v < -0.004 ? '−' : '±'}${Math.abs(v).toFixed(2)}`;
    g.add(levelMark(V(SUCT_X - 1.5, this.ySuct, 1.5), `N.A. ${el(d.Hs)}`));
    g.add(levelMark(V(DISCH_X - 1.5, this.yDisch, 1.5), `N.A. ${el(d.Hs + d.Hgeo)}`));
    g.add(levelMark(V(1.4, 0, 1.4), 'EJE ±0.00'));
    // ISA pressure indicators at the gauge points.
    const loopNo = { suction: '01', between: '02', discharge: '03', valveOut: '04' };
    this.bubbles = this.gauges.map((gg) => {
      const b = instrumentBubble(gg.label.position.clone().add(V(0, 0.5, -0.9)), 'PI', loopNo[gg.key]);
      g.add(b);
      return { key: gg.key, obj: b };
    });
    g.add(tag(this.valveLabel.position.clone(), '<b>V-01</b>compuerta', 'eq-tag small'));
    // Check valves on each discharge branch in parallel (stop back-flow through a pump).
    if (d.mode === 'parallel') {
      this.pumpObjects.forEach((po, i) => {
        const p = po.group.position;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 24), this.mat.valve);
        disc.position.set(p.x, 1.35, p.z);
        g.add(disc);
        g.add(tag(V(p.x + 0.35, 1.35, p.z), `<b>CV-${String.fromCharCode(65 + i)}</b>retención`, 'eq-tag small'));
      });
    }
    // Everything already in the scene that belongs to the 3-D look gets flagged.
    this.parts.traverse((o) => {
      if (o.isCSS2DObject && !g.children.includes(o)) o.userData.mode3d = true;
    });
    g.traverse((o) => { o.userData.planOnly = true; });
    this.drawingGroup = g;
  }

  /** "Plano" style on/off: flat fills + edges, isometric orthographic camera, annotations. */
  setPlanStyle(on, dark) {
    this.plan = on;
    this.dark = dark;
    applyPlanStyle(this.world, on, dark);
    this.parts.traverse((o) => {
      if (o.userData.planOnly) o.visible = on;
      if (o.userData.mode3d) o.visible = !on;
    });
    if (this.ground) this.ground.visible = !on;
    const wasOrtho = this.camera !== this.perspective && !!this.perspective;
    if (on !== wasOrtho) {
      setOrthographic(this, on);
      if (on) this.frameIso();
    }
  }

  /** Isometric framing for the piping drawing. */
  frameIso() {
    const yMid = (this.yGround + this.yDisch) / 2;
    const span = Math.max(16, this.yDisch - this.yGround + 6);
    this.controls.target.set(0.9, yMid, 0);
    const dir = new THREE.Vector3(1, 0.82, 1).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, span * 2);
    this.controls.update();
    if (this.camera.isOrthographicCamera) {
      // Fit the drawn parts (no ground) in view space, with a margin for the tags.
      this.camera.updateMatrixWorld();
      this.world.updateMatrixWorld(true);
      const inv = this.camera.matrixWorldInverse;
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      this.parts.traverse((o) => {
        if (!o.isMesh || o === this.ground || !o.geometry) return;
        o.geometry.computeBoundingBox?.();
        const bb = o.geometry.boundingBox;
        if (!bb) return;
        for (let k = 0; k < 8; k++) {
          v.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z);
          box.expandByPoint(v.applyMatrix4(o.matrixWorld).applyMatrix4(inv));
        }
      });
      const aspect = this.perspective.aspect;
      const cx = (box.min.x + box.max.x) / 2;
      const cy = (box.min.y + box.max.y) / 2;
      const h = Math.max(box.max.y - box.min.y, (box.max.x - box.min.x) / aspect) * 1.12;
      // Shift the target so the box centre lands in the middle of the view.
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      const shift = right.multiplyScalar(cx).add(up.multiplyScalar(cy));
      this.controls.target.add(shift);
      this.camera.position.add(shift);
      Object.assign(this.camera, { left: (-h * aspect) / 2, right: (h * aspect) / 2, top: h / 2, bottom: -h / 2, zoom: 1 });
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  /** Camera that frames the whole installation for the current heights. */
  frame() {
    if (this.plan && this.camera.isOrthographicCamera) { this.frameIso(); return; }
    const yMid = (this.yGround + this.yDisch) / 2;
    // Fit the width (tank to tank, ~15 units) and the height for the panel's aspect.
    const aspect = Math.max((this.perspective ?? this.camera).aspect || 1, 0.4);
    const span = Math.max(16 / aspect, this.yDisch - this.yGround + 6, 12);
    this.controls.target.set(0.9, yMid, 0);
    // Pumps side by side in depth (parallel) need an oblique view to read both.
    if (this.mode === 'parallel') this.camera.position.set(-span * 0.62, yMid + span * 0.42, span * 0.98);
    else this.camera.position.set(2.5, yMid + span * 0.32, span * 1.15);
    this.controls.update();
  }

  /** Pump index under a pointer event, or null (for "open this pump"). */
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(v, this.camera);
    const hit = ray.intersectObjects(this.pumpObjects.map((p) => p.group), true)[0];
    return hit ? hit.object.userData.pumpIndex : null;
  }

  update(dt) {
    if (!this.d) return;
    // Couplings turn at the pump speed (slowed down for the eye).
    this.pumpObjects.forEach((po, i) => {
      const s = this.d.pumps[i];
      if (s?.active) po.coupling.rotation.x += ((2 * Math.PI * s.n) / 60) * dt * 0.02;
    });
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const area = this.d.pipeArea;
    this.particles.visible = this.showFlow;
    this.pp.forEach((pt, i) => {
      const path = this.paths[pt.path];
      const v = (path.Q / area) * 0.8; // m/s → display units/s (same for every pipe)
      pt.s += v * dt;
      if (pt.s > path.length) pt.s -= path.length;
      path.at(pt.s, pos).add(pt.off);
      const visible = path.Q > 1e-6;
      m.makeTranslation(pos.x, pos.y, pos.z);
      if (!visible) m.makeScale(0, 0, 0);
      this.particles.setMatrixAt(i, m);
      const p = path.p0 + (path.p1 - path.p0) * (pt.s / path.length);
      this.particles.setColorAt(i, pressureColor(p, this.pMax, col));
    });
    this.particles.instanceMatrix.needsUpdate = true;
    this.particles.instanceColor.needsUpdate = true;
  }

  setLabelsVisible(on) { this.labels.domElement.style.display = on ? '' : 'none'; }

  resize(w, h) {
    const cam = this.perspective ?? this.camera;
    const before = cam.aspect;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    resizeOrtho(this, w / h);
    this.labels.setSize(w, h);
    if (this.yDisch !== undefined && Math.abs(before - cam.aspect) > 0.05) this.frame();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    // Reading label boxes forces a layout, so the drawing is decluttered a few times a second.
    const now = performance.now();
    if (this.plan && this.drawingGroup && now - (this.declutteredAt ?? 0) > 150) {
      this.declutteredAt = now;
      const shown = [];
      this.parts.traverseVisible((o) => { if (o.isCSS2DObject) shown.push(o); });
      const b = this.labels.domElement.getBoundingClientRect();
      // Keep clear of the view toolbar on the right edge.
      declutterLabels(shown, new DOMRect(b.left, b.top, b.width - 56, b.height));
    }
  }
}
