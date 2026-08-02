// Rendering-agnostic client-side vehicle store (concept §6.1 merge + §7 motion).
//
// Snapshots merge in keyed by runId; between snapshots `tick()` advances each
// vehicle by dead reckoning. The store knows nothing about Leaflet or Three.js —
// LiveMap (or a future 3D LiveTrafficSystem) reads `list()` and draws it. That
// separation is deliberate: the polling/merge/interpolation core is reusable by
// whichever renderer the app grows.

import { bearingDeg, easeTowards, haversineM, predict, type LatLon } from './interpolation';
import type { LiveVehicle, RenderableVehicle } from './liveTypes';

export type TrackedVehicle = {
  runId: string;
  data: LiveVehicle; // latest server payload (line/direction/delay/status/stops)
  server: LatLon; // latest server-reported position
  render: LatLon; // eased/dead-reckoned display position
  bearing: number; // degrees; server-provided when present, else inferred
  speedMps: number; // inferred from consecutive server fixes
  lastFixMs: number; // wall-clock ms of the latest server fix
  misses: number; // consecutive polls this run was absent from
  /**
   * False until a second fix has given the run a real speed. A single fix carries
   * no speed, so such a run would stand still for a whole poll interval and then
   * teleport the entire distance it actually travelled (measured: mean 136 m,
   * worst 694 m in one frame). Unseeded runs are tracked but not rendered.
   */
  seeded: boolean;
};

// A run absent from this many consecutive polls is despawned; one miss is
// tolerated because bbox edges flicker (§6.1).
const MAX_MISSES = 2;

// Inferred-speed bounds. The backend positions are schedule estimates, so the
// speed we derive from consecutive fixes is noisy — especially around stops,
// where a stop→depart pair produces a spurious burst. We rate-limit how fast it
// can change so a bad fix can't fling the marker forward and then jerk it back
// (concept §7). The ceiling matches predict()'s own clampSpeed cap: it used to be
// 35, which sat *below* that cap, so regional RE/MEX runs (measured up to 43.7 m/s
// ≈ 157 km/h) could never be tracked and fell behind on every poll.
const MAX_INFERRED_SPEED_MPS = 45; // ~160 km/h
const MAX_ACCEL_MPS2 = 1.4; // realistic light-rail acceleration
const MAX_BRAKE_MPS2 = 2.2; // realistic service braking

function fixTime(v: LiveVehicle, fallbackMs: number): number {
  if (v.estimatedAt) {
    const t = Date.parse(v.estimatedAt);
    if (Number.isFinite(t)) return t;
  }
  return fallbackMs;
}

export class LiveVehicleStore {
  private vehicles = new Map<string, TrackedVehicle>();

  clear(): void {
    this.vehicles.clear();
  }

  /** Renderable runs only — matches what {@link list} returns. */
  get size(): number {
    let n = 0;
    for (const v of this.vehicles.values()) if (v.seeded) n++;
    return n;
  }

  /** Every run being tracked, including ones still waiting for a second fix. */
  get trackedSize(): number {
    return this.vehicles.size;
  }

  get(runId: string): TrackedVehicle | undefined {
    return this.vehicles.get(runId);
  }

  list(): TrackedVehicle[] {
    const out: TrackedVehicle[] = [];
    for (const v of this.vehicles.values()) if (v.seeded) out.push(v);
    return out;
  }

  /**
   * Merges a *complete* snapshot: spawns new runs, updates seen ones, and
   * despawns runs that have been absent too long or completed. Only this method
   * ages/removes unseen runs — a single-run patch must never touch other runs
   * (that was a bug: the 5 s follow poll despawned the rest of the fleet, churning
   * model pools and letting the camera latch onto the wrong vehicle).
   */
  applySnapshot(incoming: RenderableVehicle[], nowMs: number = Date.now()): void {
    const seen = new Set<string>();

    for (const v of incoming) {
      seen.add(v.runId);
      this.upsert(v, nowMs);
    }

    for (const [runId, tracked] of this.vehicles) {
      if (seen.has(runId)) continue;
      tracked.misses += 1;
      if (tracked.misses >= MAX_MISSES || tracked.data.status === 'completed') {
        this.vehicles.delete(runId);
      }
    }
  }

