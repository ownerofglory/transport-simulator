import * as THREE from 'three';

export type GeoPoint = { lat: number; lon: number };
export type LandmarkZone = { lat: number; lon: number; radiusM: number };

type LandmarkKind = 'new-palace' | 'old-castle' | 'stiftskirche' | 'johanneskirche' | 'bonatzbau' | 'weissenhof' | 'tv-tower' | 'chapel';
type LandmarkDefinition = LandmarkZone & { name: string; kind: LandmarkKind; yawDeg: number; heightM: number };

// Curated Stuttgart landmarks used as simple recognizable silhouettes near relevant routes.
const LANDMARKS: LandmarkDefinition[] = [
  { name: 'Neues Schloss', kind: 'new-palace', lat: 48.7781573, lon: 9.1814868, radiusM: 55, yawDeg: 5, heightM: 23 },
  { name: 'Altes Schloss', kind: 'old-castle', lat: 48.7770198, lon: 9.1797704, radiusM: 48, yawDeg: -18, heightM: 24 },
  { name: 'Stiftskirche', kind: 'stiftskirche', lat: 48.776685, lon: 9.1779188, radiusM: 35, yawDeg: 72, heightM: 42 },
  { name: 'Johanneskirche am Feuersee', kind: 'johanneskirche', lat: 48.7733299, lon: 9.1645932, radiusM: 36, yawDeg: -14, heightM: 38 },
  { name: 'Hauptbahnhof Bonatzbau', kind: 'bonatzbau', lat: 48.7836167, lon: 9.1816624, radiusM: 70, yawDeg: 88, heightM: 48 },
  { name: 'Weißenhofsiedlung', kind: 'weissenhof', lat: 48.8005532, lon: 9.1772977, radiusM: 72, yawDeg: 15, heightM: 15 },
  { name: 'Fernsehturm Stuttgart', kind: 'tv-tower', lat: 48.7557623, lon: 9.1901682, radiusM: 28, yawDeg: 0, heightM: 217 },
  { name: 'Grabkapelle auf dem Württemberg', kind: 'chapel', lat: 48.7820408, lon: 9.2687406, radiusM: 24, yawDeg: 0, heightM: 24 }
];

type LandmarkMaterials = {
  sandstone: THREE.MeshStandardMaterial;
  redSandstone: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  darkRoof: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
};

/** Builds route-proximity landmark silhouettes and exclusion zones for streamed OSM buildings. */
export function createStuttgartLandmarks(
  route: GeoPoint[],
  projectGeo: (lat: number, lon: number) => THREE.Vector3,
  surfaceHeight: (lat: number, lon: number) => Promise<number>
): { group: THREE.Group; zones: LandmarkZone[] } {
  const group = new THREE.Group();
  group.name = 'Curated Stuttgart landmark silhouettes';

  // Only render landmarks within 1.4 km of the selected route.
  const nearby = LANDMARKS.filter((landmark) => distanceToRouteM(landmark, route) <= 1400);
  const materials = makeMaterials();

  for (const landmark of nearby) {
    const model = buildLandmark(landmark, materials);
    model.name = landmark.name;
    model.position.copy(projectGeo(landmark.lat, landmark.lon));
    model.rotation.y = THREE.MathUtils.degToRad(landmark.yawDeg);

    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      // The TV tower is thin/tall, so skipping shadows avoids noisy shadow artifacts.
      object.castShadow = landmark.kind !== 'tv-tower';
      object.receiveShadow = true;
    });

    group.add(model);

    // Height loads async so landmark creation does not block the world rebuild.
    void surfaceHeight(landmark.lat, landmark.lon)
      .then((height) => { model.position.y = height + 0.08; }) // tiny lift prevents z-fighting with terrain.
      .catch(() => undefined);
  }

  // Exclusion zones prevent streamed OSM buildings from overlapping curated landmarks.
  return { group, zones: nearby.map(({ lat, lon, radiusM }) => ({ lat, lon, radiusM })) };
}

/** Shared materials for all low-poly landmark silhouettes. */
function makeMaterials(): LandmarkMaterials {
  return {
    sandstone: new THREE.MeshStandardMaterial({ color: 0xb7a48b, roughness: 0.9 }), // Stuttgart sandstone beige.
    redSandstone: new THREE.MeshStandardMaterial({ color: 0x916f5d, roughness: 0.92 }), // church red sandstone.
    roof: new THREE.MeshStandardMaterial({ color: 0x744b3c, roughness: 0.94 }), // warm tile roof.
    darkRoof: new THREE.MeshStandardMaterial({ color: 0x3f484c, roughness: 0.82, metalness: 0.08 }), // dark metal/slate roof.
    white: new THREE.MeshStandardMaterial({ color: 0xe8e5dc, roughness: 0.82 }), // light plaster/concrete.
    glass: new THREE.MeshStandardMaterial({ color: 0x31434c, roughness: 0.35, metalness: 0.15 }), // dark reflective window bands.
    concrete: new THREE.MeshStandardMaterial({ color: 0xaaa9a2, roughness: 0.88 }), // neutral concrete.
    metal: new THREE.MeshStandardMaterial({ color: 0x7f898c, roughness: 0.38, metalness: 0.68 }) // grey metal.
  };
}

