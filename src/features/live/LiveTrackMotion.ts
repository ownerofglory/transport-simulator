import type { Projection } from './liveProjection';
import type { TrackedVehicle } from './LiveVehicleStore';
import type { LiveTunnelIndex } from './LiveTunnelIndex';

// Along-track motion for matched rail vehicles (concept §7 "along-track dead
// reckoning"). Instead of straight-line extrapolation — which drifts off curved
// track between polls and then snaps/jumps (sometimes backward) on the next
// response — each vehicle is projected onto its route polyline and advanced ALONG
// it at the inferred speed. Corrections on a new fix are forward-biased, so the
// vehicle stays on the rails and glides instead of teleporting.

const DEG = Math.PI / 180;
// Beyond this lateral distance the vehicle clearly isn't on this alignment, so we
// fall back to the raw server position rather than snapping to the wrong track.
const MAX_LATERAL_M = 45;
// Along-track error above which we hard-snap (e.g. a run that was off-screen, or a
// confirmed re-acquisition). Below it we correct with speed, never by moving the
// position — a followed vehicle makes even a small backward jump very visible.
const SNAP_ERR_M = 250;
const MAX_SPEED_MPS = 45;
// A behind-schedule vehicle is caught up by adding at most this much to its
// display speed, spread over the correction horizon; ahead-of-schedule it slows
// (down to a pause) but never reverses.
const MAX_CATCH_UP_MPS = 6;
const CORRECTION_HORIZON_S = 4;

type Geom = { xs: Float64Array; zs: Float64Array; cum: Float64Array; total: number };
// `corrMps` is the current along-track speed correction (+ catch up, − ease off),
// recomputed on each server fix and held until the next one.
type State = { s: number; lastFixMs: number; seg: number; dir: 1 | -1; serverS: number; corrMps: number };
type Resolved = { lat: number; lon: number; bearing: number };

export class LiveTrackMotion {
  private readonly geoms = new Map<string, Geom>(); // by route id
  private readonly states = new Map<string, State>(); // by runId
  private readonly out = new Map<string, Resolved>(); // by runId
  private readonly runGeom = new Map<string, Geom>(); // by runId — for offset queries

  constructor(
    private readonly projection: Projection,
    private readonly index: LiveTunnelIndex
  ) {}

  /** Advances every matched vehicle along its route; call once per frame. */
  tick(vehicles: TrackedVehicle[], dtSec: number): void {
    const seen = new Set<string>();
    for (const v of vehicles) {
      const route = this.index.routeFor(v);
      if (!route?.geoPoints || route.geoPoints.length < 2) continue;
      const geom = this.geomFor(route.id, route.geoPoints);
      const resolved = this.advance(v, geom, dtSec);
      if (resolved) {
        this.out.set(v.runId, resolved);
        this.runGeom.set(v.runId, geom);
        seen.add(v.runId);
      }
    }
    for (const id of [...this.out.keys()]) {
      if (!seen.has(id)) {
        this.out.delete(id);
        this.states.delete(id);
        this.runGeom.delete(id);
      }
    }
  }

  /** Snapped position + track-aligned bearing for a run, if it is on a route. */
  positionOf(runId: string): Resolved | undefined {
    return this.out.get(runId);
  }

  /**
   * World-space pose (projected x/z + bearing) at `offsetM` along the run's track
   * from its current position — positive ahead, negative behind travel. Used to
   * articulate a model's cars so the train bends through curves. Returns null when
   * the run isn't currently matched to a route.
   */
  offsetPoseOf(runId: string, offsetM: number): { x: number; z: number; bearing: number } | null {
    const st = this.states.get(runId);
    const geom = this.runGeom.get(runId);
    if (!st || !geom) return null;
    const s = Math.max(0, Math.min(st.s + st.dir * offsetM, geom.total));
    return this.pointAtWorld(geom, s, st.dir);
  }

