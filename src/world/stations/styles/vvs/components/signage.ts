import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation } from '../../../types';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Per-side station name signs (front + back face), registered as station
 * markers so they can be batch-managed. Texture and placement match the legacy
 * rail builder, which built one sign texture per platform side.
 */
export function buildVvsStationSigns(
  local: THREE.Group,
  layer: WorldLayerContext,
  side: number,
  station: RouteStation,
  underground: boolean,
  lateral = 0, // extra outward shift when the platform is wider than default
  zShift = 0, // along-route shift for staggered platforms
  accentBg = '#174a73', // station-family accent color for the sign background
  dbSurface = false
): void {
  const signTexture = makeLabelTexture(`${layer.route.line}  ${station.name}`, {
    width: 1024,
    height: 180,
    bg: accentBg,
    fg: '#ffffff'
  });
  for (const z of dbSurface ? [-70, 0, 70] : [-21, 21]) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 1.5),
      new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.FrontSide })
    );
    sign.position.set(side * (10.75 + lateral), underground ? 3.55 : 3.05, z + zShift);
    sign.rotation.y = (side * Math.PI) / 2;
    local.add(sign);
    const signBack = sign.clone();
    signBack.rotation.y += Math.PI;
    local.add(signBack);
    layer.stationMarkers.push(sign, signBack);
  }
}

/**
 * Suspended departure board over an underground platform: the amber dot-matrix
 * panel hanging from the soffit that every Stadtbahn box has, rather than the
 * post-mounted boards used at surface interchanges.
 */
export function buildVvsSuspendedDfi(
  local: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  side: number,
  count: number,
  lengthM: number,
  ceilingHeightM: number,
  platformNumber?: string,
  lateralM = 6.9, // over a side platform; an island hangs them nearer the centre
  lines?: readonly string[]
): void {
  const boards = Math.max(0, Math.min(count, 4));
  if (boards === 0) return;

  const services = lines && lines.length > 0 ? lines.join('  ·  ') : layer.route.line;
  const label = platformNumber
    ? `${platformNumber}   ${services}  ${layer.route.destination}`
    : `${services}  ${layer.route.destination}`;
  const face = makeLabelTexture(label, { width: 1024, height: 150, bg: '#0d1116', fg: '#ffb300' });
  const usable = Math.max(10, lengthM - 24);
  const y = ceilingHeightM - 1.05;

  for (let i = 0; i < boards; i += 1) {
    const z = boards === 1 ? 0 : -usable / 2 + (usable / (boards - 1)) * i;
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), materials.steel);
    hanger.position.set(side * lateralM, ceilingHeightM - 0.45, z);
    local.add(hanger);

    const board = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.86, 4.2), materials.dfi);
    board.position.set(side * lateralM, y, z);
    local.add(board);

    for (const facing of [-1, 1]) {
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(3.9, 0.66),
        new THREE.MeshBasicMaterial({ map: face, side: THREE.FrontSide })
      );
      screen.position.set(side * lateralM + facing * 0.11, y, z);
      screen.rotation.y = (facing * Math.PI) / 2;
      local.add(screen);
    }
  }
}

/** Backlit advertising cases along an underground wall. */
export function buildVvsVitrines(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  count: number,
  lengthM: number
): void {
  const cases = Math.max(0, Math.min(count, 6));
  if (cases === 0) return;
  const usable = Math.max(8, lengthM - 20);
  const geometry = new THREE.BoxGeometry(0.18, 1.85, 1.25);
  for (let i = 0; i < cases; i += 1) {
    const z = cases === 1 ? -6 : -usable / 2 + (usable / (cases - 1)) * i;
    const vitrine = new THREE.Mesh(geometry.clone(), materials.vitrine);
    vitrine.position.set(side * 11.6, 1.85, z);
    local.add(vitrine);
  }
  geometry.dispose();
}

/** Underground exit wayfinding sign (front + back), centered above the tracks. */
export function buildVvsWayfinding(local: THREE.Group, station: RouteStation, exits?: readonly string[]): void {
  // Real exit streets when the stop lists them, else the stop's own name.
  const destination = exits && exits.length > 0 ? exits.join('  ·  ') : station.name;
  const wayfindingTexture = makeLabelTexture(`Ausgang   ${destination}   →`, {
    width: 1024,
    height: 160,
    bg: '#173f62',
    fg: '#ffffff'
  });
  const wayfinding = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 1.55),
    new THREE.MeshBasicMaterial({ map: wayfindingTexture, side: THREE.FrontSide })
  );
  wayfinding.position.set(0, 4.75, -18);
  local.add(wayfinding);
  const wayfindingBack = wayfinding.clone();
  wayfindingBack.rotation.y = Math.PI;
  local.add(wayfindingBack);
}
