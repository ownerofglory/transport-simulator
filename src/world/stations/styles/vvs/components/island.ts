import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation, StationCanopyStyle, StationPlatformDefinition } from '../../../types';
import { platformSpanT } from '../../../placement';
import { DEFAULT_ISLAND_WIDTH_M } from '../../../trackLayout';
import { DEFAULT_DECK_TOP_M, makeFasciaGeometry } from './platform';
import type { VvsStationMaterials } from '../VvsStationMaterials';
import type { VvsFurnitureCounts } from './furniture';

/**
 * Island stations: one deck between the two tracks, opposing trains berthing on
 * either side of it.
 *
 * The tracks are pulled apart around the stop by the world's track spread
 * profile (`world/stations/trackLayout`), which derives the throw from this same
 * platform width — a deck built here wider than the tracks were opened would
 * have trains driving through it. Everything below assumes the deck is centred
 * on the alignment and reaches `widthM / 2` to each track.
 */

const DEFAULT_LENGTH_M = 76;
const TACTILE_INSET_M = 0.62; // centre of the tactile strip, in from the deck edge
const BENCH_SLOTS = [6, -8, 18];
const BIN_SLOTS = [12, 0];

export type VvsIslandOptions = {
  widthM?: number;
  lengthM?: number;
  deckTopM?: number;
  underground?: boolean;
  canopyLengthM?: number;
  canopyStyle?: StationCanopyStyle;
  counts?: VvsFurnitureCounts;
  accent?: THREE.Material;
  displayName?: string;
};

/** Half the deck width, i.e. how far the platform edge stands off the centre line. */
export function islandHalfWidthM(platform?: Partial<Pick<StationPlatformDefinition, 'widthM'>>): number {
  return (platform?.widthM ?? DEFAULT_ISLAND_WIDTH_M) / 2;
}

/**
 * The deck itself: paving, both edge bands, both tactile strips, and a vertical
 * face down to track level on each side. World-space strips follow the route, so
 * this attaches to the untransformed station root.
 */
export function buildVvsCenterPlatform(
  root: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  station: RouteStation,
  platform: StationPlatformDefinition | undefined,
  underground = false
): void {
  const lengthM = platform?.lengthM ?? DEFAULT_LENGTH_M;
  const halfWidthM = islandHalfWidthM(platform);
  const deckTopM = platform?.heightM ?? DEFAULT_DECK_TOP_M;
  const finish = materials.surfaces(underground);
  const { startT, endT } = platformSpanT(station.distanceM, lengthM, layer.route.routeLengthM);

  const deck = new THREE.Mesh(
    layer.makeRouteStrip(0, halfWidthM * 2, startT, endT, 24, deckTopM),
    finish.platform
  );
  deck.receiveShadow = true;
  deck.name = `Island platform ${station.name}`;
  root.add(deck);

  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(
      layer.makeRouteStrip(side * (halfWidthM - 0.17), 0.35, startT, endT, 28, deckTopM + 0.005),
      finish.edge
    );
    root.add(edge);

    const tactile = new THREE.Mesh(
      layer.makeRouteStrip(side * (halfWidthM - TACTILE_INSET_M), 0.5, startT, endT, 28, deckTopM + 0.025),
      finish.tactile
    );
    tactile.name = `Island tactile edge ${station.name}`;
    root.add(tactile);

    // A high deck built from horizontal strips alone floats above the track.
    const fascia = new THREE.Mesh(makeFasciaGeometry(layer, side * halfWidthM, startT, endT, deckTopM), finish.edge);
    fascia.receiveShadow = true;
    fascia.name = `Island platform fascia ${station.name}`;
    root.add(fascia);
  }
}

/**
 * Everything standing on an island deck. `deck` is the raised fittings group, so
 * positions here are relative to the platform surface the same way the side
 * platform components are.
 */
