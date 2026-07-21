// Viewport → request math (concept §5). Pure, side-effect free, and unit-tested:
// these functions decide *what area* we ask for, *which modes*, and *how often*,
// which is the core of the "don't burn traffic" requirement.

import { ALL_LIVE_MODES, RAIL_MODES, type LiveMode } from './liveTypes';

export type BBox = { latMin: number; lonMin: number; latMax: number; lonMax: number };

// Three level-of-detail tiers, driven by map zoom (the Leaflet analogue of the
// concept's camera-altitude bands).
export type Tier = 'city' | 'district' | 'street';

// Leaflet zoom thresholds. Below district → city overview; at/above street → street.
const DISTRICT_MIN_ZOOM = 12;
const STREET_MIN_ZOOM = 15;

/** Classifies a Leaflet zoom level into an LOD tier. */
export function tierForZoom(zoom: number): Tier {
  if (zoom >= STREET_MIN_ZOOM) return 'street';
  if (zoom >= DISTRICT_MIN_ZOOM) return 'district';
  return 'city';
}

/** Poll cadence per tier (§5.2): smaller viewport ⇒ fewer vehicles ⇒ poll more often. */
export function pollIntervalMs(tier: Tier): number {
  switch (tier) {
    case 'city':
      return 30_000;
    case 'district':
      return 15_000;
    case 'street':
      return 8_000;
  }
}

// Rough width of a bbox in km at its mid-latitude (1° lat ≈ 111 km).
export function bboxWidthKm(bbox: BBox): number {
  const midLat = (bbox.latMin + bbox.latMax) / 2;
  return Math.abs(bbox.lonMax - bbox.lonMin) * 111 * Math.cos((midLat * Math.PI) / 180);
}

export function bboxHeightKm(bbox: BBox): number {
  return Math.abs(bbox.latMax - bbox.latMin) * 111;
}

// Buses are only requested once the visible area is small enough that their
// count is bounded (§5.2).
const BUS_MAX_SPAN_KM = 6;

/**
 * The modes to request for a tier and area, intersected with the user's filter
 * chips (which can only ever *narrow* the automatic set).
 */
export function modesForTier(tier: Tier, bbox: BBox, userFilter?: Iterable<LiveMode>): LiveMode[] {
  let auto: LiveMode[];
  if (tier === 'street') {
    auto = [...ALL_LIVE_MODES];
  } else if (tier === 'district') {
    const compact = bboxWidthKm(bbox) < BUS_MAX_SPAN_KM && bboxHeightKm(bbox) < BUS_MAX_SPAN_KM;
    auto = compact ? [...ALL_LIVE_MODES] : [...RAIL_MODES];
  } else {
    auto = [...RAIL_MODES];
  }
  if (!userFilter) return auto;
  const allowed = new Set(userFilter);
  const narrowed = auto.filter((mode) => allowed.has(mode));
  // The API requires a non-empty modes list; if the user filtered everything out
  // of the auto set we still send the auto set (the chips gray out instead).
  return narrowed.length ? narrowed : auto;
}

/** Expands a bbox by `margin` on each side (fraction of its span). */
export function expandBBox(bbox: BBox, margin = 0.25): BBox {
  const latPad = (bbox.latMax - bbox.latMin) * margin;
  const lonPad = (bbox.lonMax - bbox.lonMin) * margin;
  return {
    latMin: bbox.latMin - latPad,
    lonMin: bbox.lonMin - lonPad,
    latMax: bbox.latMax + latPad,
    lonMax: bbox.lonMax + lonPad
  };
}

/**
 * Snaps a bbox out to a coordinate grid so small pans produce byte-identical
 * request URLs (§5.1) — cache-friendly and easy to dedupe.
 */
export function quantizeBBox(bbox: BBox, grid = 0.01): BBox {
  return {
    latMin: Math.floor(bbox.latMin / grid) * grid,
    lonMin: Math.floor(bbox.lonMin / grid) * grid,
    latMax: Math.ceil(bbox.latMax / grid) * grid,
    lonMax: Math.ceil(bbox.lonMax / grid) * grid
  };
}

/** The request bbox for a visible viewport: margin then quantize. */
export function requestBBox(visible: BBox, margin = 0.25, grid = 0.01): BBox {
  return quantizeBBox(expandBBox(visible, margin), grid);
}

/** True when `inner` lies fully inside `outer` (used for pan hysteresis §5.1). */
export function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    inner.latMin >= outer.latMin &&
    inner.lonMin >= outer.lonMin &&
    inner.latMax <= outer.latMax &&
    inner.lonMax <= outer.lonMax
  );
}

export function bboxEquals(a: BBox, b: BBox, epsilon = 1e-9): boolean {
  return (
    Math.abs(a.latMin - b.latMin) < epsilon &&
    Math.abs(a.lonMin - b.lonMin) < epsilon &&
    Math.abs(a.latMax - b.latMax) < epsilon &&
    Math.abs(a.lonMax - b.lonMax) < epsilon
  );
}
