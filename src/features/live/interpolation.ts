// Smooth motion between snapshots (concept §7). Poll intervals of 8–30 s only
// look alive if vehicles keep moving between updates. This is presentation-only
// easing of server truth — it lives here and in LiveMap, never in Go/WASM.
//
// The map MVP uses bearing + inferred-speed straight-line dead reckoning (the
// concept's fallback for unmatched vehicles). Route-polyline matching is a later
// enhancement that can replace `predict()` without touching callers.

export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b` in degrees (0 = north, clockwise). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Point `distM` metres from `origin` along `bearing` degrees. */
export function destinationPoint(origin: LatLon, bearing: number, distM: number): LatLon {
  const ang = distM / EARTH_RADIUS_M;
  const brg = bearing * DEG;
  const lat1 = origin.lat * DEG;
  const lon1 = origin.lon * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg));
  const lon2 =
    lon1 + Math.atan2(Math.sin(brg) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / DEG, lon: lon2 / DEG };
}

// Plausible ground speeds cap the inferred speed so a bad snapshot pair can't
// fling a marker across the map (§7).
const MAX_SPEED_MPS = 45; // ~160 km/h, covers S-Bahn/regional rail
const MIN_SPEED_MPS = 0;

export function clampSpeed(mps: number): number {
  if (!Number.isFinite(mps)) return 0;
  return Math.max(MIN_SPEED_MPS, Math.min(MAX_SPEED_MPS, mps));
}

/**
 * Where the vehicle should be *now*, extrapolating from its last server fix
 * along `bearing` at `speedMps` for `secondsSinceFix`. Extrapolation is capped
 * so a stale fix (e.g. a paused poll) doesn't run a marker off into nowhere.
 */
export function predict(serverPos: LatLon, bearing: number, speedMps: number, secondsSinceFix: number): LatLon {
  const capped = Math.max(0, Math.min(secondsSinceFix, 45));
  const dist = clampSpeed(speedMps) * capped;
  if (dist < 0.5) return serverPos;
  return destinationPoint(serverPos, bearing, dist);
}

// A rendered position past this error from the target snaps instead of easing
// (§7: "error above ~300 m snaps immediately").
export const SNAP_THRESHOLD_M = 300;

/**
 * Eases `current` toward `target` by a time-based factor (frame-rate independent).
 * `tauSeconds` is the smoothing time constant; larger = slower correction.
 * Snaps outright when the two are more than {@link SNAP_THRESHOLD_M} apart.
 *
 * Tau is deliberately of the same order as the correction itself: at 0.4 s even a
 * routine 60 m poll correction was covered at ~150 m/s, which reads as a jump
 * rather than motion.
 */
export function easeTowards(current: LatLon, target: LatLon, dtSeconds: number, tauSeconds = 1.2): LatLon {
  if (haversineM(current, target) > SNAP_THRESHOLD_M) return target;
  const alpha = 1 - Math.exp(-dtSeconds / tauSeconds);
  return {
    lat: current.lat + (target.lat - current.lat) * alpha,
    lon: current.lon + (target.lon - current.lon) * alpha
  };
}
