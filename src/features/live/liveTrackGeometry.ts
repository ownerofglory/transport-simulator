import * as THREE from 'three';

// Shared smoothing for live rail geometry. The GTFS-derived shape points the live
// feed matches against are sparse and slightly jagged, so raw polylines read as a
// chain of straight segments with visible kinks at each vertex. Explore avoids this
// by pre-smoothing its control points and fitting a centripetal Catmull-Rom curve
// (see createRouteCurve in route.ts). We mirror that here so the live rails, ballast
// and the vehicle motion path all follow the same smooth centerline.

/**
 * Two light averaging passes over the XZ of a polyline, endpoints fixed. Reduces
 * jaggedness without changing the point count (so a parallel tunnel mask stays
 * index-aligned) or the Y values (terrain height is applied separately).
 */
export function smoothTrackXZ(points: THREE.Vector3[], passes = 2): THREE.Vector3[] {
  let pts = points.map((p) => p.clone());
  for (let pass = 0; pass < passes; pass++) {
    pts = pts.map((p, i, src) => {
      if (i === 0 || i === src.length - 1) return p.clone();
      const x = src[i - 1].x * 0.2 + p.x * 0.6 + src[i + 1].x * 0.2;
      const z = src[i - 1].z * 0.2 + p.z * 0.6 + src[i + 1].z * 0.2;
      return new THREE.Vector3(x, p.y, z);
    });
  }
  return pts;
}

/**
 * Resamples a polyline along a centripetal Catmull-Rom curve at roughly `spacingM`
 * intervals, rounding off corners. Returns at least the original density. With
 * fewer than 3 points there is nothing to curve, so the input is returned as-is.
 */
export function resampleTrackXZ(points: THREE.Vector3[], spacingM = 5): THREE.Vector3[] {
  if (points.length < 3) return points.map((p) => p.clone());
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => p.clone()),
    false,
    'centripetal'
  );
  const length = curve.getLength();
  const count = Math.max(points.length - 1, Math.ceil(length / spacingM));
  return curve.getSpacedPoints(count);
}

/** Explore-style smoothing: light averaging then a resampled Catmull-Rom. */
export function buildSmoothTrackXZ(points: THREE.Vector3[], spacingM = 5): THREE.Vector3[] {
  return resampleTrackXZ(smoothTrackXZ(points), spacingM);
}
