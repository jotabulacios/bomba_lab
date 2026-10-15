// Two pumps working together (apunte 13, p. 34–36): in series heads add at the same
// flow; in parallel flows add at the same head, and a weaker pump only contributes
// below its own shut-off head.

/**
 * Flow a single pump delivers at head H on the descending branch of its curve
 * (0 if H is above what it can give).
 * @param headAt Q ↦ H, @param qMax zero-head flow
 */
export function flowAtHead(headAt, qMax, H) {
  // The real curve can rise slightly near Q = 0; use the branch right of its peak.
  let qPeak = 0;
  let hPeak = headAt(0);
  for (let i = 1; i <= 40; i++) {
    const q = (qMax * i) / 40;
    const h = headAt(q);
    if (h > hPeak) { hPeak = h; qPeak = q; }
  }
  if (H >= hPeak) return 0;
  if (H <= 0) return qMax;
  let lo = qPeak;
  let hi = qMax;
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (headAt(mid) > H) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Series group: H(Q) = H_A(Q) + H_B(Q); the group flow ends where the first pump does. */
export function series(a, b) {
  return {
    headAt: (Q) => a.headAt(Q) + b.headAt(Q),
    qMax: Math.min(a.qMax, b.qMax),
    split: (Q) => ({ QA: Q, QB: Q, HA: a.headAt(Q), HB: b.headAt(Q) }),
  };
}

/** Parallel group: Q(H) = Q_A(H) + Q_B(H); returned as a head curve H(Q) by inversion. */
export function parallel(a, b) {
  const hMax = Math.max(a.headAt(0), b.headAt(0), ...[0.1, 0.2, 0.3].flatMap((f) => [a.headAt(f * a.qMax), b.headAt(f * b.qMax)]));
  const qTotal = (H) => flowAtHead(a.headAt, a.qMax, H) + flowAtHead(b.headAt, b.qMax, H);
  const headAt = (Q) => {
    if (Q <= 0) return Math.max(a.headAt(0), b.headAt(0));
    let lo = 0;
    let hi = hMax;
    if (qTotal(lo) < Q) return 0;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      if (qTotal(mid) > Q) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return {
    headAt,
    qMax: a.qMax + b.qMax,
    split: (Q) => {
      const H = headAt(Q);
      return { QA: flowAtHead(a.headAt, a.qMax, H), QB: flowAtHead(b.headAt, b.qMax, H), HA: H, HB: H };
    },
  };
}
