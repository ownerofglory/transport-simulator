import * as THREE from 'three';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Börsenplatz is defined by its dark, low ceiling and the green/yellow inset
 * panels that wrap the curved side platforms. This remains authored station
 * detail rather than a new generic underground architecture system.
 */
export function buildBoersenplatzFittings(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: { lengthM: number; ceilingHeightM: number }
): void {
  const root = new THREE.Group();
  root.name = 'Börsenplatz station fittings';
  local.add(root);

  buildGreenSoffitBands(root, materials, options.lengthM, options.ceilingHeightM);
  buildInsetPanels(root, materials);
  buildPlatformColorBands(root, materials);
  buildExitMarkers(root, materials, options.ceilingHeightM);
  buildGlazedAccessCore(root, materials, options.ceilingHeightM);
}

function buildGreenSoffitBands(
  root: THREE.Group,
  materials: VvsStationMaterials,
  lengthM: number,
  ceilingHeightM: number
): void {
  const green = materials.painted('#278447');
  for (const side of [-1, 1]) {
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, lengthM - 4), green);
    fascia.position.set(side * 8.65, ceilingHeightM - 0.5, 0);
    fascia.name = 'Börsenplatz green soffit band';
    root.add(fascia);

    const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, lengthM - 6), materials.lamp('#f8f3dd'));
    light.position.set(side * 8.27, ceilingHeightM - 0.75, 0);
    root.add(light);
  }
}

function buildInsetPanels(root: THREE.Group, materials: VvsStationMaterials): void {
  const bezel = roundedRectangleGeometry(1.68, 3.35, 0.3);
  const face = roundedRectangleGeometry(1.26, 2.82, 0.24);
  const colors = ['#c6b20b', '#258646', '#c6b20b'];
  const positions = [-20, 0, 20];

  for (const side of [-1, 1]) {
    for (let i = 0; i < positions.length; i += 1) {
      const rim = new THREE.Mesh(bezel, materials.plinth);
      rim.position.set(side * 11.72, 2.55, positions[i]);
      rim.rotation.y = (-side * Math.PI) / 2;
      root.add(rim);

      const inset = new THREE.Mesh(face, materials.painted(colors[(i + (side === 1 ? 1 : 0)) % colors.length]));
      inset.position.set(side * 11.65, 2.55, positions[i]);
      inset.rotation.y = (-side * Math.PI) / 2;
      inset.name = 'Börsenplatz colored wall inset';
      root.add(inset);
    }
  }
}

function buildPlatformColorBands(root: THREE.Group, materials: VvsStationMaterials): void {
  const yellow = materials.painted('#cbb44a');
  const burgundy = materials.painted('#783b45');
  for (const side of [-1, 1]) {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.035, 52), yellow);
    floor.position.set(side * 9.95, 0.825, 0);
    floor.name = 'Börsenplatz yellow platform finish';
    root.add(floor);

    const tactile = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.045, 52), burgundy);
    tactile.position.set(side * 3.76, 0.85, 0);
    tactile.name = 'Börsenplatz burgundy tactile strip';
    root.add(tactile);
  }
}

function buildExitMarkers(root: THREE.Group, materials: VvsStationMaterials, ceilingHeightM: number): void {
  const turquoise = materials.lamp('#4eeed7');
  for (const side of [-1, 1]) {
    for (const z of [-18, -6, 8, 20]) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.28, 0.52), turquoise);
      marker.position.set(side * 8.1, ceilingHeightM - 1.05, z);
      marker.name = 'Börsenplatz turquoise exit marker';
      root.add(marker);
    }
  }
}

function buildGlazedAccessCore(root: THREE.Group, materials: VvsStationMaterials, ceilingHeightM: number): void {
  const x = -9.25;
  const z = -12;
  const baseY = 0.8;
  const heightM = Math.max(3.6, ceilingHeightM - baseY - 0.3);
  const core = new THREE.Mesh(new THREE.BoxGeometry(3.4, heightM, 4.2), materials.glass);
  core.position.set(x, baseY + heightM / 2, z);
  core.name = 'Börsenplatz glazed access core';
  root.add(core);

  const postGeometry = new THREE.BoxGeometry(0.13, heightM, 0.13);
  for (const edgeX of [-1, 1]) {
    for (const edgeZ of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, materials.steel);
      post.position.set(x + edgeX * 1.75, baseY + heightM / 2, z + edgeZ * 2.15);
      root.add(post);
    }
  }
}

function roundedRectangleGeometry(widthM: number, heightM: number, radiusM: number): THREE.ShapeGeometry {
  const halfWidth = widthM / 2;
  const halfHeight = heightM / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + radiusM, -halfHeight);
  shape.lineTo(halfWidth - radiusM, -halfHeight);
  shape.absarc(halfWidth - radiusM, -halfHeight + radiusM, radiusM, -Math.PI / 2, 0, false);
  shape.lineTo(halfWidth, halfHeight - radiusM);
  shape.absarc(halfWidth - radiusM, halfHeight - radiusM, radiusM, 0, Math.PI / 2, false);
  shape.lineTo(-halfWidth + radiusM, halfHeight);
  shape.absarc(-halfWidth + radiusM, halfHeight - radiusM, radiusM, Math.PI / 2, Math.PI, false);
  shape.lineTo(-halfWidth, -halfHeight + radiusM);
  shape.absarc(-halfWidth + radiusM, -halfHeight + radiusM, radiusM, Math.PI, Math.PI * 1.5, false);
  return new THREE.ShapeGeometry(shape);
}