export function buildVvsIslandFittings(
  deck: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  station: RouteStation,
  options: VvsIslandOptions = {}
): void {
  const halfWidthM = islandHalfWidthM({ widthM: options.widthM });
  const counts = options.counts ?? { benches: 1, ticketMachines: 1, bins: 1 };
  const accent = options.accent ?? materials.ssbBlue;

  if (!options.underground) {
    buildIslandCanopy(deck, materials, halfWidthM, options.canopyLengthM ?? 25, options.canopyStyle, accent);
  }

  // Back-to-back benches down the centre line, clear of both platform edges.
  for (const z of BENCH_SLOTS.slice(0, Math.max(1, Math.min(counts.benches, BENCH_SLOTS.length)))) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.48, 3.6), materials.bench);
    bench.position.set(0, 0.46, z);
    bench.castShadow = true;
    deck.add(bench);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.0, 3.6), materials.bench);
    backrest.position.set(0, 0.88, z);
    deck.add(backrest);
  }

  for (const z of BIN_SLOTS.slice(0, Math.max(1, Math.min(counts.bins, BIN_SLOTS.length)))) {
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 12), materials.ssbBlue);
    bin.position.set(0.9, 0.48, z);
    deck.add(bin);
  }

  for (let i = 0; i < Math.max(1, Math.min(counts.ticketMachines, 2)); i += 1) {
    const machine = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.9, 0.72), materials.machine);
    machine.position.set(i === 0 ? -0.9 : 0.9, 0.96, i === 0 ? -13 : 13);
    machine.castShadow = true;
    deck.add(machine);
  }

  buildIslandSigns(deck, layer, station, halfWidthM, options);
}

/** Name signs on both edges of the deck, each facing the train it belongs to. */
function buildIslandSigns(
  deck: THREE.Group,
  layer: WorldLayerContext,
  station: RouteStation,
  halfWidthM: number,
  options: VvsIslandOptions
): void {
  const texture = makeLabelTexture(`${layer.route.line}  ${options.displayName ?? station.name}`, {
    width: 1024,
    height: 180,
    bg: '#174a73',
    fg: '#ffffff'
  });
  const height = options.underground ? 3.1 : 2.6;

  for (const z of [-21, 21]) {
    for (const side of [-1, 1]) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(7.4, 1.3),
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide })
      );
      // Just inboard of the platform edge, reading outward across the track.
      sign.position.set(side * (halfWidthM - 0.5), height, z);
      sign.rotation.y = (side * Math.PI) / 2;
      deck.add(sign);
      layer.stationMarkers.push(sign);
    }
  }
}

/**
 * Central canopy over an island: a single spine of posts down the middle of the
 * deck carrying a roof that oversails both platform edges.
 */
function buildIslandCanopy(
  deck: THREE.Group,
  materials: VvsStationMaterials,
  halfWidthM: number,
  lengthM: number,
  style: StationCanopyStyle | undefined,
  accent: THREE.Material
): void {
  if (lengthM <= 0) return;
  const widthM = Math.max(3.2, halfWidthM * 2 - 1.2);
  const half = lengthM / 2;
  const center = 0;
  const roofY = 3.9;

  if (style === 'curved-shell') {
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(widthM / 2, widthM / 2, lengthM, 20, 1, true, Math.PI, Math.PI),
      materials.glass
    );
    shell.position.set(0, roofY - 0.35, center);
    shell.rotation.z = Math.PI / 2;
    shell.rotation.y = Math.PI / 2;
    deck.add(shell);
  }

  const roof = new THREE.Mesh(new THREE.BoxGeometry(widthM, 0.24, lengthM), materials.canopy);
  roof.position.set(0, roofY, center);
  roof.castShadow = true;
  deck.add(roof);

  // Butterfly roofs fall away from the spine to both edges; the flat slab keeps
  // its two fasciae level.
  for (const edge of [-1, 1]) {
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, lengthM + 0.2), accent);
    fascia.position.set((edge * widthM) / 2, roofY - 0.13 - (style === 'butterfly' ? 0.35 : 0), center);
    deck.add(fascia);
  }
  if (style === 'butterfly') {
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, lengthM + 0.2), accent);
    spine.position.set(0, roofY + 0.28, center);
    deck.add(spine);
  }

  for (const z of [center - half + 2, center, center + half - 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, roofY - 0.12, 0.2), accent);
    post.position.set(0, (roofY - 0.12) / 2, z);
    post.castShadow = true;
    deck.add(post);

    for (const edge of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 5.5), materials.light);
      lamp.position.set((edge * widthM) / 3, roofY - 0.17, z);
      deck.add(lamp);
    }
  }
}
