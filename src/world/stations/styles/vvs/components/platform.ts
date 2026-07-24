import * as THREE from 'three';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation } from '../../../types';
import { platformSpanT } from '../../../placement';
import type { VvsStationMaterials } from '../VvsStationMaterials';

// Curved side platforms follow the route via world-space strips, so they attach
// to the untransformed station root. Dimensions match the legacy rail builder.
const PLATFORM_LENGTH_M = 76; // legacy halfLengthM = 38 → 76m platform
const PLATFORM_OFFSET_M = 7.4;

export function buildVvsSidePlatforms(
  root: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  station: RouteStation
): void {
  const { startT, endT } = platformSpanT(station.distanceM, PLATFORM_LENGTH_M, layer.route.routeLengthM);

  for (const side of [-1, 1]) {
    const platformEdge = new THREE.Mesh(
      layer.makeRouteStrip(side * PLATFORM_OFFSET_M, 8.25, startT, endT, 28, 0.12),
      materials.platformEdge
    );
    platformEdge.receiveShadow = true;
    root.add(platformEdge);

    const platform = new THREE.Mesh(
      layer.makeRouteStrip(side * PLATFORM_OFFSET_M, 8, startT, endT, 24, 0.22),
      materials.platform
    );
    platform.receiveShadow = true;
    platform.name = `Curved platform ${station.name}`;
    root.add(platform);

    const tactile = new THREE.Mesh(
      layer.makeRouteStrip(side * 3.72, 0.72, startT, endT, 28, 0.245),
      materials.tactile
    );
    tactile.name = `Tactile platform edge ${station.name}`;
    root.add(tactile);
  }
}