/** Dispatches each landmark kind to its procedural silhouette builder. */
function buildLandmark(definition: LandmarkDefinition, materials: LandmarkMaterials): THREE.Group {
  switch (definition.kind) {
    case 'new-palace': return buildNewPalace(materials);
    case 'old-castle': return buildOldCastle(materials);
    case 'stiftskirche': return buildStiftskirche(materials);
    case 'johanneskirche': return buildJohanneskirche(materials);
    case 'bonatzbau': return buildBonatzbau(materials);
    case 'weissenhof': return buildWeissenhof(materials);
    case 'tv-tower': return buildTvTower(materials);
    case 'chapel': return buildChapel(materials);
  }
}

/** Simplified Neues Schloss massing: central block, wings, hipped roofs, and dome. */
function buildNewPalace(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  addBox(group, [38, 13, 16], [0, 6.5, 0], m.sandstone); // central palace block.
  addBox(group, [13, 10, 43], [-24, 5, 13], m.sandstone); // left wing.
  addBox(group, [13, 10, 43], [24, 5, 13], m.sandstone); // right wing.

  addHippedRoof(group, 40, 18, 5, [0, 13, 0], m.darkRoof);
  addHippedRoof(group, 15, 45, 4, [-24, 10, 13], m.darkRoof);
  addHippedRoof(group, 15, 45, 4, [24, 10, 13], m.darkRoof);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5.2, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), // half-sphere dome.
    m.darkRoof
  );
  dome.position.set(0, 18, 0);
  group.add(dome);

  addBox(group, [2.2, 3, 2.2], [0, 20.2, 0], m.sandstone); // small dome lantern.

  return group;
}

/** Simplified Altes Schloss massing: courtyard block with four corner towers. */
function buildOldCastle(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  addBox(group, [38, 13, 31], [0, 6.5, 0], m.sandstone);
  addHippedRoof(group, 40, 33, 7, [0, 13, 0], m.roof);

  for (const x of [-18, 18]) {
    for (const z of [-14, 14]) {
      addCylinder(group, 4.3, 16, [x, 8, z], m.sandstone, 12); // corner tower body.
      addCone(group, 5, 6, [x, 19, z], m.roof, 12); // pointed tower roof.
    }
  }

  return group;
}

/** Simplified Stiftskirche with nave and two asymmetric towers. */
function buildStiftskirche(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  addBox(group, [17, 13, 40], [0, 6.5, 3], m.redSandstone); // church nave.
  addGableRoof(group, 18, 42, 6, [0, 13, 3], m.roof);

  addBox(group, [9, 28, 9], [-5, 14, -20], m.redSandstone); // taller tower.
  addHippedRoof(group, 10, 10, 6, [-5, 28, -20], m.darkRoof);

  addBox(group, [6.5, 20, 6.5], [5.5, 10, -19], m.redSandstone); // smaller tower.
  addCone(group, 5, 12, [5.5, 26, -19], m.darkRoof, 8);

  return group;
}

/** Simplified Johanneskirche silhouette with tall tower and nave. */
function buildJohanneskirche(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  addBox(group, [16, 14, 37], [0, 7, 2], m.redSandstone); // nave.
  addGableRoof(group, 17, 39, 7, [0, 14, 2], m.roof);

  addBox(group, [10, 31, 10], [0, 15.5, -22], m.redSandstone); // main tower.
  addBox(group, [10.8, 2, 10.8], [0, 32, -22], m.darkRoof); // flat tower cap.

  for (const x of [-8.7, 8.7]) {
    for (const z of [-10, 0, 10]) {
      addBox(group, [1.2, 8, 1.8], [x, 4, z], m.redSandstone); // side buttresses/window rhythm.
    }
  }

  return group;
}

/** Simplified Hauptbahnhof Bonatzbau with long hall, tower, glass strip, and clock. */
function buildBonatzbau(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  addBox(group, [62, 17, 20], [0, 8.5, 0], m.sandstone); // station hall block.
  addBox(group, [15, 47, 15], [-22, 23.5, 0], m.sandstone); // clock tower.
  addBox(group, [16, 1.2, 16], [-22, 47.5, 0], m.darkRoof); // tower cap.
  addBox(group, [44, 3.2, 0.5], [8, 11, -10.2], m.glass); // front glazing strip.

  const clock = new THREE.Mesh(new THREE.CircleGeometry(3, 20), m.white); // simple clock face.
  clock.position.set(-22, 36, -7.56);
  clock.rotation.y = Math.PI;
  group.add(clock);

  return group;
}

