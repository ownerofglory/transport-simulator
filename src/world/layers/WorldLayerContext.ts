import type * as THREE from 'three';
import type { DemoRoute } from '../../route';
import type { GuidewayKind } from '../../domain/transport';
import type { GeoPoint } from '../../landmarks';

/**
 * Shared route geometry, sampling, and scene access that the scene layers need.
 * TransitWorld owns the underlying curve/terrain helpers and exposes them here
 * so each layer can build its meshes without re-deriving route geometry.
 */
export type WorldLayerContext = {
  // The raw scene is intentionally not exposed; each layer owns a root group.
  curve: THREE.CatmullRomCurve3;
  route: DemoRoute;
  guidewayKind: GuidewayKind;
  // Station style provider id for the active mode; undefined uses the legacy
  // per-guideway station builders.
  stationStyleId?: string;
  activeLaneOffsetM: number;
  oppositeLaneOffsetM: number;
  railGaugeM: number;
  // Route-following billboards/signs collected so they can be batch-managed.
  stationMarkers: THREE.Object3D[];

  stationIsUnderground(t: number): boolean;
  normalAt(t: number): THREE.Vector3;
  // A track's lateral offset at t. Equals the base offset everywhere except
  // where the tracks part around an island platform.
  laneOffsetAtT(t: number, baseOffsetM: number): number;
  offsetCurvePoints(offsetM: number, segments: number, heightM: number): THREE.Vector3[];
  offsetCurvePointsAt(offsetAt: (t: number) => number, segments: number, heightM: number): THREE.Vector3[];
  surfaceHeightAt(t: number): number;
  makeRouteStrip(offsetM: number, widthM: number, startT: number, endT: number, segments: number, heightM: number): THREE.BufferGeometry;
  makeTrackStrip(offsetM: number, widthM: number, segments: number): THREE.BufferGeometry;
  maskRanges(mask: boolean[]): [number, number][];
  routeBounds(): { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3; size: THREE.Vector3 };
  routeGeoPoints(): GeoPoint[];
  updateArticulatedVehicle(root: THREE.Group, cars: THREE.Group[], distanceM: number, direction: 1 | -1, trackOffsetM: number): void;
  wrapDistance(distanceM: number): number;
};
