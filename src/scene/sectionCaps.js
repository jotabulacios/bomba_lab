// Section view by stencil capping: the parts are clipped by a plane and the cut face is
// filled where the plane lies inside a solid. For every group of parts, its back faces
// increment the stencil and its front faces decrement it (no depth test), so the stencil
// is non-zero exactly where the plane crosses material; a plane drawn there with the
// group's hatch fills the cut and resets the stencil for the next group. Each group can
// have its own hatch (ISO 128: casing 45°, impeller −45°, shaft not hatched).

import * as THREE from 'three';

/** Tileable hatch texture: background fill and diagonal lines (angle ±45°). */
export function hatchTexture(fill, ink, dir = 1, dense = false) {
  const N = 64;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, N, N);
  if (ink) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = dense ? 3 : 4;
    const k = dense ? 2 : 1;
    for (let i = -k; i <= k; i++) {
      const o = (i * N) / k;
      ctx.beginPath();
      if (dir > 0) { ctx.moveTo(o, N); ctx.lineTo(o + N, 0); } else { ctx.moveTo(o, 0); ctx.lineTo(o + N, N); }
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const stencilMat = (side, op, plane) => new THREE.MeshBasicMaterial({
  side, colorWrite: false, depthWrite: false, depthTest: false,
  stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
  stencilFail: op, stencilZFail: op, stencilZPass: op,
  clippingPlanes: [plane],
});

export class SectionCaps {
  /**
   * @param plane the cutting plane (the side with negative distance is removed)
   * @param size  side of the square cap planes (larger than the parts)
   */
  constructor(plane, size) {
    this.plane = plane;
    this.size = size;
    this.root = new THREE.Group();
    this.groups = [];
    this.back = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp, plane);
    this.front = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp, plane);
  }

  /**
   * @param groups [{ meshes: [THREE.Mesh], hatch: { fill, ink, dir, dense, spacing } }]
   */
  setGroups(groups) {
    this.clear();
    groups.forEach((g, k) => {
      const order = 1 + k;
      for (const m of g.meshes) {
        for (const mat of [this.back, this.front]) {
          const s = new THREE.Mesh(m.geometry, mat);
          s.userData.isStencil = true;
          s.renderOrder = order;
          s.raycast = () => {};
          m.add(s);
          this.helpers.push(s);
        }
      }
      const tex = hatchTexture(g.hatch.fill, g.hatch.ink, g.hatch.dir ?? 1, g.hatch.dense);
      const rep = this.size / (g.hatch.spacing ?? 0.12);
      tex.repeat.set(rep, rep);
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(this.size, this.size), new THREE.MeshBasicMaterial({
        map: tex, side: THREE.DoubleSide,
        stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      }));
      cap.renderOrder = order + 0.5;
      cap.userData.noPlan = true;
      cap.raycast = () => {};
      this.root.add(cap);
      this.groups.push({ cap, meshes: g.meshes });
    });
    this.update();
  }

  /** Keep the cap planes on the cutting plane (call after moving it). */
  update() {
    const p = this.plane.coplanarPoint(new THREE.Vector3());
    for (const g of this.groups) {
      g.cap.position.copy(p);
      g.cap.lookAt(p.x - this.plane.normal.x, p.y - this.plane.normal.y, p.z - this.plane.normal.z);
    }
  }

  setVisible(on) {
    this.root.visible = on;
    for (const h of this.helpers ?? []) h.visible = on;
  }

  clear() {
    for (const h of this.helpers ?? []) h.removeFromParent();
    this.helpers = [];
    for (const g of this.groups) {
      g.cap.geometry.dispose();
      g.cap.material.map.dispose();
      g.cap.material.dispose();
    }
    this.root.clear();
    this.groups = [];
  }
}
