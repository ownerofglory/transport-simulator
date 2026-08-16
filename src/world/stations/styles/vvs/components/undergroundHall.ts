import * as THREE from 'three';
import { makeLabelTexture } from '../../../../../labels';
import type {
  StationCeilingStyle,
  StationColumnStyle,
  StationLightingStyle,
  StationWallFinish,
  StationWallMural
} from '../../../types';
import type { VvsStationMaterials } from '../VvsStationMaterials';

/**
 * Underground box: invert slab, side walls with their cladding build-up, and a
 * roof. Attaches to the positioned, rotated local group.
 *
 * Stuttgart's boxes are not interchangeable — Rotebühlplatz is a pitched roof on
 * exposed red trusses over terracotta tile, Schwabstraße a flat deck over yellow
 * enamel panels, Hauptbahnhof a coffered slab — so the shell is described by
 * config rather than hard-coded. With no architecture data the defaults
 * reproduce the previous plain box, which is what every non-Stuttgart city that
 * shares this provider still gets.
 */

const DEFAULT_WIDTH_M = 27;
const DEFAULT_LENGTH_M = 82;
const DEFAULT_CLEAR_HEIGHT_M = 5.46; // underside of the legacy ceiling slab
const WALL_INSET_M = 1.3; // structural wall face, inboard of the box edge
const PLINTH_TOP_M = 0.9;
const FIELD_TOP_M = 4.6; // top of the coloured cladding field

export type VvsUndergroundHallOptions = {
  lengthM?: number;
  widthM?: number;
  heightM?: number; // clear height to the ceiling underside
  ceiling?: StationCeilingStyle;
  ceilingColor?: string;
  trussColor?: string;
  wallFinish?: StationWallFinish;
  wallColor?: string;
  plinthColor?: string;
  mural?: StationWallMural;
  stationName?: string;
  nameBandRepeatM?: number;
};

export function buildVvsUndergroundHall(
  local: THREE.Group,
  materials: VvsStationMaterials,
  options: VvsUndergroundHallOptions = {}
): void {
  const lengthM = options.lengthM ?? DEFAULT_LENGTH_M;
  const widthM = options.widthM ?? DEFAULT_WIDTH_M;
  const heightM = options.heightM ?? DEFAULT_CLEAR_HEIGHT_M;
  const wallX = widthM / 2 - WALL_INSET_M;

  // Invert slab. Without it the box is open below the platform edges, and since
  // the ground plane is hidden underground that reads as daylight under the
  // station where it meets the tunnel bore.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(widthM, 0.4, lengthM), materials.undergroundWall);
  floor.position.y = -0.32;
  floor.receiveShadow = true;
  local.add(floor);

  for (const side of [-1, 1]) {
    buildSideWall(local, materials, side, wallX, heightM, lengthM, options);
  }

  // No end walls: the tunnel bore reaches a few metres into the box and its
  // bulkhead end cap already seals the hall cross-section around the mouth.
  buildCeiling(local, materials, widthM, lengthM, heightM, options);
}

/** Structural wall plus the plinth / cladding field / head band build-up. */
function buildSideWall(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  wallX: number,
  heightM: number,
  lengthM: number,
  options: VvsUndergroundHallOptions
): void {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, heightM, lengthM),
    materials.undergroundWall
  );
  wall.position.set(side * wallX, heightM / 2, 0);
  wall.receiveShadow = true;
  local.add(wall);

  // Artwork is independent of the finish: Killesberg's filmstrip runs along
  // bare concrete, which is exactly what makes it the thing you remember.
  if (options.mural === 'film-strip') {
    buildFilmStrip(local, materials, side, side * (wallX - 0.24), lengthM);
  }

  const finish = options.wallFinish ?? 'concrete';
  if (finish === 'concrete' || !options.wallColor) return;

  // Cladding sits just inboard of the structural face so it catches the strip
  // lights; the dark plinth and head band frame it the way the enamel-panel
  // stations do.
  const faceX = side * (wallX - 0.26);
  const fieldHeight = FIELD_TOP_M - PLINTH_TOP_M;
  const field = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, fieldHeight, lengthM),
    materials.cladding(options.wallColor, finish)
  );
  field.position.set(faceX, PLINTH_TOP_M + fieldHeight / 2, 0);
  local.add(field);

  const plinthMaterial = options.plinthColor ? materials.painted(options.plinthColor) : materials.plinth;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.1, PLINTH_TOP_M, lengthM), plinthMaterial);
  plinth.position.set(faceX, PLINTH_TOP_M / 2, 0);
  local.add(plinth);

  const headHeight = Math.max(0.2, heightM - FIELD_TOP_M);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, headHeight, lengthM), plinthMaterial);
  head.position.set(faceX, FIELD_TOP_M + headHeight / 2, 0);
  local.add(head);

  buildNameFrieze(local, side, faceX, lengthM, options);
}

