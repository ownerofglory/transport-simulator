// App-facing vocabulary over the generated live-traffic OpenAPI contracts.
//
// The wire types in ../realtime/generated/api-types.ts are the source of truth —
// regenerate with `npm run gen:api` after the backend spec changes. The live
// feature mirrors the realtime feature's convention of re-exporting the wire
// types under nicer names and tightening the few fields the UI relies on.

import type {
  LiveVehicle as WireLiveVehicle,
  VehicleSnapshot as WireVehicleSnapshot,
  LiveTrafficStatus as WireLiveTrafficStatus,
  LivetrafficVehicleMode,
  LivetrafficVehicleStatus,
  LivetrafficPositionSource,
  LivetrafficConfidence
} from '../realtime/generated/api-types';

export type {
  LivetrafficVehicleMode as LiveMode,
  LivetrafficVehicleStatus as VehicleStatus,
  LivetrafficPositionSource as PositionSource,
  LivetrafficConfidence as Confidence
} from '../realtime/generated/api-types';

export type LiveTrafficStatus = WireLiveTrafficStatus;
export type VehicleSnapshot = WireVehicleSnapshot;
export type LiveVehicle = WireLiveVehicle;

/** Every live mode the backend can report, in overview-priority order. */
export const ALL_LIVE_MODES: LivetrafficVehicleMode[] = ['light-rail', 'tram', 's-bahn', 'rail', 'bus'];

/** Rail skeleton shown at overview zoom (buses omitted — invisible at that height). */
export const RAIL_MODES: LivetrafficVehicleMode[] = ['s-bahn', 'rail', 'light-rail', 'tram'];

/**
 * A vehicle the UI can actually render: it always carries an id and a position.
 * The client drops snapshot entries missing these before they reach components.
 */
export type RenderableVehicle = WireLiveVehicle &
  Required<Pick<WireLiveVehicle, 'runId' | 'lat' | 'lon'>>;

export function isRenderable(v: WireLiveVehicle): v is RenderableVehicle {
  return !!v.runId && typeof v.lat === 'number' && typeof v.lon === 'number';
}

// Mode → CSS color, aligned with the transport palette used elsewhere in the app
// (SSB yellow for Stadtbahn/tram, DB green for S-Bahn, red for bus).
const MODE_COLORS: Record<LivetrafficVehicleMode, string> = {
  'light-rail': '#00b8d4',
  tram: '#ffd800',
  's-bahn': '#37a935',
  rail: '#8a6cff',
  bus: '#e0202b'
};

export function modeColor(mode: LivetrafficVehicleMode | undefined): string {
  return (mode && MODE_COLORS[mode]) || '#9aa7b4';
}

export function modeLabel(mode: LivetrafficVehicleMode | undefined): string {
  switch (mode) {
    case 'light-rail':
      return 'Stadtbahn';
    case 'tram':
      return 'Tram';
    case 's-bahn':
      return 'S-Bahn';
    case 'rail':
      return 'Rail';
    case 'bus':
      return 'Bus';
    default:
      return 'Vehicle';
  }
}

/** Delay severity for badge coloring (on time / amber / red per concept §2.3). */
export type DelayLevel = 'unknown' | 'on-time' | 'minor' | 'major';

/**
 * Whether a snapshot's `delaySeconds` is an observation at all.
 *
 * While the backend reports `positionModel: "schedule"` it has no realtime delay
 * input, and the `delaySeconds: 0` it sends is the schedule estimator's zero-value
 * — not a confirmed on-time run. Rendering that as a green "on time" states
 * something the backend never asserted, so it is surfaced as unknown instead.
 *
 * The gate is the snapshot-level model rather than a vehicle's `source`: once
 * delay integration lands, a vehicle may legitimately be schedule-*positioned*
 * while its delay is TRIAS-*observed*, and that must still show through.
 */
export function delayObservedFor(positionModel: string | null | undefined): boolean {
  return positionModel != null && positionModel !== 'schedule';
}

export function delayLevel(delaySeconds: number | undefined, observed = true): DelayLevel {
  if (!observed || delaySeconds == null) return 'unknown';
  if (delaySeconds > 300) return 'major';
  if (delaySeconds >= 120) return 'minor';
  return 'on-time';
}

export type { LivetrafficVehicleStatus, LivetrafficPositionSource, LivetrafficConfidence };
