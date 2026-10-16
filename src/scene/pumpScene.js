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
import { impellerProfile, bladeRow, frontShroudGeometry, voluteGeometry } from './pumpGeometry.js';

const RAD = Math.PI / 180;
const SEG = 10; // streak history samples
const R3 = 1.07; // volute base circle (tongue clearance)
const RHO0 = 0.06; // volute section radius at the tongue
const RHO1 = 0.36; // … and at the end of the spiral
const PHI0 = 0; // tongue on the +x side: the spiral ends heading +y into a vertical discharge
const Y_TOP = 2.3; // height of the discharge flange
const PIPE_TOP = 1.5; // suction pipe length along +z
const sectionRho = (u) => RHO0 + (RHO1 - RHO0) * u;
const FRAME_COLOR = { abs: 0x2a78d6, rel: 0xeb6834 };

/** Wrap fraction u ∈ [0, 1) of angle φ, measured from the tongue. */
const wrapU = (phi) => ((((phi - PHI0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);

export class PumpScene {
  constructor(host, count = 900) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
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
    // A 100 px drag used to swing the view ~100° and keep coasting for ~1.5 s ("gira
    // loca"). Slower rotation, short inertia and sensible limits keep it under control.
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.18;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.7;
    this.controls.panSpeed = 0.6;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 16;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI - 0.15;
    this.resetCamera();

    this.cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.1);
    const clip = [this.cutPlane];
    const phys = (color, metalness, roughness, extra = {}) => new THREE.MeshPhysicalMaterial({ color, metalness, roughness, side: THREE.DoubleSide, ...extra });
    this.mat = {
      impeller: phys(0xc9b48f, 0.55, 0.35, { clearcoat: 0.3 }),
      hub: phys(0xb9a27c, 0.5, 0.4),
      casing: phys(0x3f6fb5, 0.4, 0.42, { clippingPlanes: clip }),
      frame: phys(0x3f6fb5, 0.4, 0.45),
      motor: phys(0x59636e, 0.5, 0.4),
      base: phys(0x4b5158, 0.3, 0.6),
      flangeMat: phys(0x8e9aa6, 0.6, 0.35),
      glass: phys(0xbfd6ea, 0.0, 0.1, { transparent: true, opacity: 0.16, depthWrite: false }),
      front: phys(0xb9a27c, 0.5, 0.4, { clippingPlanes: clip }),
      shaft: phys(0x6f7780, 0.7, 0.3),
      ghostCasing: new THREE.MeshBasicMaterial({ color: 0x8e9aa6, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
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
    this.camera.position.set(4.2, 2.6, 5.6);
    this.controls.target.set(0.1, 0.35, -0.5);
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

    // Blade camber θ(r) = −∫ dr / (r tan β) and channel width b(r) (pumpGeometry.js).
    const prof = impellerProfile({ r1, r2: 1, b1, b2, beta1: g.beta1, beta2: g.beta2 });
    this.thetaAt = prof.thetaAt;
    this.impeller.add(bladeRow(prof, (g.t * k) / 2 + 0.006, g.z, this.mat.impeller));

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
    const frontShroud = new THREE.Mesh(frontShroudGeometry(prof, 0.012), this.mat.front);
    this.frontShroud = frontShroud;
    this.impeller.add(frontShroud);

    // Shaft behind the impeller.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 24), this.mat.shaft);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.75;
    this.impeller.add(shaft);

    // Volute: a tube whose circular section grows with the wrap angle (from the tongue
    // at φ = 0 on the +x side), ending in a straight diffuser that rises to a vertical
    // discharge flange, as in an end-suction pump. The cut plane opens its front half.
    const zc = Math.max(this.bAt(1), 0.04) / 2;
    this.zc = zc;
    this.cutPlane.constant = this.cut === false ? 1e3 : zc;
    const rEnd = R3 + RHO1;
    const vol = voluteGeometry({ R3, rho0: RHO0, rho1: RHO1, zc, yTop: Y_TOP });
    this.casing.add(new THREE.Mesh(vol, this.mat.casing));
    // Tongue (cutwater): the sharp wedge where the diffuser leaves the first turn.
    const tongue = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 12), this.mat.casing);
    tongue.position.set(R3 + 0.03, 0.12, zc);
    tongue.rotation.z = Math.PI;
    this.casing.add(tongue);
    // Casing sides (the impeller chamber): back wall and front wall with the suction eye.
    const chamber = new THREE.Mesh(new THREE.RingGeometry(0.12, R3 + 0.02, 96), this.mat.casing);
    chamber.position.z = -0.1;
    this.casing.add(chamber);
    const front = new THREE.Mesh(new THREE.RingGeometry(this.r1 * 1.02, R3 + 0.02, 96), this.mat.casing);
    front.position.z = 2 * zc + 0.1;
    this.casing.add(front);
    // Discharge and suction flanges.
    const dFlange = new THREE.Mesh(new THREE.TorusGeometry(RHO1 * 1.3, 0.05, 10, 36), this.mat.flangeMat);
    dFlange.rotation.x = Math.PI / 2;
    dFlange.position.set(rEnd, Y_TOP, zc);
    this.casing.add(dFlange);
    this.rEye = r1 * 0.98;
    const sFlange = new THREE.Mesh(new THREE.TorusGeometry(this.rEye + 0.06, 0.05, 10, 36), this.mat.flangeMat);
    sFlange.position.z = PIPE_TOP;
    this.casing.add(sFlange);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(this.rEye, this.rEye, PIPE_TOP - b1, 48, 1, true), this.mat.glass);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.z = b1 + (PIPE_TOP - b1) / 2;
    this.casing.add(pipe);

    // Drive train behind the casing: bearing frame, coupling, motor; base plate and feet.
    const cyl = (r, len, z, m) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32), m);
      c.rotation.x = Math.PI / 2;
      c.position.z = z;
      return c;
    };
    this.casing.add(cyl(0.3, 1.1, -0.75, this.mat.frame));
    this.casing.add(cyl(0.36, 0.12, -1.38, this.mat.frame));
    const motor = cyl(0.62, 1.5, -2.35, this.mat.motor);
    this.casing.add(motor);
    for (let k = 0; k < 16; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 1.3), this.mat.motor);
      const a = (k / 16) * Math.PI * 2;
      fin.position.set(0.66 * Math.cos(a), 0.66 * Math.sin(a), -2.35);
      fin.rotation.z = a;
      this.casing.add(fin);
    }
    this.casing.add(cyl(0.2, 0.25, -3.2, this.mat.motor)); // fan cover
    const baseY = -(R3 + RHO1) - 0.35;
    const basePlate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 4.6), this.mat.base);
    basePlate.position.set(0, baseY, -1.2);
    this.casing.add(basePlate);
    for (const [z, h] of [[-0.05, (R3 + RHO1) * 0.55], [-0.75, 0.45], [-2.35, 0.2]]) {
      const top = z === -0.05 ? -(R3 + RHO1) * 0.55 : z === -0.75 ? -0.3 : -0.62;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, Math.max(top - baseY, 0.05), 0.35), this.mat.base);
      foot.position.set(0, (top + baseY) / 2, z);
      this.casing.add(foot);
    }
    // Coupling (on the rotor so its turning is visible).
    const coupling = cyl(0.26, 0.18, -1.55, this.mat.flangeMat);
    this.impeller.add(coupling);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.2), this.mat.motor);
    mark.position.set(0, 0.16, -1.55);
    this.impeller.add(mark);

    this.casing.traverse((o) => { if (o.material) o.userData.mat = o.material; });
    this.ghost = this.mat.ghostCasing;
    this.setCut(this.cut ?? true);
    if (this.frame === 'rel') this.setFrame('rel');
  }

  /** Cut: clipping plane through the volute centre plane (opens the front half). */
  setCut(on) {
    this.cut = on;
    this.cutPlane.constant = on ? (this.zc ?? 0.1) : 1e3;
  }

  /**
   * Absolute frame: impeller turns, particles follow c everywhere. Rotor frame: the
   * impeller stands still and only the channel flow (w) is shown; the casing would spin
   * backwards in this frame, which reads as "everything breaks", so it is ghosted and
   * kept still as a reference. Trails restart so they never mix the two frames.
   */
  setFrame(frame) {
    this.frame = frame;
    for (const p of this.p) p.hist = [];
    this.casing.traverse((o) => {
      if (!o.material || o.material === this.mat.glass) return;
      o.material = frame === 'abs' ? (o.userData.mat ?? o.material) : this.ghost;
    });
  }
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
    p.travel = undefined;
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
    this.casing.rotation.z = 0;

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
          // Volute: free vortex (c_u ∝ 1/r) along the growing circular section, until the
          // wrap reaches the tongue; then up the diffuser.
          if (p.travel === undefined) {
            p.travel = 0;
            p.toEnd = (1 - wrapU(p.phi)) * 2 * Math.PI;
            p.psi = (Math.random() * 2 - 1) * Math.PI;
            p.frac = 0.15 + Math.random() * 0.7;
          }
          const rho = sectionRho(wrapU(p.phi));
          const r = R3 + rho + p.frac * rho * Math.cos(p.psi);
          const cu = c2u / Math.max(r, 1);
          const dphi = (cu / (r / k)) * ts * dt;
          p.phi += dphi;
          p.travel += dphi;
          p.r = r;
          p.z = this.zc + p.frac * rho * Math.sin(p.psi);
          if (p.travel >= p.toEnd) {
            p.phase = 3;
            p.x = R3 + RHO1 + p.frac * RHO1 * Math.cos(p.psi);
            p.y = 0;
          }
        } else {
          // Diffuser and vertical discharge: straight up to the flange.
          const area = Math.PI * (RHO1 * 1.12 / k) ** 2;
          p.y += (Q / area) * k * ts * dt;
          p.z = this.zc + p.frac * RHO1 * Math.sin(p.psi);
          if (p.y >= Y_TOP) this.spawn(p);
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
      const hidden = this.frame === 'rel' && p.phase !== 1;
      if (hidden) p.hist = [];
      p.hist.unshift([x, y, p.z, this.rotor]);
      if (p.hist.length > SEG) p.hist.length = SEG;
      if (hidden) {
        // Park the whole streak beyond the far plane (a zero-length segment would still
        // draw a round dot).
        for (let s = 0; s < SEG - 1; s++, o += 6) {
          P[o] = 0; P[o + 1] = 0; P[o + 2] = 1e5; P[o + 3] = 0; P[o + 4] = 0; P[o + 5] = 1e5;
        }
        continue;
      }
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