/**
 * Killesberg's Kodak filmstrip: a carrier band running the length of the track
 * wall, its frames lit and its sprocket holes punched along both edges. Built
 * from three instanced runs so a 300 m wall stays three draw calls.
 */
function buildFilmStrip(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  faceX: number,
  lengthM: number
): void {
  const runM = Math.max(12, lengthM - 8);
  const centreY = 2.6;
  const carrierHeightM = 1.9;

  const carrier = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, carrierHeightM, runM),
    materials.filmCarrier
  );
  carrier.position.set(faceX, centreY, 0);
  local.add(carrier);

  const dummy = new THREE.Object3D();
  const frameSpacingM = 2.3;
  const frameCount = Math.max(1, Math.floor(runM / frameSpacingM));
  const frames = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.04, 1.16, 1.72),
    materials.filmFrame,
    frameCount
  );
  const firstFrameZ = -((frameCount - 1) * frameSpacingM) / 2;
  for (let i = 0; i < frameCount; i += 1) {
    dummy.position.set(faceX - side * 0.03, centreY, firstFrameZ + i * frameSpacingM);
    dummy.updateMatrix();
    frames.setMatrixAt(i, dummy.matrix);
  }
  frames.instanceMatrix.needsUpdate = true;
  local.add(frames);

  // Sprockets: two rows along the carrier edges, as on real 35 mm stock.
  const holeSpacingM = 0.42;
  const holeRows = [centreY + carrierHeightM / 2 - 0.22, centreY - carrierHeightM / 2 + 0.22];
  const holeCount = Math.max(2, Math.floor(runM / holeSpacingM));
  const perforations = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.04, 0.13, 0.13),
    materials.filmPerforation,
    holeCount * holeRows.length
  );
  const firstHoleZ = -((holeCount - 1) * holeSpacingM) / 2;
  let index = 0;
  for (const y of holeRows) {
    for (let i = 0; i < holeCount; i += 1) {
      dummy.position.set(faceX - side * 0.03, y, firstHoleZ + i * holeSpacingM);
      dummy.updateMatrix();
      perforations.setMatrixAt(index++, dummy.matrix);
    }
  }
  perforations.instanceMatrix.needsUpdate = true;
  local.add(perforations);
}

/**
 * Station name repeated along the wall field, as the enamel-panel stations
 * carry it. Skipped when the stop has no name band configured.
 */
function buildNameFrieze(
  local: THREE.Group,
  side: number,
  faceX: number,
  lengthM: number,
  options: VvsUndergroundHallOptions
): void {
  const repeatM = options.nameBandRepeatM ?? 0;
  if (repeatM <= 0 || !options.stationName) return;

  const texture = makeLabelTexture(options.stationName, {
    width: 1024,
    height: 128,
    bg: options.wallColor ?? '#c8c8c3',
    fg: '#1c1c1c'
  });
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
  const geometry = new THREE.PlaneGeometry(7.2, 0.9);
  const count = Math.max(1, Math.floor(lengthM / repeatM));
  const first = -((count - 1) * repeatM) / 2;
  for (let i = 0; i < count; i += 1) {
    const plate = new THREE.Mesh(geometry, material);
    plate.position.set(faceX - side * 0.06, 2.6, first + i * repeatM);
    plate.rotation.y = (side * Math.PI) / 2;
    local.add(plate);
  }
}

