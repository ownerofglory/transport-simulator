import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation } from '../../../types';

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
  accentBg = '#174a73' // station-family accent color for the sign background
): void {
  const signTexture = makeLabelTexture(`${layer.route.line}  ${station.name}`, {
    width: 1024,
    height: 180,
    bg: accentBg,
    fg: '#ffffff'
  });
  for (const z of [-21, 21]) {
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

/** Underground exit wayfinding sign (front + back), centered above the tracks. */
export function buildVvsWayfinding(local: THREE.Group, station: RouteStation): void {
  const wayfindingTexture = makeLabelTexture(`Ausgang   ${station.name}   →`, {
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
