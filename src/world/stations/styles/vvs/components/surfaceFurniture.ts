import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation } from '../../../types';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * The street-level furniture that makes a Stuttgart surface stop recognisable:
 * the blue "U Stadtbahn" totem, the back railing, lamp columns, backlit poster
 * cases, and the orange information kiosk.
 *
 * These are what the reference photos have and the stops did not — a surface
 * stop was a canopy, a bench, and a floating name plate. Counts and presence
 * come from config; nothing here is seeded, because a stop either has a kiosk
 * or it does not.
 */

const RAILING_HEIGHT_M = 1.1;

/**
 * Blue totem mast: the U plate, the stop name under it, and the lines called.
 * Stands at the back of the platform facing the street, one per side.
 */
export function buildVvsTotem(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  station: RouteStation,
  lateral: number,
  lines: readonly string[] | undefined,
  offsetM = -18,
  // Absolute lateral position, for layouts that are not measured from a side
  // platform (an island stands its totem near its own centre line).
  xM?: number
): void {
  const x = xM ?? side * (10.4 + lateral);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 8), materials.mast);
  mast.position.set(x, 1.8, offsetM);
  mast.castShadow = true;
  local.add(mast);

  const face = makeLabelTexture(`U   ${station.name}${lines?.length ? `   ${lines.join(' ')}` : ''}`, {
    width: 512,
    height: 320,
    bg: '#0d6ab4',
    fg: '#ffffff'
  });
  const plateMaterial = new THREE.MeshBasicMaterial({ map: face, side: THREE.DoubleSide });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.72), plateMaterial);
  plate.position.set(x, 3.1, offsetM);
  // Faces along the platform so it reads from both approaches, like the real
  // mast-mounted plates rather than the track-facing name signs.
  plate.rotation.y = side * 0.4;
  local.add(plate);
}

/** Tubular safety railing along the back edge of a surface platform. */
export function buildVvsPlatformRailing(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  lengthM: number,
  lateral: number
): void {
  const x = side * (11.3 + lateral);

  for (const y of [RAILING_HEIGHT_M, RAILING_HEIGHT_M * 0.55]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, lengthM, 6), materials.steel);
    rail.position.set(x, y, 0);
    rail.rotation.x = Math.PI / 2;
    local.add(rail);
  }

  const spacingM = 2.4;
  const count = Math.max(2, Math.floor(lengthM / spacingM));
  const posts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.04, 0.04, RAILING_HEIGHT_M, 6),
    materials.steel,
    count
  );
  const dummy = new THREE.Object3D();
  const first = -((count - 1) * spacingM) / 2;
  for (let i = 0; i < count; i += 1) {
    dummy.position.set(x, RAILING_HEIGHT_M / 2, first + i * spacingM);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  local.add(posts);
}

/** Slim lamp columns with an outreach head, spread along the platform. */
export function buildVvsLampColumns(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  count: number,
  lengthM: number,
  lateral: number
): void {
  const columns = Math.max(0, Math.min(count, 6));
  if (columns === 0) return;

  const x = side * (10.1 + lateral);
  const usable = Math.max(10, lengthM - 12);
  const heightM = 5.4;

  for (let i = 0; i < columns; i += 1) {
    const z = columns === 1 ? 0 : -usable / 2 + (usable / (columns - 1)) * i;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, heightM, 8), materials.mast);
    post.position.set(x, heightM / 2, z);
    post.castShadow = true;
    local.add(post);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.34), materials.mast);
    head.position.set(x - side * 0.42, heightM, z);
    local.add(head);

    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.24), materials.light);
    lamp.position.set(x - side * 0.42, heightM - 0.1, z);
    local.add(lamp);
  }
}

/** Freestanding backlit poster cases, back-to-back on their own plinth. */
export function buildVvsSurfaceVitrines(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  count: number,
  lengthM: number,
  lateral: number
): void {
  const cases = Math.max(0, Math.min(count, 4));
  if (cases === 0) return;

  const x = side * (9.9 + lateral);
  const usable = Math.max(8, lengthM - 18);
  const geometry = new THREE.BoxGeometry(0.26, 1.9, 1.3);
  for (let i = 0; i < cases; i += 1) {
    const z = cases === 1 ? 4 : -usable / 2 + (usable / (cases - 1)) * i;
    const vitrine = new THREE.Mesh(geometry.clone(), materials.vitrine);
    vitrine.position.set(x, 1.15, z);
    vitrine.castShadow = true;
    local.add(vitrine);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 1.4), materials.mast);
    foot.position.set(x, 0.1, z);
    local.add(foot);
  }
  geometry.dispose();
}

/** Orange SSB information kiosk with a lit service window. */
export function buildVvsInfoKiosk(
  local: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  side: number,
  lateral: number,
  offsetM = -6
): void {
  const x = side * (10.2 + lateral);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 2.6), materials.kiosk);
  body.position.set(x, 1.25, offsetM);
  body.castShadow = true;
  local.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 2.8), materials.canopy);
  roof.position.set(x, 2.58, offsetM);
  local.add(roof);

  const face = makeLabelTexture(`Information   ${layer.route.line}`, {
    width: 512,
    height: 128,
    bg: '#e8791a',
    fg: '#ffffff'
  });
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.42),
    new THREE.MeshBasicMaterial({ map: face, side: THREE.FrontSide })
  );
  banner.position.set(x - side * 0.77, 2.15, offsetM);
  banner.rotation.y = (side * Math.PI) / 2 + Math.PI;
  local.add(banner);

  const window = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.2), materials.vitrine);
  window.position.set(x - side * 0.77, 1.4, offsetM);
  window.rotation.y = (side * Math.PI) / 2 + Math.PI;
  local.add(window);
}

/**
 * Parapet along the outer edge of an elevated or bridge stop, where the
 * platform is open to a drop rather than backing onto ground.
 */
export function buildVvsEdgeParapet(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  lengthM: number,
  lateral: number
): void {
  const x = side * (11.5 + lateral);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.25, lengthM), materials.plinth);
  wall.position.set(x, 0.62, 0);
  wall.castShadow = true;
  local.add(wall);

  const coping = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, lengthM), materials.steel);
  coping.position.set(x, 1.3, 0);
  local.add(coping);
}