function buildCeiling(
  local: THREE.Group,
  materials: VvsStationMaterials,
  widthM: number,
  lengthM: number,
  heightM: number,
  options: VvsUndergroundHallOptions
): void {
  // Coffers are the common Stuttgart form and the default everywhere, including
  // the other cities that share this provider: they hang well clear of the
  // loading gauge, so no stop can be broken by getting them.
  const style = options.ceiling ?? 'coffered';
  const deck = options.ceilingColor ? materials.painted(options.ceilingColor) : materials.undergroundWall;

  if (style === 'trussed-vault') {
    buildTrussedVault(local, materials, widthM, lengthM, heightM, options, deck);
    return;
  }

  const slab = new THREE.Mesh(new THREE.BoxGeometry(widthM, 0.48, lengthM), deck);
  slab.position.y = heightM + 0.24;
  slab.receiveShadow = true;
  local.add(slab);

  if (style === 'coffered') {
    // Longitudinal downstand ribs, as at Hauptbahnhof and Charlottenplatz.
    for (const x of [-8.4, -4.2, 0, 4.2, 8.4]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.44, lengthM), deck);
      rib.position.set(x, heightM - 0.22, 0);
      local.add(rib);
    }
    return;
  }

  if (style === 'ribbed-metal') {
    // Dark suspended deck with closely spaced transverse ribs.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(widthM - 0.8, 0.1, lengthM), materials.ceilingMetal);
    plate.position.y = heightM - 0.06;
    local.add(plate);

    const spacingM = 1.6;
    const count = Math.max(1, Math.floor(lengthM / spacingM));
    const ribs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(widthM - 1.4, 0.16, 0.42),
      materials.ceilingMetal,
      count
    );
    const dummy = new THREE.Object3D();
    const first = -((count - 1) * spacingM) / 2;
    for (let i = 0; i < count; i += 1) {
      dummy.position.set(0, heightM - 0.18, first + i * spacingM);
      dummy.updateMatrix();
      ribs.setMatrixAt(i, dummy.matrix);
    }
    ribs.instanceMatrix.needsUpdate = true;
    local.add(ribs);
  }
}

/** Rotebühlplatz's pitched roof carried on exposed painted steel trusses. */
function buildTrussedVault(
  local: THREE.Group,
  materials: VvsStationMaterials,
  widthM: number,
  lengthM: number,
  heightM: number,
  options: VvsUndergroundHallOptions,
  deck: THREE.Material
): void {
  const riseM = 1.7;
  const halfWidth = widthM / 2;
  const pitch = Math.atan2(riseM, halfWidth);
  const slopeLength = Math.hypot(halfWidth, riseM);

  for (const side of [-1, 1]) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(slopeLength, 0.3, lengthM), deck);
    pane.position.set((side * halfWidth) / 2, heightM + riseM / 2, 0);
    pane.rotation.z = -side * pitch;
    pane.receiveShadow = true;
    local.add(pane);
  }

  const truss = materials.painted(options.trussColor ?? '#a33526');
  const spacingM = 6;
  const count = Math.max(2, Math.floor(lengthM / spacingM));
  const first = -((count - 1) * spacingM) / 2;
  const dummy = new THREE.Object3D();

  const chords = new THREE.InstancedMesh(new THREE.BoxGeometry(widthM - 1, 0.16, 0.16), truss, count);
  for (let i = 0; i < count; i += 1) {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(0, heightM - 0.1, first + i * spacingM);
    dummy.updateMatrix();
    chords.setMatrixAt(i, dummy.matrix);
  }
  chords.instanceMatrix.needsUpdate = true;
  local.add(chords);

  // Two diagonals per bay rising from the wall head to the ridge.
  for (const side of [-1, 1]) {
    const diagonals = new THREE.InstancedMesh(
      new THREE.BoxGeometry(slopeLength - 0.6, 0.13, 0.13),
      truss,
      count
    );
    for (let i = 0; i < count; i += 1) {
      dummy.rotation.set(0, 0, -side * pitch);
      dummy.position.set((side * halfWidth) / 2, heightM + riseM / 2 - 0.3, first + i * spacingM);
      dummy.updateMatrix();
      diagonals.setMatrixAt(i, dummy.matrix);
    }
    diagonals.instanceMatrix.needsUpdate = true;
    local.add(diagonals);
  }
}

export type VvsUndergroundSideOptions = {
  lengthM?: number;
  heightM?: number;
  columnStyle?: StationColumnStyle;
  columnColor?: string;
  columnSpacingM?: number;
  lighting?: StationLightingStyle;
  lightColor?: string;
};

// Laterals of the legacy side-platform box: columns behind the platform, lights
// over its track edge.
const SIDE_COLUMN_X_M = 9.7;
const SIDE_LIGHT_X_M = 7.1;
const SIDE_STRIP_X_M = 6.4;

