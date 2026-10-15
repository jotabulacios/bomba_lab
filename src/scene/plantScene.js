// The whole installation in 3D: suction tank, pump(s) on their bases, discharge line with
// a valve, and the elevated discharge tank, laid out for one pump, two in series or two
// in parallel. Particles run along every pipe at a speed proportional to that branch's
// flow and are coloured by gauge pressure (vacuum ↔ pressure); gauges and labels show
// the live numbers. Elevations use a compressed vertical scale (y = 3·asinh(z/3)) so a
// 2 m suction lift and a 120 m lift both fit; the labels give the true values.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const Y = (z) => 3 * Math.asinh(z / 3); // display height of an elevation z (m)
const PIPE_R = 0.16;
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
    const key = JSON.stringify([d.mode, d.Hs.toFixed(2), d.Hgeo.toFixed(1)]);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.mode = d.mode;
      this.build(d);
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
      po.casing.material = !s.active ? this.mat.off : s.cavitates ? this.mat.cav : this.mat.casing;
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
    this.valveWheel.rotation.z = d.valve * Math.PI * 3;
    this.valveGate.scale.y = Math.max(0.05, 1 - d.valve);
    this.valveLabel.element.innerHTML = `Válvula <b>${(d.valve * 100).toFixed(0)} %</b>`;
  }

  build(d) {
    this.parts.traverse((o) => o.geometry?.dispose?.());
    this.parts.clear();
    for (const el of this.host.querySelectorAll('.plant-label')) el.remove();
    const add = (o) => { this.parts.add(o); return o; };
    const ySuct = Y(d.Hs); // suction tank level (pump axis at y = 0)
    const yDisch = Y(d.Hs + d.Hgeo);
    const yGround = Math.min(ySuct, 0) - 2.2;

    // Ground.
    const ground = add(new THREE.Mesh(new THREE.PlaneGeometry(40, 18), this.mat.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(1, yGround, 0);

    // Tanks.
    const tank = (cx, level, bottom) => {
      const h = Math.max(level - bottom + 0.8, 1.5);
      const box = add(new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), this.mat.tank));
      box.position.set(cx, bottom + h / 2, 0);
      const edges = add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3, h, 3)), this.mat.tankEdge));
      edges.position.copy(box.position);
      const wh = Math.max(level - bottom, 0.05);
      const water = add(new THREE.Mesh(new THREE.BoxGeometry(2.94, wh, 2.94), this.mat.water));
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
    const eye = (p) => V(p.x - 0.75, 0, p.z);
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
      for (const yy of [y0, y1]) {
        const tick = add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(x - 0.2, yy, 1.9), V(x + 0.2, yy, 1.9)]), this.mat.tankEdge));
        tick.userData.dim = true;
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

  /** Camera that frames the whole installation for the current heights. */
  frame() {
    const yMid = (this.yGround + this.yDisch) / 2;
    // Fit the width (tank to tank, ~15 units) and the height for the panel's aspect.
    const aspect = Math.max(this.camera.aspect || 1, 0.4);
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
    const before = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.labels.setSize(w, h);
    if (this.yDisch !== undefined && Math.abs(before - this.camera.aspect) > 0.05) this.frame();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
