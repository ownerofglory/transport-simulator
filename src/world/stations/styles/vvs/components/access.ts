import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { StationAccessDefinition } from '../../../types';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Stairs, escalators, and lifts leaving an underground platform.
 *
 * `access` has been part of the station config since the procedural/config split
 * but nothing built it, so every box was a sealed room. Each structure rises
 * from the platform into a capped shaft: the hall ceiling is a solid slab, so a
 * run that simply stopped at the soffit would read as a dead end, and an open
 * hole would show the void above the box.
 *
 * Positions are authored (`offsetM` along the route, `side` of the box), never
 * seeded — where you can leave a station is infrastructure, not decoration.
 */

const PLATFORM_TOP_M = 0.22;
const RUN_WIDTH_M = 2.4;
const DEFAULT_LATERAL_M = 9.4; // against the back of a side platform

export type VvsAccessOptions = {
  ceilingHeightM: number;
  lateralM?: number;
};

export function buildVvsAccess(
  local: THREE.Group,
  materials: VvsStationMaterials,
  access: readonly StationAccessDefinition[],
  options: VvsAccessOptions
): void {
  for (const entry of access) {
    if (entry.type === 'crossing') continue; // a surface feature, not a shaft
    const side = entry.side === 'right' ? 1 : entry.side === 'left' ? -1 : 0;
    const x = side * (options.lateralM ?? DEFAULT_LATERAL_M);
    if (entry.type === 'lift') buildLift(local, materials, x, entry.offsetM, options.ceilingHeightM);
    else buildRun(local, materials, entry, x, side, options.ceilingHeightM);
  }
}

/** A stair or escalator flight from platform level up through the soffit. */
function buildRun(
  local: THREE.Group,
  materials: VvsStationMaterials,
  entry: StationAccessDefinition,
  x: number,
  side: number,
  ceilingHeightM: number
): void {
  const widthM = entry.widthM ?? (entry.type === 'escalator' ? RUN_WIDTH_M * 2 : RUN_WIDTH_M);
  const riseM = ceilingHeightM + 1.4; // continues past the soffit into the shaft
  const runM = riseM / Math.tan(THREE.MathUtils.degToRad(30));
  const pitch = Math.atan2(riseM, runM);
  const slopeM = Math.hypot(riseM, runM);
  const centerZ = entry.offsetM + runM / 2;

  const deckMaterial = entry.type === 'escalator' ? materials.treads : materials.platform;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(widthM, 0.3, slopeM), deckMaterial);
  deck.position.set(x, PLATFORM_TOP_M + riseM / 2, centerZ);
  deck.rotation.x = -pitch;
  deck.castShadow = true;
  local.add(deck);

  // Balustrades either side of the run; stainless on escalators, the same on
  // stairs since Stuttgart's boxes use steel handrails throughout.
  for (const edge of [-1, 1]) {
    const balustrade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, slopeM), materials.steel);
    balustrade.position.set(x + (edge * widthM) / 2, PLATFORM_TOP_M + riseM / 2 + 0.62, centerZ);
    balustrade.rotation.x = -pitch;
    local.add(balustrade);
  }

  buildShaft(local, materials, x, centerZ + runM / 2 - 1.4, widthM + 1.2, 4.4, ceilingHeightM);
  if (entry.direction) buildExitSign(local, entry.direction, x, side, entry.offsetM - 2, ceilingHeightM);
}

/** Glazed lift box standing on the platform and passing through the soffit. */
function buildLift(
  local: THREE.Group,
  materials: VvsStationMaterials,
  x: number,
  offsetM: number,
  ceilingHeightM: number
): void {
  const heightM = ceilingHeightM - 0.1;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.2, heightM, 2.4), materials.glass);
  shaft.position.set(x, PLATFORM_TOP_M + heightM / 2, offsetM);
  local.add(shaft);

  for (const edge of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, heightM, 0.14), materials.steel);
    post.position.set(x + edge * 1.1, PLATFORM_TOP_M + heightM / 2, offsetM + 1.2);
    local.add(post);
  }

  buildShaft(local, materials, x, offsetM, 2.6, 2.8, ceilingHeightM);
}

/**
 * Capped box above the ceiling that a run disappears into. Closed at the top so
 * the opening never shows the void (or sky) above the station box.
 */
function buildShaft(
  local: THREE.Group,
  materials: VvsStationMaterials,
  x: number,
  z: number,
  widthM: number,
  lengthM: number,
  ceilingHeightM: number
): void {
  const heightM = 3.2;
  const baseY = ceilingHeightM + 0.5;

  for (const edge of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, heightM, lengthM), materials.undergroundWall);
    wall.position.set(x + (edge * widthM) / 2, baseY + heightM / 2, z);
    local.add(wall);

    const endWall = new THREE.Mesh(new THREE.BoxGeometry(widthM, heightM, 0.3), materials.undergroundWall);
    endWall.position.set(x, baseY + heightM / 2, z + (edge * lengthM) / 2);
    local.add(endWall);
  }

  const cap = new THREE.Mesh(new THREE.BoxGeometry(widthM + 0.3, 0.3, lengthM + 0.3), materials.undergroundWall);
  cap.position.set(x, baseY + heightM, z);
  local.add(cap);

  // The shaft reads as daylit from the concourse above.
  const glow = new THREE.Mesh(new THREE.BoxGeometry(widthM - 0.6, 0.1, lengthM - 0.8), materials.light);
  glow.position.set(x, baseY + heightM - 0.25, z);
  local.add(glow);
}

/** Suspended `Ausgang` plate naming what the run leads to. */
function buildExitSign(
  local: THREE.Group,
  direction: string,
  x: number,
  side: number,
  z: number,
  ceilingHeightM: number
): void {
  const texture = makeLabelTexture(`Ausgang / exit   ${direction}`, {
    width: 1024,
    height: 150,
    bg: '#f2f2ee',
    fg: '#16181b'
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 0.68),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
  );
  sign.position.set(x - side * 1.6, ceilingHeightM - 0.9, z);
  sign.rotation.y = side === 0 ? 0 : (side * Math.PI) / 2;
  local.add(sign);
}
