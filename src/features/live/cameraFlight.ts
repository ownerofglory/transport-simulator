// Pure camera-flight easing for "fly to a searched station" in the live 3D view.
// Kept free of Three.js so the timing rules can be tested without a renderer.

/** Cruise speed used to size the flight; long hops take longer, but not linearly. */
const SPEED_M_PER_S = 1800;
const MIN_DURATION_S = 0.55;
const MAX_DURATION_S = 2.2;

export type CameraFlight = {
  fromX: number;
  fromZ: number;
  fromY: number;
  fromDistance: number;
  toX: number;
  toZ: number;
  toDistance: number;
  elapsed: number;
  duration: number;
};

/** Flight duration for a ground distance, clamped so short hops still ease. */
export function flightDuration(travelM: number): number {
  return Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, travelM / SPEED_M_PER_S));
}

/** easeInOutQuad — starts and ends at rest, so the camera never snaps. */
export function easeInOut(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - (-2 * clamped + 2) ** 2 / 2;
}

export type FlightSample = { x: number; z: number; y: number; distance: number; done: boolean };

/**
 * Advances a flight by `dt` and returns the interpolated orbit target. `groundY`
 * is sampled by the caller each frame because terrain streams in mid-flight, so
 * the destination height is not known when the flight starts.
 */
export function advanceFlight(flight: CameraFlight, dt: number, groundY: number): FlightSample {
  flight.elapsed += dt;
  const t = flight.duration > 0 ? flight.elapsed / flight.duration : 1;
  const e = easeInOut(t);
  return {
    x: flight.fromX + (flight.toX - flight.fromX) * e,
    z: flight.fromZ + (flight.toZ - flight.fromZ) * e,
    y: flight.fromY + (groundY - flight.fromY) * e,
    distance: flight.fromDistance + (flight.toDistance - flight.fromDistance) * e,
    done: t >= 1
  };
}
