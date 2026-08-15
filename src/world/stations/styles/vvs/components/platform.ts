import * as THREE from 'three';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation, StationPlatformDefinition } from '../../../types';
import { platformSpanT } from '../../../placement';
import type { VvsStationMaterials } from '../VvsStationMaterials';

// Curved side platforms follow the route via world-space strips, so they attach
// to the untransformed station root. Defaults match the legacy rail builder;
// platform length/width come from topology data (never seeded).
const DEFAULT_WIDTH_M = 8;
const DEFAULT_LENGTH_M = 76; // legacy halfLengthM = 38 → 76m platform
const INNER_EDGE_M = 3.4; // track-side platform edge; kept constant as width grows
const TACTILE_OFFSET_M = 3.72; // tactile strip hugs the track edge regardless of width

/** Lateral center offset of a side platform of the given width. widthM=8 → 7.4 (legacy). */
export function sidePlatformOffset(widthM = DEFAULT_WIDTH_M): number {
  return INNER_EDGE_M + widthM / 2;
}

export function buildVvsSidePlatforms(
  root: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  station: RouteStation,
  platform?: StationPlatformDefinition,
  staggerM = 0,
  underground = false
): void {
  const lengthM = platform?.lengthM ?? DEFAULT_LENGTH_M;
  const widthM = platform?.widthM ?? DEFAULT_WIDTH_M;
  const offset = sidePlatformOffset(widthM);
  const finish = materials.surfaces(underground);

  for (const side of [-1, 1]) {
    // Staggered stops shift one platform ahead of the other along the route.
    const centerM = station.distanceM + side * (staggerM / 2);
    const { startT, endT } = platformSpanT(centerM, lengthM, layer.route.routeLengthM);

    const platformEdge = new THREE.Mesh(
      layer.makeRouteStrip(side * offset, widthM + 0.25, startT, endT, 28, 0.12),
      finish.edge
    );
    platformEdge.receiveShadow = true;
    root.add(platformEdge);

    const deck = new THREE.Mesh(
      layer.makeRouteStrip(side * offset, widthM, startT, endT, 24, 0.22),
      finish.platform
    );
    deck.receiveShadow = true;
    deck.name = `Curved platform ${station.name}`;
    root.add(deck);

    const tactile = new THREE.Mesh(
      layer.makeRouteStrip(side * TACTILE_OFFSET_M, 0.72, startT, endT, 28, 0.245),
      finish.tactile
    );
    tactile.name = `Tactile platform edge ${station.name}`;
    root.add(tactile);
  }
}
