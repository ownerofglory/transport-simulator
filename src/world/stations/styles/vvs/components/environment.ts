import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type { WorldLayerContext } from '../../../../layers/WorldLayerContext';
import type { RouteStation } from '../../../types';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Hillside/cutting retaining wall running behind a platform. Attaches to the
 * positioned local group, so it is a straight approximation of the wall over
 * the station's immediate length — enough to give sloped stops a recognizable
 * edge without re-deriving route curvature.
 */
export function buildVvsRetainingWall(local: THREE.Group, materials: VvsStationMaterials, side: number): void {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.2, 82), materials.concrete);
  wall.position.set(side * 13, 2.0, 0);
  wall.receiveShadow = true;
  wall.castShadow = true;
  local.add(wall);

  // Coping along the top edge of the wall.
  const coping = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 82), materials.ssbBlue);
  coping.position.set(side * 13, 4.65, 0);
  local.add(coping);
}

/**
 * Interchange departure-info (DFI) boards on posts, facing the platform. One
 * per requested display, spread along the platform. `side` selects which
 * platform edge they sit against.
 */
export function buildVvsDfiBoards(
  local: THREE.Group,
  layer: WorldLayerContext,
  materials: VvsStationMaterials,
  side: number,
  station: RouteStation,
  count: number,
  platformLengthM = 76,
  lateral = 0
): void {
  const boards = Math.max(0, Math.min(count, 6));
  const usable = Math.max(8, platformLengthM - 16);
  // Evenly spread boards along the usable platform length (single board centered).
  const slots = Array.from({ length: boards }, (_, i) =>
    boards === 1 ? -4 : -usable / 2 + (usable / (boards - 1)) * i
  );
  const face = makeLabelTexture(`${layer.route.line}  ${layer.route.destination}`, {
    width: 768,
    height: 140,
    bg: '#111820',
    fg: '#ffb300'
  });
  for (const z of slots) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), materials.ssbBlue);
    post.position.set(side * (6.4 + lateral), 1.6, z);
    local.add(post);

    const board = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 3.4), materials.dfi);
    board.position.set(side * (6.6 + lateral), 3.05, z);
    local.add(board);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 0.72),
      new THREE.MeshBasicMaterial({ map: face, side: THREE.FrontSide })
    );
    screen.position.set(side * (6.6 + lateral - 0.09), 3.05, z);
    screen.rotation.y = (side * Math.PI) / 2;
    local.add(screen);
  }
}