  /**
   * Spawns or updates a single run, recomputing its inferred (smoothed) speed and
   * bearing. Never ages or removes other runs. Stale fixes — an older estimate
   * arriving after a newer one (e.g. a slow follow response overtaken by a fresh
   * snapshot) — are ignored for motion so they can't rewind the vehicle.
   */
  upsert(v: RenderableVehicle, nowMs: number = Date.now()): void {
    const server: LatLon = { lat: v.lat, lon: v.lon };
    const fixMs = fixTime(v, nowMs);
    const existing = this.vehicles.get(v.runId);

    if (!existing) {
      this.vehicles.set(v.runId, {
        runId: v.runId,
        data: v,
        server,
        render: server,
        bearing: v.bearing ?? 0,
        speedMps: 0,
        lastFixMs: fixMs,
        misses: 0,
        seeded: false
      });
      return;
    }

    // Older-or-equal estimate: refresh metadata (delay/next stop/status) but leave
    // position and inferred speed untouched so we never move backward on it.
    if (fixMs <= existing.lastFixMs) {
      existing.data = v;
      existing.misses = 0;
      return;
    }

    const dtSec = (fixMs - existing.lastFixMs) / 1000;
    const movedM = haversineM(existing.server, server);
    // Prefer the server bearing; fall back to the heading between fixes when the
    // vehicle actually moved.
    const bearing = v.bearing ?? (movedM > 2 ? bearingDeg(existing.server, server) : existing.bearing);
    existing.data = v;
    existing.server = server;
    existing.speedMps = this.inferSpeed(existing.speedMps, movedM, dtSec, v.status, existing.seeded);
    existing.bearing = bearing;
    existing.lastFixMs = fixMs;
    existing.misses = 0;
    // Second fix: the run now has a real speed, so it becomes renderable. Anchor
    // the display position to this fix (only on that transition — afterwards
    // `render` is the eased position and must not be snapped) so the run appears
    // already moving instead of popping in and teleporting one interval later.
    if (!existing.seeded) {
      existing.seeded = true;
      existing.render = server;
    }
  }

  /** Removes a single run (e.g. the follow endpoint reports it finished). */
  remove(runId: string): void {
    this.vehicles.delete(runId);
  }

  // Turns a raw fix-to-fix displacement into a stable display speed. At a stop the
  // speed is forced to zero; otherwise the measurement is capped and rate-limited
  // by plausible acceleration/braking so a noisy schedule estimate can't produce
  // the "stop → sudden lurch → snap back" the raw movedM/dt did.
  //
  // The rate limit only applies between two *known* speeds. On the first
  // measurement `prevMps` is 0 because the run had a single fix, not because it was
  // standing still, so limiting from it would starve the estimate — badly with the
  // short gaps SSE upserts produce (a 2 s gap would allow just 2.8 m/s). The cap
  // still applies, so an implausible measurement can't get through either way.
  private inferSpeed(
    prevMps: number,
    movedM: number,
    dtSec: number,
    status: LiveVehicle['status'],
    seeded: boolean
  ): number {
    if (status === 'at_stop' || status === 'not_started') return 0;
    if (dtSec <= 0) return prevMps;
    const measured = Math.max(0, Math.min(movedM / dtSec, MAX_INFERRED_SPEED_MPS));
    if (!seeded) return measured;
    const lower = Math.max(0, prevMps - MAX_BRAKE_MPS2 * dtSec);
    const upper = prevMps + MAX_ACCEL_MPS2 * dtSec;
    return Math.max(lower, Math.min(measured, upper));
  }

  /** Patches a single run from the per-run endpoint while following (§6.2). */
  patchOne(v: LiveVehicle, nowMs: number = Date.now()): void {
    if (!v.runId || typeof v.lat !== 'number' || typeof v.lon !== 'number') return;
    this.upsert(v as RenderableVehicle, nowMs);
  }

  /** Advances every vehicle's render position by `dtSec` (called each frame). */
  tick(dtSec: number, nowMs: number = Date.now()): void {
    for (const tracked of this.vehicles.values()) {
      const status = tracked.data.status;
      if (status === 'at_stop' || status === 'not_started') {
        // Hold at the stop; still ease out any residual error.
        tracked.render = easeTowards(tracked.render, tracked.server, dtSec);
        continue;
      }
      const secondsSinceFix = (nowMs - tracked.lastFixMs) / 1000;
      const target = predict(tracked.server, tracked.bearing, tracked.speedMps, secondsSinceFix);
      tracked.render = easeTowards(tracked.render, target, dtSec);
    }
  }
}
