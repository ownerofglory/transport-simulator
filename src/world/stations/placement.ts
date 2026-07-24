import * as THREE from 'three';
import type { WorldLayerContext } from '../layers/WorldLayerContext';
import type { RouteStation, StationPlacement } from './types';

/**
 * Resolves a route stop's position, orientation, and undergrounding from shared
 * route geometry. Mirrors the sampling the legacy per-guideway builders did
 * inline, so a stop lands at exactly the same place regardless of style.
 */
export function resolveStationPlacement(
  station: RouteStation,
  index: number,
  layer: WorldLayerContext
): StationPlacement {
  const t = THREE.MathUtils.clamp(station.distanceM / layer.route.routeLengthM, 0, 1);
  const center = layer.curve.getPointAt(t);
  const tangent = layer.curve.getTangentAt(t).normalize();
  const yaw = Math.atan2(tangent.x, tangent.z);
  const underground = layer.stationIsUnderground(t);
  return { station, index, t, center, tangent, yaw, underground };
}

/** Along-route parameter range covering a platform of `lengthM` centered on the stop. */
export function platformSpanT(
  distanceM: number,
  lengthM: number,
  routeLengthM: number
): { startT: number; endT: number } {
  const halfM = lengthM / 2;
  return {
    startT: THREE.MathUtils.clamp((distanceM - halfM) / routeLengthM, 0, 1),
    endT: THREE.MathUtils.clamp((distanceM + halfM) / routeLengthM, 0, 1)
  };
}
