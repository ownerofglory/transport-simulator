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
};

// A run absent from this many consecutive polls is despawned; one miss is
// tolerated because bbox edges flicker (§6.1).
const MAX_MISSES = 2;

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

  get size(): number {
    return this.vehicles.size;
  }

  get(runId: string): TrackedVehicle | undefined {
    return this.vehicles.get(runId);
  }

  list(): TrackedVehicle[] {
    return [...this.vehicles.values()];
  }

  /**
   * Merges a snapshot: spawns new runs, updates seen ones (recomputing inferred
   * speed/bearing), and despawns runs that have been absent too long or completed.
   */
  applySnapshot(incoming: RenderableVehicle[], nowMs: number = Date.now()): void {
    const seen = new Set<string>();

    for (const v of incoming) {
      seen.add(v.runId);
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
          misses: 0
        });
        continue;
      }

      const dtSec = Math.max(0.001, (fixMs - existing.lastFixMs) / 1000);
      const movedM = haversineM(existing.server, server);
      // Prefer the server bearing; fall back to the heading between fixes when
      // the vehicle actually moved.
      const bearing = v.bearing ?? (movedM > 2 ? bearingDeg(existing.server, server) : existing.bearing);
      existing.data = v;
      existing.server = server;
      existing.speedMps = movedM / dtSec;
      existing.bearing = bearing;
      existing.lastFixMs = fixMs;
      existing.misses = 0;
      // A large jump means our render lagged badly — snap on the next tick.
    }

    for (const [runId, tracked] of this.vehicles) {
      if (seen.has(runId)) continue;
      tracked.misses += 1;
      if (tracked.misses >= MAX_MISSES || tracked.data.status === 'completed') {
        this.vehicles.delete(runId);
      }
    }
  }

  /** Patches a single run from the per-run endpoint while following (§6.2). */
  patchOne(v: LiveVehicle, nowMs: number = Date.now()): void {
    if (!v.runId || typeof v.lat !== 'number' || typeof v.lon !== 'number') return;
    this.applySnapshot([v as RenderableVehicle], nowMs);
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
