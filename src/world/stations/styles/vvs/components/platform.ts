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
// Deck top above rail level. 0.22 is the low tram kerb the legacy builder used
// and stays the default for street-running networks; Stuttgart's Stadtbahn runs
// 0.8 m high platforms throughout, for level boarding.
export const DEFAULT_DECK_TOP_M = 0.22;

// Below this the deck is a kerb and a flat edge strip reads fine; above it the
// platform is a raised structure and needs a face, or it floats over the track.
const FASCIA_THRESHOLD_M = 0.35;

/** Lateral center offset of a side platform of the given width. widthM=8 → 7.4 (legacy). */
export function sidePlatformOffset(widthM = DEFAULT_WIDTH_M): number {
  return INNER_EDGE_M + widthM / 2;
}

/**
 * Vertical face running under a platform edge, following the alignment.
 *
 * `makeRouteStrip` only produces horizontal ribbons, so a high platform built
 * from strips alone is a slab hanging in mid-air. Triangles are emitted in both
 * windings so the face is solid from the track and from behind without needing
 * a double-sided material.
 */
function makeFasciaGeometry(
  layer: WorldLayerContext,
  offsetM: number,
  startT: number,
  endT: number,
  topM: number,
  segments = 24
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i <= segments; i += 1) {
    const t = startT + ((endT - startT) * i) / segments;
    point.copy(layer.curve.getPointAt(t));
    normal.copy(layer.normalAt(t));
    const x = point.x + normal.x * offsetM;
    const z = point.z + normal.z * offsetM;
    positions.push(x, point.y + topM, z, x, point.y - 0.05, z);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d, b, c, a, d, c, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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
  // The deck's own height, previously hard-coded at the legacy tram kerb even
  // though the config carried it.
  const deckTopM = platform?.heightM ?? DEFAULT_DECK_TOP_M;

  for (const side of [-1, 1]) {
    // Staggered stops shift one platform ahead of the other along the route.
    const centerM = station.distanceM + side * (staggerM / 2);
    const { startT, endT } = platformSpanT(centerM, lengthM, layer.route.routeLengthM);

    // The fascia is a slightly wider strip just below the deck, so a high
    // platform reads as a solid edge wall rather than a floating slab.
    const platformEdge = new THREE.Mesh(
      layer.makeRouteStrip(side * offset, widthM + 0.25, startT, endT, 28, deckTopM - 0.1),
      finish.edge
    );
    platformEdge.receiveShadow = true;
    root.add(platformEdge);

    const deck = new THREE.Mesh(
      layer.makeRouteStrip(side * offset, widthM, startT, endT, 24, deckTopM),
      finish.platform
    );
    deck.receiveShadow = true;
    deck.name = `Curved platform ${station.name}`;
    root.add(deck);

    const tactile = new THREE.Mesh(
      layer.makeRouteStrip(side * TACTILE_OFFSET_M, 0.72, startT, endT, 28, deckTopM + 0.025),
      finish.tactile
    );
    tactile.name = `Tactile platform edge ${station.name}`;
    root.add(tactile);

    if (deckTopM > FASCIA_THRESHOLD_M) {
      // Track face and outer face, so the deck reads as a solid structure.
      for (const [faceOffset, faceSide] of [
        [INNER_EDGE_M, side],
        [offset + widthM / 2, side]
      ] as const) {
        const fascia = new THREE.Mesh(
          makeFasciaGeometry(layer, faceSide * faceOffset, startT, endT, deckTopM),
          finish.edge
        );
        fascia.receiveShadow = true;
        fascia.name = `Platform fascia ${station.name}`;
        root.add(fascia);
      }
    }
  }
}