/** Simplified Weißenhofsiedlung: white modernist blocks with horizontal windows. */
function buildWeissenhof(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  const blocks: [number[], number[]][] = [
    [[28, 11, 12], [0, 5.5, 0]],
    [[16, 8, 13], [-24, 4, 8]],
    [[18, 9, 11], [23, 4.5, -7]],
    [[13, 7, 10], [4, 3.5, 18]]
  ];

  for (const [size, position] of blocks) {
    addBox(group, size as [number, number, number], position as [number, number, number], m.white);

    // Horizontal glazing band gives the white boxes a modernist silhouette.
    addBox(
      group,
      [size[0] * 0.82, 1.4, 0.3],
      [position[0], position[1] + 1, position[2] - size[2] / 2 - 0.16],
      m.glass
    );
  }

  return group;
}

/** Simplified Fernsehturm: tapered shaft, observation deck, and antenna. */
function buildTvTower(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  addCylinder(group, 1.8, 126, [0, 63, 0], m.concrete, 12, 1.1); // tapered concrete shaft.
  addCylinder(group, 8.2, 8, [0, 127, 0], m.concrete, 16); // observation deck base.
  addCylinder(group, 6.8, 6, [0, 134, 0], m.glass, 16); // glazed observation band.
  addCylinder(group, 7.5, 1.2, [0, 137.6, 0], m.metal, 16); // deck cap.
  addCylinder(group, 0.55, 79, [0, 177.5, 0], m.metal, 8, 0.18); // antenna mast.

  return group;
}

/** Simplified Grabkapelle: circular base, columns, dome, and lantern. */
function buildChapel(m: LandmarkMaterials): THREE.Group {
  const group = new THREE.Group();

  addCylinder(group, 11, 2.4, [0, 1.2, 0], m.sandstone, 18); // circular plinth.
  addCylinder(group, 7.2, 8, [0, 6.4, 0], m.white, 18); // round chapel body.

  for (let index = 0; index < 12; index++) {
    const angle = (index / 12) * Math.PI * 2;
    addCylinder(
      group,
      0.35,
      7,
      [Math.cos(angle) * 8.2, 5.9, Math.sin(angle) * 8.2],
      m.sandstone,
      8
    ); // ring of exterior columns.
  }

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(7.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), // half-sphere dome.
    m.darkRoof
  );
  dome.position.y = 10.4;
  group.add(dome);

  addCylinder(group, 1.2, 3.5, [0, 16, 0], m.white, 10); // small dome lantern.

  return group;
}

/** Adds a simple box mesh to a landmark group. */
function addBox(group: THREE.Group, size: [number, number, number], position: [number, number, number], material: THREE.Material): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  group.add(mesh);
}

/** Adds a cylinder or tapered cylinder mesh to a landmark group. */
function addCylinder(
  group: THREE.Group,
  radius: number,
  height: number,
  position: [number, number, number],
  material: THREE.Material,
  segments: number,
  topRadius = radius
): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, radius, height, segments), material);
  mesh.position.set(...position);
  group.add(mesh);
}

/** Adds a cone mesh, usually used for towers or pointed roofs. */
function addCone(group: THREE.Group, radius: number, height: number, position: [number, number, number], material: THREE.Material, segments: number): void {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, segments), material);
  mesh.position.set(...position);
  group.add(mesh);
}

/** Adds a low-poly hipped roof using a scaled four-sided cone. */
function addHippedRoof(group: THREE.Group, width: number, depth: number, height: number, position: [number, number, number], material: THREE.Material): void {
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1, height, 4), material);
  roof.position.set(position[0], position[1] + height / 2, position[2]);
  roof.rotation.y = Math.PI / 4; // rotate square cone so roof ridges align diagonally.
  roof.scale.set(width / Math.SQRT2, 1, depth / Math.SQRT2); // compensate for cone's diagonal footprint.
  group.add(roof);
}

/** Adds a triangular prism gable roof with manually indexed faces. */
function addGableRoof(group: THREE.Group, width: number, depth: number, height: number, position: [number, number, number], material: THREE.Material): void {
  const halfW = width / 2;
  const halfD = depth / 2;

  // Two triangular ends plus rectangular roof slopes.
  const vertices = new Float32Array([
    -halfW, 0, -halfD, halfW, 0, -halfD, 0, height, -halfD,
    -halfW, 0, halfD, halfW, 0, halfD, 0, height, halfD
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

  // Face index order for end triangles and side rectangles.
  geometry.setIndex([0, 1, 2, 3, 5, 4, 0, 3, 1, 1, 3, 4, 0, 2, 3, 2, 5, 3, 1, 4, 2, 2, 4, 5]);
  geometry.computeVertexNormals();

  const roof = new THREE.Mesh(geometry, material);
  roof.position.set(...position);
  group.add(roof);
}

/** Returns the nearest approximate distance from a landmark point to sampled route points. */
function distanceToRouteM(point: GeoPoint, route: GeoPoint[]): number {
  if (!route.length) return Number.POSITIVE_INFINITY;

  const lonScale = Math.cos((point.lat * Math.PI) / 180) * 111_320; // meters per lon degree at this latitude.
  let nearest = Number.POSITIVE_INFINITY;

  for (const sample of route) {
    nearest = Math.min(
      nearest,
      Math.hypot(
        (sample.lat - point.lat) * 111_320, // approximate meters per latitude degree.
        (sample.lon - point.lon) * lonScale
      )
    );
  }

  return nearest;
}