  private advance(v: TrackedVehicle, geom: Geom, dtSec: number): Resolved | null {
    const server = this.projection.project(v.server.lat, v.server.lon);
    let st = this.states.get(v.runId);
    const near = this.project(geom, server.x, server.z, st?.seg ?? -1);
    if (near.lateral > MAX_LATERAL_M) {
      this.states.delete(v.runId);
      return null;
    }
    if (!st) {
      st = { s: near.s, lastFixMs: v.lastFixMs, seg: near.seg, dir: 1, serverS: near.s, corrMps: 0 };
      this.states.set(v.runId, st);
    }
    st.seg = near.seg;

    // On a fresh server fix: infer travel direction from how the projected
    // along-track distance progressed (the matched shape may run either way),
    // then decide how to reconcile with the server position. Large errors hard-snap
    // (off-screen run, re-acquisition); ordinary errors are corrected by nudging
    // the *display speed* toward closing the gap over CORRECTION_HORIZON_S — the
    // vehicle speeds up when behind and eases off when ahead, but never reverses.
    if (v.lastFixMs !== st.lastFixMs) {
      st.lastFixMs = v.lastFixMs;
      const progressed = near.s - st.serverS;
      if (Math.abs(progressed) > 1) st.dir = progressed > 0 ? 1 : -1;
      st.serverS = near.s;
      const err = near.s - st.s;
      if (Math.abs(err) > SNAP_ERR_M) {
        st.s = near.s;
        st.corrMps = 0;
      } else {
        // Signed along the travel direction: positive => client is behind.
        const behind = st.dir * err;
        const base = Math.max(0, Math.min(v.speedMps, MAX_SPEED_MPS));
        st.corrMps = Math.max(-base, Math.min(behind / CORRECTION_HORIZON_S, MAX_CATCH_UP_MPS));
      }
    }

    const base = Math.max(0, Math.min(v.speedMps, MAX_SPEED_MPS));
    const displayMps = Math.max(0, base + st.corrMps);
    st.s += st.dir * displayMps * dtSec;
    st.s = Math.max(0, Math.min(st.s, geom.total));
    return this.pointAt(geom, st.s, st.dir);
  }

  private geomFor(id: string, geoPoints: [number, number][]): Geom {
    const cached = this.geoms.get(id);
    if (cached) return cached;
    const n = geoPoints.length;
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    const cum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.projection.project(geoPoints[i][0], geoPoints[i][1]);
      xs[i] = p.x;
      zs[i] = p.z;
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    }
    const geom: Geom = { xs, zs, cum, total: cum[n - 1] };
    this.geoms.set(id, geom);
    return geom;
  }

  // Nearest point on the polyline to (x,z): along-track distance, lateral offset,
  // and segment index. Searches near the cached segment first for speed.
  private project(geom: Geom, x: number, z: number, hintSeg: number): { s: number; lateral: number; seg: number } {
    const { xs, zs, cum } = geom;
    const n = xs.length;
    let best = { s: 0, lateral: Infinity, seg: 0 };
    const consider = (i: number) => {
      const ax = xs[i];
      const az = zs[i];
      const vx = xs[i + 1] - ax;
      const vz = zs[i + 1] - az;
      const l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const lateral = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
      if (lateral < best.lateral) best = { s: cum[i] + Math.sqrt(l2) * t, lateral, seg: i };
    };
    if (hintSeg >= 0) {
      for (let i = Math.max(0, hintSeg - 8); i <= Math.min(n - 2, hintSeg + 8); i++) consider(i);
      if (best.lateral <= MAX_LATERAL_M) return best;
    }
    best = { s: 0, lateral: Infinity, seg: 0 };
    for (let i = 0; i < n - 1; i++) consider(i);
    return best;
  }

  private pointAt(geom: Geom, s: number, dir: 1 | -1): Resolved {
    const { x, z, bearing } = this.pointAtWorld(geom, s, dir);
    const { lat, lon } = this.projection.unproject(x, z);
    return { lat, lon, bearing };
  }

  // Projected world x/z and track-aligned bearing at along-track distance `s`.
  private pointAtWorld(geom: Geom, s: number, dir: 1 | -1): { x: number; z: number; bearing: number } {
    const { xs, zs, cum } = geom;
    const n = xs.length;
    let lo = 0;
    let hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const segLen = cum[lo + 1] - cum[lo] || 1;
    const t = (s - cum[lo]) / segLen;
    const dx = xs[lo + 1] - xs[lo];
    const dz = zs[lo + 1] - zs[lo];
    // Bearing that matches the model rotation convention (rotate.y = -bearing):
    // world forward (dx,dz) corresponds to (-sinβ, cosβ), so β = atan2(-dx, dz).
    // Flip 180° when the vehicle runs against the polyline's stored direction.
    const bearing = ((Math.atan2(-dx * dir, dz * dir) / DEG) + 360) % 360;
    return { x: xs[lo] + dx * t, z: zs[lo] + dz * t, bearing };
  }
}
