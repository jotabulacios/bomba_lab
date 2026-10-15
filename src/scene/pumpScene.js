// 3-D centrifugal pump: impeller with z backward-curved blades (dθ/dr = −1/(r·tan β),
// β from β1 to β2 measured from the tangent), back shroud and hub, transparent suction
// pipe and a spiral volute with its discharge nozzle. Streaks follow the mean-line flow:
// axial in the suction pipe, along the blade channels in the impeller (relative frame),
// a free vortex in the volute and straight out of the nozzle. Cavitation bubbles appear
// near the blade leading edges, on the suction side, when ANPAd < ANPAr.
//
// Display units: the impeller outlet radius R2 = 1. Shaft axis = +z; the impeller turns
// counter-clockwise seen from +z (from the suction side).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const RAD = Math.PI / 180;
const SEG = 10; // streak history samples
const R3 = 1.07; // volute base circle (tongue clearance)
const RV = 1.62; // volute outer radius at the end of the spiral
const PHI0 = Math.PI / 2; // tongue at the top
const NOZZLE_END = -1.9; // x of the discharge flange
const PIPE_TOP = 1.5; // suction pipe length along +z
const FRAME_COLOR = { abs: 0x2a78d6, rel: 0xeb6834 };

const voluteR = (phi) => {
  const u = ((((phi - PHI0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  return R3 + (RV - R3) * u;
};

export class PumpScene {
  constructor(host, count = 900) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 4, 6);
    this.scene.add(key);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.resetCamera();

    const phys = (color, metalness, roughness, extra = {}) => new THREE.MeshPhysicalMaterial({ color, metalness, roughness, side: THREE.DoubleSide, ...extra });
    this.mat = {
      impeller: phys(0xc9b48f, 0.55, 0.35, { clearcoat: 0.3 }),
      hub: phys(0xb9a27c, 0.5, 0.4),
      casing: phys(0x8e9aa6, 0.45, 0.5),
      glass: phys(0xbfd6ea, 0.0, 0.1, { transparent: true, opacity: 0.16, depthWrite: false }),
      front: phys(0x8e9aa6, 0.3, 0.5, { transparent: true, opacity: 0.22, depthWrite: false }),
      shaft: phys(0x6f7780, 0.7, 0.3),
      bubble: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transmission: 0.2, transparent: true, opacity: 0.9 }),
    };

    this.impeller = new THREE.Group();
    this.casing = new THREE.Group();
    this.scene.add(this.impeller, this.casing);

    // Streaks.
    this.count = count;
    this.p = Array.from({ length: count }, () => ({ phase: 0, r: 0, phi: 0, z: 0, x: 0, frac: 0, hist: [] }));
    this.positions = new Float32Array(count * (SEG - 1) * 6);
    this.colors = new Float32Array(count * (SEG - 1) * 6);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(this.positions);
    geo.setColors(this.colors);
    this.streakMat = new LineMaterial({ vertexColors: true, linewidth: 2, worldUnits: false, transparent: true });
    this.streaks = new LineSegments2(geo, this.streakMat);
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);

    // Cavitation bubbles.
    this.maxBubbles = 160;
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.mat.bubble, this.maxBubbles);
    this.bubbles.frustumCulled = false;
    this.b = Array.from({ length: this.maxBubbles }, () => ({ alive: false, r: 0, phiRel: 0, z: 0, age: 0, life: 1, size: 0.02 }));
    this.impeller.add(this.bubbles);

    this.frame = 'abs';
    this.showFlow = true;
    this.rotor = 0;
    this.timeScale = 1 / 50;
    this.cavitation = 0;
    this.ready = false;
  }

  resetCamera() {
    this.camera.position.set(2.6, 1.9, 6.4);
    this.controls.target.set(-0.35, 0.25, 0.1);
    this.controls.update();
  }

  /**
   * (Re)build the geometry and the flow model for the current pump and operating point.
   * @param g { D2, b2, D1, b1, beta1, beta2, z, t } physical geometry (m, degrees)
   * @param op { n, Qi, Q, c2u, U2, rho } operating point of the shown pump (SI units)
   */
  setPump(g, op) {
    const key = JSON.stringify(g);
    if (key !== this.geoKey) {
      this.geoKey = key;
      this.build(g);
      for (const p of this.p) this.spawn(p, true);
    }
    this.g = g;
    this.op = op;
    this.k = 2 / g.D2; // display units per metre (R2 = 1)
  }

  build(g) {
    for (const grp of [this.impeller, this.casing]) {
      grp.traverse((o) => { if (o !== this.bubbles) o.geometry?.dispose?.(); });
      for (const c of [...grp.children]) if (c !== this.bubbles) grp.remove(c);
    }
    const k = 2 / g.D2;
    const r1 = (g.D1 / g.D2);
    this.r1 = r1;
    const b1 = g.b1 * k;
    const b2 = g.b2 * k;
    this.bAt = (r) => b1 + ((b2 - b1) * (r - r1)) / (1 - r1);
    this.betaAt = (r) => g.beta1 + ((g.beta2 - g.beta1) * (r - r1)) / (1 - r1);

    // Blade camber θ(r) = −∫ dr / (r tan β): backward-curved, trailing the rotation.
    const N = 48;
    const tab = [[r1, 0]];
    for (let i = 1; i <= N; i++) {
      const ra = r1 + ((1 - r1) * (i - 1)) / N;
      const rb = r1 + ((1 - r1) * i) / N;
      const rm = (ra + rb) / 2;
      tab.push([rb, tab[i - 1][1] - (rb - ra) / (rm * Math.tan(this.betaAt(rm) * RAD))]);
    }
    this.thetaAt = (r) => {
      if (r <= r1) return 0;
      const f = Math.min((r - r1) / (1 - r1), 1) * N;
      const i = Math.min(Math.floor(f), N - 1);
      return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * (f - i);
    };

    // Blades: thin strips along the camber, extruded from the back shroud to b(r).
    const half = (g.t * k) / 2 + 0.006;
    const blade = new THREE.BufferGeometry();
    const pos = [];
    const idx = [];
    const ring = (r, th) => {
      const dr = 0.002;
      const t2 = this.thetaAt(Math.min(r + dr, 1));
      const t1 = this.thetaAt(Math.max(r - dr, r1));
      const tx = (Math.min(r + dr, 1) - Math.max(r - dr, r1));
      // camber direction in (x, y) and its normal
      const p1 = [Math.max(r - dr, r1) * Math.cos(t1), Math.max(r - dr, r1) * Math.sin(t1)];
      const p2 = [Math.min(r + dr, 1) * Math.cos(t2), Math.min(r + dr, 1) * Math.sin(t2)];
      const d = [p2[0] - p1[0], p2[1] - p1[1]];
      const L = Math.hypot(...d) || tx;
      return { c: [r * Math.cos(th), r * Math.sin(th)], n: [-d[1] / L, d[0] / L] };
    };
    const M = 40;
    for (let i = 0; i <= M; i++) {
      const r = r1 + ((1 - r1) * i) / M;
      const { c, n } = ring(r, this.thetaAt(r));
      const h = this.bAt(r);
      for (const s of [-1, 1]) for (const z of [0, h]) pos.push(c[0] + s * half * n[0], c[1] + s * half * n[1], z);
    }
    // 4 verts per station: (−,0) (−,h) (+,0) (+,h)
    for (let i = 0; i < M; i++) {
      const a = i * 4;
      const b = a + 4;
      idx.push(a, b, b + 1, a, b + 1, a + 1); // − side
      idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2); // + side
      idx.push(a + 1, b + 1, b + 3, a + 1, b + 3, a + 3); // top edge
    }
    idx.push(0, 1, 3, 0, 3, 2); // leading edge
    const e = M * 4;
    idx.push(e, e + 2, e + 3, e, e + 3, e + 1); // trailing edge
    blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    blade.setIndex(idx);
    blade.computeVertexNormals();
    const blades = new THREE.InstancedMesh(blade, this.mat.impeller, g.z);
    const m = new THREE.Matrix4();
    for (let i = 0; i < g.z; i++) blades.setMatrixAt(i, m.makeRotationZ((i * 2 * Math.PI) / g.z));
    this.impeller.add(blades);

    // Back shroud (disk) and hub boss; front shroud ring (transparent).
    const back = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.05, 96), this.mat.hub);
    back.rotation.x = Math.PI / 2;
    back.position.z = -0.025;
    this.impeller.add(back);
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.35, 40), this.mat.hub);
    boss.rotation.x = Math.PI / 2;
    boss.position.z = 0.12;
    this.impeller.add(boss);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mat.hub);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.29;
    this.impeller.add(nose);
    const frontPts = [];
    for (let i = 0; i <= 24; i++) {
      const r = r1 + ((1 - r1) * i) / 24;
      frontPts.push(new THREE.Vector2(r, this.bAt(r) + 0.012));
    }
    const frontShroud = new THREE.Mesh(new THREE.LatheGeometry(frontPts, 96), this.mat.front);
    frontShroud.rotation.x = Math.PI / 2;
    this.frontShroud = frontShroud;
    this.impeller.add(frontShroud);

    // Shaft behind the impeller.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 24), this.mat.shaft);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.75;
    this.impeller.add(shaft);

    // Volute: spiral outer wall and back plate; front cover is the "corte" toggle.
    const zb = -0.12;
    const zt = Math.max(b2, b1) + 0.16;
    this.zVol = [zb, zt];
    const spiral = [];
    for (let i = 0; i <= 160; i++) {
      const phi = PHI0 + (i / 160) * 2 * Math.PI;
      spiral.push([voluteR(phi) * Math.cos(phi), voluteR(phi) * Math.sin(phi)]);
    }
    spiral[160] = [RV * Math.cos(PHI0), RV * Math.sin(PHI0)];
    const wall = new THREE.BufferGeometry();
    const wp = [];
    const wi = [];
    spiral.forEach(([x, y], i) => {
      wp.push(x, y, zb, x, y, zt);
      if (i) { const a = (i - 1) * 2; wi.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    });
    // Nozzle: from the end of the spiral straight to the flange, plus the tongue side.
    const yTop = RV;
    const yTongue = R3;
    const nozzle = [[0, yTop], [NOZZLE_END, yTop + 0.08], [NOZZLE_END, yTongue - 0.12], [0, yTongue]];
    const base = wp.length / 3;
    for (const [x, y] of [nozzle[0], nozzle[1]]) wp.push(x, y, zb, x, y, zt);
    wi.push(base, base + 2, base + 3, base, base + 3, base + 1);
    for (const [x, y] of [nozzle[3], nozzle[2]]) wp.push(x, y, zb, x, y, zt);
    wi.push(base + 4, base + 6, base + 7, base + 4, base + 7, base + 5);
    wall.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wall.setIndex(wi);
    wall.computeVertexNormals();
    this.casing.add(new THREE.Mesh(wall, this.mat.casing));
    const outline = new THREE.Shape();
    spiral.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
    outline.lineTo(nozzle[1][0], nozzle[1][1]);
    outline.lineTo(nozzle[2][0], nozzle[2][1]);
    outline.lineTo(nozzle[3][0], nozzle[3][1]);
    outline.closePath();
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(outline, 1), this.mat.casing);
    plate.position.z = zb;
    this.casing.add(plate);
    const cover = new THREE.Mesh(new THREE.ShapeGeometry(outline, 1), this.mat.front);
    cover.position.z = zt;
    this.cover = cover;
    this.casing.add(cover);
    // Discharge flange ring and suction pipe.
    const flange = new THREE.Mesh(new THREE.TorusGeometry((yTop - yTongue) / 2 + 0.12, 0.04, 8, 32), this.mat.casing);
    flange.rotation.y = Math.PI / 2;
    flange.position.set(NOZZLE_END, (yTop + yTongue) / 2, (zb + zt) / 2);
    this.casing.add(flange);
    this.rEye = r1 * 0.98;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(this.rEye, this.rEye, PIPE_TOP - b1, 48, 1, true), this.mat.glass);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.z = b1 + (PIPE_TOP - b1) / 2;
    this.casing.add(pipe);
    this.setCut(this.cut ?? true);
  }

  setCut(on) {
    this.cut = on;
    if (this.cover) this.cover.visible = !on;
    if (this.frontShroud) this.frontShroud.visible = !on;
  }

  setFrame(frame) { this.frame = frame; }
  setFlowVisible(on) { this.showFlow = on; this.streaks.visible = on; }

  /** Display time scale: impeller below 0.4 blade pitch per 60 Hz frame (no strobing). */
  updateTimeScale(nMax, z) {
    const omega = (2 * Math.PI * nMax) / 60;
    const limit = (0.4 * 2 * Math.PI) / (z * omega * (1 / 60));
    this.timeScale = Math.min(1 / 40, limit, (Math.PI * 0.8) / omega); // ≤ ~0.4 rev/s
    return this.timeScale;
  }

  spawn(p, anywhere = false) {
    p.phase = 0;
    p.r = Math.sqrt(Math.random()) * (this.rEye ?? 0.4) * 0.9;
    p.phi = Math.random() * 2 * Math.PI;
    p.z = anywhere ? Math.random() * PIPE_TOP : PIPE_TOP;
    p.frac = 0.15 + Math.random() * 0.7;
    p.zf = 0.15 + Math.random() * 0.7;
    p.hist = [];
  }

  // Physical speeds (m/s) of the mean flow at display radius r.
  speeds(r) {
    const { Qi, Q, n } = this.op;
    const k = this.k;
    const R = r / k; // m
    const b = this.bAt(Math.min(Math.max(r, this.r1), 1)) / k;
    const cm = Qi / (2 * Math.PI * R * b);
    const omega = (2 * Math.PI * n) / 60;
    return { cm, wu: cm / Math.tan(this.betaAt(Math.min(Math.max(r, this.r1), 1)) * RAD), omega, Q };
  }

  update(dt) {
    if (!this.op || !this.g) return;
    const ts = this.timeScale;
    const k = this.k;
    const omega = (2 * Math.PI * this.op.n) / 60;
    this.rotor += omega * ts * dt;
    this.impeller.rotation.z = this.frame === 'abs' ? this.rotor : 0;
    this.casing.rotation.z = this.frame === 'abs' ? 0 : -this.rotor;

    const { Q, Qi, c2u } = this.op;
    const eyeArea = Math.PI * (this.rEye / k) ** 2;
    const cPipe = Q / eyeArea;
    const r1 = this.r1;
    const zIn = this.bAt(r1) * 0.5;

    if (this.showFlow && Q > 1e-6) {
      for (const p of this.p) {
        if (p.phase === 0) {
          // Suction pipe: axial, then turning outwards into the eye.
          p.z -= cPipe * k * ts * dt;
          if (p.z <= zIn) { p.z = zIn; p.phase = 0.5; }
        } else if (p.phase === 0.5) {
          p.r += cPipe * k * ts * dt * 1.2;
          if (p.r >= r1) { p.r = r1; p.phase = 1; p.phi -= this.rotor; } // to the rotating frame
        } else if (p.phase === 1) {
          // Impeller channel (relative frame): follows the blade camber.
          const { cm, wu } = this.speeds(p.r);
          p.r += cm * k * ts * dt;
          p.phi += (-wu / (p.r / k)) * ts * dt;
          p.z = this.bAt(Math.min(p.r, 1)) * p.zf;
          if (p.r >= 1) { p.r = 1; p.phase = 2; p.phi += this.rotor; p.start = p.phi; }
        } else if (p.phase === 2) {
          // Volute: free vortex c_u ∝ 1/r, spiralling out with the casing.
          const R = voluteR(p.phi);
          const r = 1 + (R - 1) * p.frac;
          const cu = c2u / (r);
          p.phi += (cu / (r / k)) * ts * dt;
          p.r = r;
          p.z = this.zVol[0] + 0.04 + (this.zVol[1] - this.zVol[0] - 0.08) * p.zf;
          const travelled = p.phi - p.start;
          const toTongue = ((((PHI0 - p.start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) || 2 * Math.PI;
          if (travelled >= toTongue) {
            p.phase = 3;
            p.x = 0;
            p.y = R3 + (RV - R3) * p.frac;
          }
        } else {
          // Discharge nozzle: straight to the flange.
          const area = ((RV - R3) / k) * ((this.zVol[1] - this.zVol[0]) / k);
          p.x -= (Q / area) * k * ts * dt;
          if (p.x <= NOZZLE_END) this.spawn(p);
        }
      }
    }

    // Positions in the absolute frame, history for the streaks.
    const P = this.positions;
    const C = this.colors;
    const head = new THREE.Color(FRAME_COLOR[this.frame]);
    const bg = this.bg ?? new THREE.Color(0xf4f5f7);
    let o = 0;
    for (const p of this.p) {
      let x;
      let y;
      if (p.phase === 3) { x = p.x; y = p.y; } else {
        const phi = p.phase === 1 ? p.phi + this.rotor : p.phi;
        x = p.r * Math.cos(phi);
        y = p.r * Math.sin(phi);
      }
      p.hist.unshift([x, y, p.z, this.rotor]);
      if (p.hist.length > SEG) p.hist.length = SEG;
      for (let s = 0; s < SEG - 1; s++) {
        const a = p.hist[Math.min(s, p.hist.length - 1)];
        const b = p.hist[Math.min(s + 1, p.hist.length - 1)];
        const pa = this.toView(a);
        const pb = this.toView(b);
        P[o] = pa[0]; P[o + 1] = pa[1]; P[o + 2] = pa[2];
        P[o + 3] = pb[0]; P[o + 4] = pb[1]; P[o + 5] = pb[2];
        const f0 = 0.85 * (s / (SEG - 1)) ** 1.6;
        const f1 = 0.85 * ((s + 1) / (SEG - 1)) ** 1.6;
        const c0 = head.clone().lerp(bg, f0);
        const c1 = head.clone().lerp(bg, f1);
        C[o] = c0.r; C[o + 1] = c0.g; C[o + 2] = c0.b;
        C[o + 3] = c1.r; C[o + 4] = c1.g; C[o + 5] = c1.b;
        o += 6;
      }
    }
    const g = this.streaks.geometry;
    g.attributes.instanceStart.data.needsUpdate = true;
    g.attributes.instanceColorStart.data.needsUpdate = true;

    this.updateBubbles(dt);
  }

  // Absolute-frame point → the frame being shown (rotor frame rotates by −rotor angle).
  toView([x, y, z, rot]) {
    if (this.frame === 'abs') return [x, y, z];
    const c = Math.cos(-rot);
    const s = Math.sin(-rot);
    return [x * c - y * s, x * s + y * c, z];
  }

  /** severity 0…1: how far ANPAd is below ANPAr. */
  setCavitation(severity) { this.cavitation = Math.max(0, Math.min(1, severity)); }

  updateBubbles(dt) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const want = Math.round(this.cavitation * this.maxBubbles);
    let alive = 0;
    for (const b of this.b) if (b.alive) alive++;
    const z = this.g.z;
    for (const b of this.b) {
      if (!b.alive && alive < want && Math.random() < 0.3) {
        // Leading edge, suction side (trailing face of the blade), relative frame.
        const blade = Math.floor(Math.random() * z);
        b.alive = true;
        b.r = this.r1 + 0.01 + Math.random() * 0.05;
        b.phiRel = (blade * 2 * Math.PI) / z + this.thetaAt(b.r) - (0.03 + Math.random() * 0.08);
        b.zf = 0.15 + Math.random() * 0.7;
        b.age = 0;
        b.life = 0.6 + Math.random() * 0.8;
        b.size = 0.012 + Math.random() * 0.02 * (0.5 + this.cavitation);
        alive++;
      }
    }
    for (let i = 0; i < this.maxBubbles; i++) {
      const b = this.b[i];
      let s = 0;
      if (b.alive) {
        const { cm, wu } = this.speeds(b.r);
        b.r += cm * this.k * this.timeScale * dt;
        b.phiRel += (-wu / (b.r / this.k)) * this.timeScale * dt;
        b.age += dt;
        // Grows in the low-pressure zone, collapses where the pressure recovers.
        const t = b.age / b.life;
        s = b.size * (t < 0.6 ? 0.4 + t : Math.max(0, 1 - (t - 0.6) * 2.5));
        if (t >= 1 || b.r > 1) { b.alive = false; s = 0; }
      }
      const x = b.r * Math.cos(b.phiRel);
      const y = b.r * Math.sin(b.phiRel);
      m.compose(new THREE.Vector3(x, y, this.bAt(Math.min(b.r, 1)) * (b.zf ?? 0.5)), q, new THREE.Vector3(s, s, s));
      this.bubbles.setMatrixAt(i, m);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
  }

  setBackground(color) {
    this.bg = new THREE.Color(color);
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.streakMat.resolution.set(w, h);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