/** Per-side underground column row and platform lighting. */
export function buildVvsUndergroundSideLighting(
  local: THREE.Group,
  materials: VvsStationMaterials,
  side: number,
  options: VvsUndergroundSideOptions = {}
): void {
  buildVvsUndergroundColumnRow(local, materials, side * SIDE_COLUMN_X_M, options);
  buildVvsUndergroundLighting(
    local,
    materials,
    side * (options.lighting === 'strip-continuous' ? SIDE_STRIP_X_M : SIDE_LIGHT_X_M),
    options
  );
}

/**
 * A row of columns at a given lateral position. Side platforms carry one row
 * behind each platform; an island carries a single row down its centre line.
 */
export function buildVvsUndergroundColumnRow(
  local: THREE.Group,
  materials: VvsStationMaterials,
  xM: number,
  options: VvsUndergroundSideOptions = {}
): void {
  const lengthM = options.lengthM ?? DEFAULT_LENGTH_M;
  const heightM = options.heightM ?? DEFAULT_CLEAR_HEIGHT_M;
  buildColumnRow(local, materials, xM, lengthM, heightM, options);
}

/** A run of platform lighting at a given lateral position. */
export function buildVvsUndergroundLighting(
  local: THREE.Group,
  materials: VvsStationMaterials,
  xM: number,
  options: VvsUndergroundSideOptions = {}
): void {
  const lengthM = options.lengthM ?? DEFAULT_LENGTH_M;
  const heightM = options.heightM ?? DEFAULT_CLEAR_HEIGHT_M;
  buildPlatformLighting(local, materials, xM, lengthM, heightM, options);
}

function buildColumnRow(
  local: THREE.Group,
  materials: VvsStationMaterials,
  xM: number,
  lengthM: number,
  heightM: number,
  options: VvsUndergroundSideOptions
): void {
  const style = options.columnStyle ?? 'square';
  if (style === 'none') return;

  const material = options.columnColor ? materials.painted(options.columnColor) : materials.ssbBlue;
  const spacingM = options.columnSpacingM ?? 24;
  // Leaves a bay clear at each end; at the legacy 82 m length this is the same
  // three columns per side the previous hall had.
  const count = Math.max(1, Math.floor((lengthM - 24) / spacingM) + 1);
  const first = -((count - 1) * spacingM) / 2;
  const geometry =
    style === 'round'
      ? new THREE.CylinderGeometry(0.42, 0.42, heightM - 0.2, 16)
      : new THREE.BoxGeometry(0.58, heightM - 0.2, 0.58);

  const columns = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i += 1) {
    dummy.position.set(xM, (heightM - 0.2) / 2, first + i * spacingM);
    dummy.updateMatrix();
    columns.setMatrixAt(i, dummy.matrix);
  }
  columns.instanceMatrix.needsUpdate = true;
  columns.castShadow = true;
  local.add(columns);
}

function buildPlatformLighting(
  local: THREE.Group,
  materials: VvsStationMaterials,
  xM: number,
  lengthM: number,
  heightM: number,
  options: VvsUndergroundSideOptions
): void {
  const style = options.lighting ?? 'strip-segments';
  const material = materials.lamp(options.lightColor);
  const y = heightM - 0.06;

  if (style === 'strip-continuous') {
    // One unbroken line over the platform edge — the strongest cue that a box
    // is lit rather than merely bright, and what most of the halls actually use.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, lengthM - 2), material);
    strip.position.set(xM, y, 0);
    local.add(strip);
    return;
  }

  const spacingM = style === 'recessed-rows' ? 4.5 : 16;
  const lampLengthM = style === 'recessed-rows' ? 2.4 : 8.5;
  const count = Math.max(1, Math.floor((lengthM - 6) / spacingM));
  const first = -((count - 1) * spacingM) / 2;
  const lamps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(style === 'recessed-rows' ? 0.9 : 1.25, 0.12, lampLengthM),
    material,
    count
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i += 1) {
    dummy.position.set(xM, y, first + i * spacingM);
    dummy.updateMatrix();
    lamps.setMatrixAt(i, dummy.matrix);
  }
  lamps.instanceMatrix.needsUpdate = true;
  local.add(lamps);
}
