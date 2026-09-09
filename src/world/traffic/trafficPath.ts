// Pure along-path sampling for road traffic. A vehicle's whole trip is fetched
// once as a polyline; motion is then purely a function of distance travelled,
// so per-frame work is a binary search plus a lerp — no re-routing, no physics.

export type XZ = { x: number; z: number };

export type PathGeometry = {
  xs: Float64Array;
  zs: Float64Array;
  cum: Float64Array; // cumulative distance at each vertex, metres
  total: number;
};

export function buildPathGeometry(points: XZ[]): PathGeometry {
  const n = points.length;
  const xs = new Float64Array(n);
  const zs = new Float64Array(n);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = points[i].x;
    zs[i] = points[i].z;
    cum[i] = i === 0 ? 0 : cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return { xs, zs, cum, total: n > 0 ? cum[n - 1] : 0 };
}

export type PathPose = { x: number; z: number; headingRad: number };

/** Signed shortest turn from one yaw to another, including across the -PI/PI seam. */
export function shortestAngleDelta(fromRad: number, toRad: number): number {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
}

/** Frame-rate-independent angular smoothing for routed actors. */
export function dampAngle(currentRad: number, targetRad: number, response: number, dtSec: number): number {
  const blend = 1 - Math.exp(-response * Math.max(0, dtSec));
  return currentRad + shortestAngleDelta(currentRad, targetRad) * blend;
}

/** Position + direction of travel at `distM` along a path, clamped to its ends. */
export function poseAtDistance(path: PathGeometry, distM: number): PathPose {
  const { xs, zs, cum } = path;
  const n = cum.length;
  if (n === 0) return { x: 0, z: 0, headingRad: 0 };
  if (n === 1) return { x: xs[0], z: zs[0], headingRad: 0 };
  const d = Math.min(Math.max(distM, 0), path.total);
  let low = 0;
  let high = n - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (cum[mid] <= d) low = mid;
    else high = mid;
  }
  const segLen = cum[high] - cum[low];
  const t = segLen > 0 ? (d - cum[low]) / segLen : 0;
  return {
    x: xs[low] + (xs[high] - xs[low]) * t,
    z: zs[low] + (zs[high] - zs[low]) * t,
    // Three.js yaw convention: rotation.y = atan2(dx, dz) faces a +Z-forward model along (dx, dz).
    headingRad: Math.atan2(xs[high] - xs[low], zs[high] - zs[low])
  };
}

/**
 * Picks a sparse, roughly `spacingM`-apart subset of a routed polyline's points
 * (always keeping the last one) to sample terrain height at — a route can carry
 * hundreds of points, and street-level relief doesn't need vertex accuracy, only
 * a smooth enough curve for {@link lerpAt} to ride on.
 */
export function pickHeightAnchors<P>(points: P[], cumM: Float64Array, spacingM: number, maxCount: number): { atM: number; point: P }[] {
  const anchors: { atM: number; point: P }[] = [];
  let lastAtM = -Infinity;
  for (let i = 0; i < points.length && anchors.length < maxCount; i++) {
    const atM = cumM[i];
    if (atM - lastAtM < spacingM && i !== points.length - 1) continue;
    anchors.push({ atM, point: points[i] });
    lastAtM = atM;
  }
  return anchors;
}

/** Linear interpolation over a sparse, ascending series (e.g. terrain height anchors). */
export function lerpAt(atM: Float64Array, values: Float64Array, distM: number): number {
  const n = atM.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  if (distM <= atM[0]) return values[0];
  if (distM >= atM[n - 1]) return values[n - 1];
  let low = 0;
  let high = n - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (atM[mid] <= distM) low = mid;
    else high = mid;
  }
  const span = atM[high] - atM[low];
  const t = span > 0 ? (distM - atM[low]) / span : 0;
  return values[low] + (values[high] - values[low]) * t;
}
