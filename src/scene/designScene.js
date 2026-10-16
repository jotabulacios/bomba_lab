// Design view: the impeller (and optionally the volute) at real scale, so changing D2,
// b2, β2, z or D1 changes what you see; a translucent ghost of the reference design for
// comparison; and dimension marks (D1, D2, b2, β2, z) with live labels. The camera stays
// put while you change dimensions, so growth and shrinkage are visible.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { impellerProfile, bladeRow, frontShroudGeometry, voluteGeometry } from './pumpGeometry.js';

const S = 6; // display units per metre
const RAD = Math.PI / 180;

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

export class DesignScene {
  constructor(renderer, host) {
    this.renderer = renderer;
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d949c, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 4, 6);
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.18, rotateSpeed: 0.45, zoomSpeed: 0.7, minDistance: 1.5, maxDistance: 40 });
    this.controls.enabled = false;
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    this.labels.domElement.style.display = 'none';
    host.appendChild(this.labels.domElement);

    const phys = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide, ...extra });
    this.mat = {
      blade: phys(0xc9b48f, { clearcoat: 0.3 }),
      hub: phys(0xb9a27c),
      shroud: phys(0xb9a27c, { transparent: true, opacity: 0.25, depthWrite: false }),
      volute: phys(0x3f6fb5, { transparent: true, opacity: 0.22, depthWrite: false }),
      ghost: new THREE.MeshBasicMaterial({ color: 0x8a939d, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      ghostEdge: new THREE.LineBasicMaterial({ color: 0x8a939d, transparent: true, opacity: 0.6 }),
      dim: new THREE.LineBasicMaterial({ color: 0x5b6570 }),
      dimHi: new THREE.LineBasicMaterial({ color: 0x2a78d6 }),
    };
    this.current = new THREE.Group();
    this.ghost = new THREE.Group();
    this.dims = new THREE.Group();
    this.scene.add(this.current, this.ghost, this.dims);
    this.showVolute = true;
    this.highlightKey = null;
    this.fitted = false;
  }

  /** Impeller (+ volute) for geometry g (metres, degrees) into group, with materials. */
  buildPump(group, g, ghost) {
    group.traverse((o) => o.geometry?.dispose?.());
    group.clear();
    const R2 = (g.D2 / 2) * S;
    const prof = impellerProfile({ r1: (g.D1 / 2) * S, r2: R2, b1: g.b1 * S, b2: g.b2 * S, beta1: g.beta1, beta2: g.beta2 });
    const half = Math.max(g.t * S * 0.5, 0.006);
    const blades = bladeRow(prof, half, g.z, ghost ? this.mat.ghost : this.mat.blade);
    group.add(blades);
    const back = new THREE.Mesh(new THREE.CircleGeometry(R2, 96), ghost ? this.mat.ghost : this.mat.hub);
    back.position.z = -0.002;
    group.add(back);
    if (ghost) {
      // Outline rings make the ghost readable from any angle.
      for (const [r, z] of [[R2, 0], [R2, g.b2 * S], [(g.D1 / 2) * S, g.b1 * S]]) {
        const pts = [];
        for (let i = 0; i <= 96; i++) pts.push(new THREE.Vector3(r * Math.cos((i / 96) * 2 * Math.PI), r * Math.sin((i / 96) * 2 * Math.PI), z));
        group.add(line(pts, this.mat.ghostEdge));
      }
    } else {
      group.add(new THREE.Mesh(frontShroudGeometry(prof, 0.004), this.mat.shroud));
    }
    if (this.showVolute && g.throat) {
      const vol = new THREE.Mesh(voluteGeometry({
        R3: g.throat.R3 * S, rho0: g.throat.rho * S * 0.15, rho1: g.throat.rho * S,
        zc: (g.b2 * S) / 2, yTop: R2 * 1.9,
      }), ghost ? this.mat.ghost : this.mat.volute);
      group.add(vol);
    }
    return prof;
  }

  /**
   * @param g current geometry { D2, D1, b1, b2, beta1, beta2, z, t, throat }
   * @param ref reference geometry (same fields) or null
   */
  setDesign(g, ref) {
    this.g = g;
    this.lastArgs = [g, ref];
    const prof = this.buildPump(this.current, g, false);
    if (ref) this.buildPump(this.ghost, ref, true); else this.ghost.clear();
    this.ghost.visible = !!ref;
    this.buildDims(g, prof);
    if (!this.fitted) { this.fitTo(ref ?? g); this.fitted = true; }
  }

  buildDims(g, prof) {
    this.dims.traverse((o) => o.geometry?.dispose?.());
    for (const o of [...this.dims.children]) {
      if (o.isCSS2DObject) o.element.remove();
    }
    this.dims.clear();
    this.dimParts = {};
    const R2 = (g.D2 / 2) * S;
    const R1 = (g.D1 / 2) * S;
    const zf = g.b2 * S + 0.02;
    const reg = (key, objs, lbl) => {
      this.dimParts[key] = { objs, lbl };
      for (const o of objs) this.dims.add(o);
      this.dims.add(lbl);
    };
    const diameter = (key, R, ang, z, text) => {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const l = line([new THREE.Vector3(-R * c, -R * s, z), new THREE.Vector3(R * c, R * s, z)], this.mat.dim);
      const ticks = [-1, 1].map((k) => line([new THREE.Vector3(k * R * c - 0.06 * s, k * R * s + 0.06 * c, z), new THREE.Vector3(k * R * c + 0.06 * s, k * R * s - 0.06 * c, z)], this.mat.dim));
      const lb = label('dim-label', text);
      lb.position.set(R * c * 0.82, R * s * 0.82, z);
      reg(key, [l, ...ticks], lb);
    };
    diameter('D2mm', R2, -0.35, zf, `D2 = ${(g.D2 * 1000).toFixed(0)} mm`);
    diameter('D1mm', R1, 2.3, g.b1 * S + 0.02, `D1 = ${(g.D1 * 1000).toFixed(0)} mm`);
    // b2: bracket across the outlet width, at the right edge.
    {
      const x = R2 + 0.12;
      const l = line([new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, g.b2 * S)], this.mat.dim);
      const t0 = line([new THREE.Vector3(R2, 0, 0), new THREE.Vector3(x + 0.05, 0, 0)], this.mat.dim);
      const t1 = line([new THREE.Vector3(R2, 0, g.b2 * S), new THREE.Vector3(x + 0.05, 0, g.b2 * S)], this.mat.dim);
      const lb = label('dim-label', `b2 = ${(g.b2 * 1000).toFixed(1)} mm`);
      lb.position.set(x + 0.08, 0, (g.b2 * S) / 2);
      lb.center.set(0, 0.5);
      reg('b2mm', [l, t0, t1], lb);
    }
    // β2: angle between the blade tip direction and the tangent (opposite to u).
    {
      const th = prof.thetaAt(R2);
      const tip = new THREE.Vector3(R2 * Math.cos(th), R2 * Math.sin(th), zf);
      const tang = new THREE.Vector3(Math.sin(th), -Math.cos(th), 0); // −u direction (CCW rotation)
      const r = R2 * 0.995;
      const thIn = prof.thetaAt(r);
      const inner = new THREE.Vector3(r * Math.cos(thIn), r * Math.sin(thIn), zf);
      // w2 leaves along the blade, outwards: β2 is its angle to the −u direction.
      const bladeDir = tip.clone().sub(inner).normalize();
      const L = R2 * 0.35;
      const l1 = line([tip, tip.clone().addScaledVector(tang, L)], this.mat.dim);
      const l2 = line([tip, tip.clone().addScaledVector(bladeDir, L)], this.mat.dim);
      const arcPts = [];
      const a0 = Math.atan2(tang.y, tang.x);
      const a1 = Math.atan2(bladeDir.y, bladeDir.x);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      for (let i = 0; i <= 20; i++) {
        const a = a0 + (da * i) / 20;
        arcPts.push(tip.clone().add(new THREE.Vector3(Math.cos(a) * L * 0.6, Math.sin(a) * L * 0.6, 0)));
      }
      const arc = line(arcPts, this.mat.dim);
      const lb = label('dim-label', `β2 = ${g.beta2.toFixed(0)}°`);
      const mid = a0 + da / 2;
      lb.position.copy(tip).add(new THREE.Vector3(Math.cos(mid) * L * 0.85, Math.sin(mid) * L * 0.85, 0));
      reg('beta2', [l1, l2, arc], lb);
    }
    // z: count label near the hub.
    {
      const lb = label('dim-label', `z = ${g.z} álabes`);
      lb.position.set(-R2 * 0.55, -R2 * 0.7, zf);
      reg('z', [], lb);
    }
    this.highlight(this.highlightKey);
  }

  /** Emphasise the dimension that a hovered slider controls (null clears). */
  highlight(key) {
    this.highlightKey = key;
    for (const [k, part] of Object.entries(this.dimParts ?? {})) {
      const on = k === key;
      for (const o of part.objs) o.material = on ? this.mat.dimHi : this.mat.dim;
      part.lbl.element.classList.toggle('hi', on);
    }
  }

  setVolute(on) {
    this.showVolute = on;
    if (this.lastArgs) this.setDesign(...this.lastArgs);
  }

  fitTo(g) {
    const R = (g.D2 / 2) * S * (this.showVolute ? 1.9 : 1.2);
    this.controls.target.set(0, R * 0.12, 0);
    this.camera.position.set(R * 0.9, R * 0.9, R * 3.2);
    this.controls.update();
  }

  /** 'front' | 'side' | 'iso' presets around the current design. */
  setCamera(kind) {
    const R = ((this.g?.D2 ?? 0.3) / 2) * S * (this.showVolute ? 1.9 : 1.2);
    const t = this.controls.target;
    if (kind === 'front') this.camera.position.set(t.x, t.y, t.z + R * 3.3);
    else if (kind === 'side') this.camera.position.set(t.x + R * 3.3, t.y + 0.01, t.z + 0.01);
    else this.camera.position.set(R * 0.9, R * 0.9, R * 3.2);
    this.controls.update();
  }

  setLabelsVisible(on) { this.labels.domElement.style.display = on ? '' : 'none'; }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.labels.setSize(w, h);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
