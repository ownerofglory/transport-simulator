import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation, StationPlatformDefinition } from '../../../types';
import { platformSpanT } from '../../../placement';
import type { VvsStationMaterials } from '../VvsStationMaterials';
import type { VvsFurnitureCounts } from './furniture';

// A central island platform sits between the two fixed tracks (±2.1m), so it is
// narrow with edges facing outward on both sides. Track geometry is owned by
// the guideway layer and is never moved here.
const ISLAND_HALF_WIDTH_M = 1.7;
const DEFAULT_LENGTH_M = 76;
const BENCH_SLOTS = [6, -8, 18];
const BIN_SLOTS = [12, 0];

/**
 * Surface island-platform station: one central platform, a central canopy, and
 * track-facing signage on both edges. Platform strips follow the route in world
 * space (attach to `root`); canopy, furniture, and signs attach to `local`.
 */
export function buildVvsIslandStation(
  root: THREE.Group,
  local: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  station: RouteStation,
  platform: StationPlatformDefinition | undefined,
  canopyLengthM: number,
  counts: VvsFurnitureCounts
): void {
  const lengthM = platform?.lengthM ?? DEFAULT_LENGTH_M;
  const { startT, endT } = platformSpanT(station.distanceM, lengthM, layer.route.routeLengthM);

  const deck = new THREE.Mesh(
    layer.makeRouteStrip(0, ISLAND_HALF_WIDTH_M * 2, startT, endT, 24, 0.22),
    materials.platform
  );
  deck.receiveShadow = true;
  deck.name = `Island platform ${station.name}`;
  root.add(deck);

  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(
      layer.makeRouteStrip(side * (ISLAND_HALF_WIDTH_M - 0.1), 0.35, startT, endT, 28, 0.245),
      materials.platformEdge
    );
    root.add(edge);
    const tactile = new THREE.Mesh(
      layer.makeRouteStrip(side * (ISLAND_HALF_WIDTH_M - 0.45), 0.5, startT, endT, 28, 0.25),
      materials.tactile
    );
    tactile.name = `Island tactile edge ${station.name}`;
    root.add(tactile);
  }

  // Central canopy: single ridge roof over the platform with a row of posts.
  const center = 8;
  const half = canopyLengthM / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.24, canopyLengthM), materials.canopy);
  roof.position.set(0, 4.35, center);
  roof.castShadow = true;
  local.add(roof);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, canopyLengthM + 0.2), materials.ssbBlue);
  ridge.position.set(0, 4.5, center);
  local.add(ridge);
  for (const z of [center - half + 2, center, center + half - 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.2, 0.18), materials.ssbBlue);
    post.position.set(0, 2.1, z);
    post.castShadow = true;
    local.add(post);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.22), materials.light);
    lamp.position.set(0, 4.15, z);
    local.add(lamp);
  }

  // Back-to-back central benches and bins.
  for (const z of BENCH_SLOTS.slice(0, Math.max(1, Math.min(counts.benches, BENCH_SLOTS.length)))) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.48, 3.6), materials.bench);
    bench.position.set(0, 0.78, z);
    bench.castShadow = true;
    local.add(bench);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.0, 3.6), materials.bench);
    backrest.position.set(0, 1.2, z);
    local.add(backrest);
  }
  for (const z of BIN_SLOTS.slice(0, Math.max(1, Math.min(counts.bins, BIN_SLOTS.length)))) {
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 12), materials.ssbBlue);
    bin.position.set(0, 0.7, z);
    local.add(bin);
  }

  // Central ticket machine facing along the platform.
  const machine = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.9, 0.72), materials.machine);
  machine.position.set(0, 1.18, -13);
  machine.castShadow = true;
  local.add(machine);

  // Track-facing name signs on a central mast (both directions).
  const signTexture = makeLabelTexture(`${layer.route.line}  ${station.name}`, {
    width: 1024,
    height: 180,
    bg: '#174a73',
    fg: '#ffffff'
  });
  for (const z of [-21, 21]) {
    for (const side of [-1, 1]) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(7.4, 1.3),
        new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.FrontSide })
      );
      sign.position.set(side * 1.75, 3.2, z);
      sign.rotation.y = (side * Math.PI) / 2;
      local.add(sign);
      layer.stationMarkers.push(sign);
    }
  }
}
