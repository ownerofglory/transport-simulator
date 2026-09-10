import * as THREE from 'three';
import { makeLabelTexture } from '../../../../labels';
import type { StationBuildContext, StationVisualDefinition } from '../../types';
import { undergroundHallHalfLengthM } from '../../hallExtent';

/**
 * The 1970s Stammstrecke platform: one authored interior shared by the four
 * tunnel stops between Hauptbahnhof and Schwabstraße. Reference-based permanent
 * architecture, not the temporary construction layout.
 *
 * The stations are the same box, the same centre piers and the same suspended
 * ceiling; what tells them apart is the colour on the pier cladding, which each
 * stop carries in its own house colour (`architecture.walls.color`).
 */
export const STAMMSTRECKE_INTERIOR = 'stuttgart-stammstrecke';

/** Station colour used where the design is colour-coded; Hauptbahnhof red is the fallback. */
const DEFAULT_ACCENT = '#a73930';

export function stammstreckeColumnOffsets(definition: StationVisualDefinition): number[] {
  const half = definition.platform.lengthM / 2 - 10;
  const access = definition.access ?? [];
  const rise = (definition.architecture?.hall?.heightM ?? 4.9) - definition.platform.heightM + 1.4;
  const run = rise / Math.tan(Math.PI / 6);
  const offsets: number[] = [];
  for (let z = -half; z <= half; z += 16) {
    if (access.some(entry => entry.type === 'lift'
      ? Math.abs(z - entry.offsetM) < 5
      : z > entry.offsetM - 5 && z < entry.offsetM + run + 5)) continue;
    offsets.push(z);
  }
  return offsets;
}

export function buildStammstreckeInterior(
  local: THREE.Group, root: THREE.Group, _context: StationBuildContext, definition: StationVisualDefinition
): boolean {
  if (definition.architecture?.customAsset !== STAMMSTRECKE_INTERIOR) return false;
  const group = new THREE.Group();
  group.name = `Stammstrecke reference interior ${definition.stationId}`;
  local.add(group);
  const height = definition.architecture.hall?.heightM ?? 4.9;
  const deck = definition.platform.heightM;
  const length = undergroundHallHalfLengthM('s-bahn', definition.stationId, 'db-sbahn') * 2;
  const wallX = (definition.architecture.hall?.widthM ?? 21) / 2 - 1.6;
  const material = (color: string, roughness = 0.7) => new THREE.MeshStandardMaterial({
    color, roughness, emissive: color, emissiveIntensity: 0.3
  });
  const accent = material(definition.architecture.walls?.color ?? DEFAULT_ACCENT);
  const concrete = material('#b6b0a2');
  const steel = material('#aeb4b5', 0.4);
  const dark = material('#343536');
  const white = material('#deddd3');
  const light = new THREE.MeshBasicMaterial({ color: '#fff8e9' });
  const slatCount = Math.floor(length / 0.24);
  const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(8.1, 0.08, 0.055), concrete, slatCount);
  slats.name = 'Fine suspended ceiling slats';
  const transform = new THREE.Matrix4();
  for (let i = 0; i < slatCount; i++) {
    transform.makeTranslation(0, height - 0.29, -length / 2 + 0.12 + i * 0.24);
    slats.setMatrixAt(i, transform);
  }
  slats.instanceMatrix.needsUpdate = true;
  group.add(slats);
  const box = (name: string, size: number[], position: number[], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    group.add(mesh);
    return mesh;
  };
  const label = (text: string, width: number, h: number, x: number, y: number, z: number,
    yaw: number, bg = '#163859', fg = '#ffffff') => {
    const map = makeLabelTexture(text, { width: 1024, height: 128, bg, fg });
    const mat = new THREE.MeshBasicMaterial({ map });
    // These textures are station-owned; shared provider materials are untouched.
    mat.addEventListener('dispose', () => map.dispose());
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), mat);
    mesh.name = text;
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    group.add(mesh);
  };

  // Replace only this deck's material: its existing geometry still follows the route.
  const floor = root.getObjectByName(`Island platform ${definition.stationId}`) as THREE.Mesh | undefined;
  if (floor) {
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const grain = ((x * 17 + y * 29) % 9) - 4;
      const joint = x === 0 || y === 0;
      pixels.set(joint ? [130, 119, 113, 255] : [187 + grain, 156 + grain, 143 + grain, 255], i);
    }
    const map = new THREE.DataTexture(pixels, 32, 32);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(definition.platform.widthM / 0.6, definition.platform.lengthM / 0.6);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    const finish = material('#ffffff', 0.84);
    finish.map = finish.emissiveMap = map;
    finish.addEventListener('dispose', () => map.dispose());
    floor.material = finish;
  }

  for (const side of [-1, 1]) {
    box('Continuous white station-name frieze', [0.06, 0.55, length - 1], [side * wallX, 2.6, 0], white);
    for (let z = -length / 2 + 15; z < length / 2 - 8; z += 28) {
      label(definition.displayName, 5.4, 0.5, side * (wallX - 0.04), 2.6, z,
        -side * Math.PI / 2, '#deddd3', '#242726');
    }
    box('Platform light reflector', [0.85, 0.26, length - 2], [side * 4.35, height - 0.45, 0], steel);
    box('Continuous fluorescent diffuser', [0.58, 0.08, length - 2], [side * 4.35, height - 0.6, 0], light);
  }

  for (const z of stammstreckeColumnOffsets(definition)) {
    box('Rectangular concrete pier', [1.4, height - deck, 1.8], [0, (height + deck) / 2, z], concrete);
    box('Lower pier cladding in the station colour', [1.44, 2.05, 1.84], [0, deck + 1.025, z], accent);
    box('Pier skirting', [1.48, 0.12, 1.88], [0, deck + 0.06, z], dark);
    for (const side of [-1, 1]) {
      box('Wall-mounted bench seat', [0.46, 0.1, 1.65], [side * 0.97, deck + 0.46, z], steel);
      box('Bench support', [0.12, 0.38, 1.3], [side * 0.84, deck + 0.23, z], dark);
    }
  }

  // Neutral track wayfinding avoids assigning a wrong track when a route reverses.
  // Hauptbahnhof's island serves a numbered pair; the other stops carry one number.
  const tracks = definition.signage?.platformNumber ?? '1';
  const trackSign = `S-Bahn     ${tracks.includes('·') ? 'Gleise' : 'Gleis'} ${tracks}`;
  for (const z of [-70, -16, 70]) {
    box('Suspended platform wayfinding', [5.8, 0.56, 0.14], [0, height - 0.9, z], dark);
    for (const facing of [-1, 1]) {
      label(trackSign, 5.65, 0.45, 0, height - 0.9, z + facing * 0.08, facing === 1 ? 0 : Math.PI);
    }
    for (const x of [-2.4, 2.4]) box('Sign suspension', [0.045, 0.62, 0.045], [x, height - 0.31, z], steel);
  }
  return true;
}
