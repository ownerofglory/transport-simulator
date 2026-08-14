import * as THREE from 'three';
import type { GuidewayKind } from '../../domain/transport';

/**
 * Shared tunnel bore construction used by both the simulator (GuidewayLayer)
 * and live follow (LiveTunnelLayer), so the two never drift apart.
 *
 * The section is modelled on German Stadtbahn practice: a flat trackbed with a
 * raised walkway either side, near-vertical haunches, and either a mined arched
 * crown or a cut-and-cover flat slab. Dimensions are per-metre real values —
 * a twin-track bore is ~9.4 m wide and ~5.6 m over rail, not the 16 m pipe the
 * first implementation used.
 */

/** Mined bores get an arched crown; cut-and-cover boxes get a flat slab ceiling. */
export type TunnelSectionKind = 'arched' | 'box';

export type TunnelSectionSpec = {
  halfWidthM: number;
  /** Height of the wall/haunch where the crown springs from. */
  springlineM: number;
  /** Inner height at the centre of the crown, above rail level. */
  crownM: number;
  /** Half-width of the lowered trackbed between the two walkways. */
  trackbedHalfWidthM: number;
  /** Walkway top surface, above rail level. */
  walkwayM: number;
  /** Contact wire height above rail; 0 disables the catenary. */
  contactWireM: number;
  luminaireSpacingM: number;
};

const SECTIONS: Partial<Record<GuidewayKind, TunnelSectionSpec>> = {
  stadtbahn: {
    halfWidthM: 4.7,
    springlineM: 2.9,
    crownM: 5.6,
    trackbedHalfWidthM: 3.7,
    walkwayM: 0.55,
    contactWireM: 4.3,
    luminaireSpacingM: 11
  },
  's-bahn': {
    halfWidthM: 5.3,
    springlineM: 3.2,
    crownM: 6.4,
    trackbedHalfWidthM: 4.3,
    walkwayM: 0.6,
    contactWireM: 5.1,
    luminaireSpacingM: 13
  },
  zacke: {
    halfWidthM: 3.4,
    springlineM: 2.4,
    crownM: 4.6,
    trackbedHalfWidthM: 2.5,
    walkwayM: 0.5,
    contactWireM: 3.6,
    luminaireSpacingM: 10
  }
};

const DEFAULT_SECTION = SECTIONS.stadtbahn as TunnelSectionSpec;

export function tunnelSectionFor(guidewayKind: GuidewayKind): TunnelSectionSpec {
  return SECTIONS[guidewayKind] ?? DEFAULT_SECTION;
}

/**
 * Long runs read as mined/bored tunnel (arched), short ones as cut-and-cover
 * box — which is how these were actually built, and gives the network visual
 * variety without inventing per-route data.
 */
export function tunnelSectionKindFor(lengthM: number): TunnelSectionKind {
  return lengthM > 420 ? 'arched' : 'box';
}

/**
 * Inner outline of the bore in the lateral/vertical plane, as a closed loop in
 * metres relative to rail level at the track centreline. Walking order matters:
 * consecutive points become quads when swept.
 */
function sectionProfile(spec: TunnelSectionSpec, kind: TunnelSectionKind): THREE.Vector2[] {
  const { halfWidthM: hw, trackbedHalfWidthM: bed, walkwayM: walk, springlineM, crownM } = spec;
  const points: THREE.Vector2[] = [
    new THREE.Vector2(-bed, 0), // trackbed floor, left
    new THREE.Vector2(bed, 0), // trackbed floor, right
    new THREE.Vector2(bed, walk), // walkway riser, right
    new THREE.Vector2(hw, walk), // walkway top, right
    new THREE.Vector2(hw, springlineM) // right haunch
  ];

  if (kind === 'arched') {
    // Semi-ellipse from the right haunch over to the left one.
    const arcSteps = 10;
    const rise = crownM - springlineM;
    for (let i = 1; i < arcSteps; i++) {
      const angle = (i / arcSteps) * Math.PI;
      points.push(new THREE.Vector2(Math.cos(angle) * hw, springlineM + Math.sin(angle) * rise));
    }
  } else {
    // Cut-and-cover slab with a small haunch chamfer at each corner.
    const chamfer = 0.35;
    points.push(new THREE.Vector2(hw, crownM - chamfer));
    points.push(new THREE.Vector2(hw - chamfer, crownM));
    points.push(new THREE.Vector2(-hw + chamfer, crownM));
    points.push(new THREE.Vector2(-hw, crownM - chamfer));
  }

  points.push(new THREE.Vector2(-hw, springlineM)); // left haunch
  points.push(new THREE.Vector2(-hw, walk)); // walkway top, left
  points.push(new THREE.Vector2(-bed, walk)); // walkway riser, left
  points.push(points[0].clone()); // close the loop back onto the trackbed
  return points;
}

/** Right-handed frame at a curve sample, with lateral kept horizontal so gradients don't twist the bore. */
function frameAt(curve: THREE.Curve<THREE.Vector3>, t: number, lateral: THREE.Vector3, up: THREE.Vector3): void {
  const tangent = curve.getTangentAt(t);
  lateral.set(tangent.z, 0, -tangent.x);
  if (lateral.lengthSq() < 1e-8) lateral.set(1, 0, 0);
  lateral.normalize();
  // tangent x lateral (not the reverse) keeps the basis right-handed, so the
  // section is swept upright rather than mirrored below the track.
  up.crossVectors(tangent, lateral).normalize();
}

/**
 * Sweeps the section along the bore centreline. The winding puts face normals
 * on the inside of the shell, which both lights the interior correctly and
 * back-face culls the bore when viewed from above ground.
 */
function sweepSection(
  curve: THREE.Curve<THREE.Vector3>,
  profile: THREE.Vector2[],
  rings: number,
  lengthM: number
): THREE.BufferGeometry {
  const ringCount = rings + 1;
  const profileCount = profile.length;
  const positions = new Float32Array(ringCount * profileCount * 3);
  const uvs = new Float32Array(ringCount * profileCount * 2);
  const indices: number[] = [];

  // Perimeter distance drives the U coordinate so the concrete texture keeps a
  // constant real-world scale around walls, crown, and walkways alike.
  const perimeter: number[] = [0];
  for (let i = 1; i < profileCount; i++) {
    perimeter.push(perimeter[i - 1] + profile[i].distanceTo(profile[i - 1]));
  }

  const point = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  const up = new THREE.Vector3();

  for (let ring = 0; ring < ringCount; ring++) {
    const t = ring / rings;
    curve.getPointAt(t, point);
    frameAt(curve, t, lateral, up);
    const v = (t * lengthM) / 6; // ~6 m texture repeat along the bore.

    for (let i = 0; i < profileCount; i++) {
      const offset = (ring * profileCount + i) * 3;
      const profilePoint = profile[i];
      positions[offset] = point.x + lateral.x * profilePoint.x + up.x * profilePoint.y;
      positions[offset + 1] = point.y + lateral.y * profilePoint.x + up.y * profilePoint.y;
      positions[offset + 2] = point.z + lateral.z * profilePoint.x + up.z * profilePoint.y;

      const uvOffset = (ring * profileCount + i) * 2;
      uvs[uvOffset] = perimeter[i] / 4;
      uvs[uvOffset + 1] = v;
    }
  }

  for (let ring = 0; ring < rings; ring++) {
    for (let i = 0; i < profileCount - 1; i++) {
      const a = ring * profileCount + i;
      const b = a + 1;
      const c = a + profileCount;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Headwall closing the ground around the bore mouth, so a portal reads as an
 * opening in a concrete face instead of the end of an invisible pipe.
 */
function portalHeadwall(profile: THREE.Vector2[], spec: TunnelSectionSpec): THREE.BufferGeometry {
  const margin = 3.4;
  const outer = new THREE.Shape();
  outer.moveTo(-spec.halfWidthM - margin, -1.5);
  outer.lineTo(spec.halfWidthM + margin, -1.5);
  outer.lineTo(spec.halfWidthM + margin, spec.crownM + margin);
  outer.lineTo(-spec.halfWidthM - margin, spec.crownM + margin);
  outer.closePath();

  const hole = new THREE.Path();
  hole.moveTo(profile[0].x, profile[0].y);
  for (let i = 1; i < profile.length; i++) hole.lineTo(profile[i].x, profile[i].y);
  hole.closePath();
  outer.holes.push(hole);

  return new THREE.ShapeGeometry(outer);
}

/** Concrete lining, walkway, portal, luminaire, and cable materials, built once per bore set. */
export type TunnelMaterials = {
  lining: THREE.MeshStandardMaterial;
  portal: THREE.MeshStandardMaterial;
  luminaire: THREE.MeshBasicMaterial;
  fitting: THREE.MeshStandardMaterial;
  wire: THREE.MeshStandardMaterial;
  dispose(): void;
};

/**
 * Streaked, patchy concrete. Generated once into a canvas rather than shipped
 * as an asset, and shared by every bore in a route.
 */
function concreteTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#8e8b85';
    ctx.fillRect(0, 0, size, size);
    // Vertical water/dirt streaks, the dominant feature of an old concrete lining.
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * size;
      const width = 1 + Math.random() * 6;
      const shade = 118 + Math.random() * 42;
      ctx.fillStyle = `rgba(${shade}, ${shade - 3}, ${shade - 8}, ${0.12 + Math.random() * 0.3})`;
      ctx.fillRect(x, Math.random() * size * 0.4, width, size);
    }
    // Formwork/segment joints across the bore.
    ctx.fillStyle = 'rgba(72, 70, 66, 0.55)';
    for (const y of [0, size / 2]) ctx.fillRect(0, y, size, 2);
    // Patchy staining.
    for (let i = 0; i < 40; i++) {
      const shade = 96 + Math.random() * 60;
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade - 6}, 0.16)`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, 6 + Math.random() * 26, 10 + Math.random() * 40, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createTunnelMaterials(): TunnelMaterials {
  const map = concreteTexture();
  const lining = new THREE.MeshStandardMaterial({
    map,
    color: 0x8a8781,
    roughness: 0.97,
    metalness: 0
    // Front side: the swept shell already has its normals facing inward.
  });
  const portal = new THREE.MeshStandardMaterial({ map, color: 0x7d7a75, roughness: 0.96, side: THREE.DoubleSide });
  const luminaire = new THREE.MeshBasicMaterial({ color: 0xfff0cf });
  const fitting = new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.7, metalness: 0.3 });
  const wire = new THREE.MeshStandardMaterial({ color: 0x6a6257, roughness: 0.5, metalness: 0.6 });

  return {
    lining,
    portal,
    luminaire,
    fitting,
    wire,
    dispose() {
      map.dispose();
      lining.dispose();
      portal.dispose();
      luminaire.dispose();
      fitting.dispose();
      wire.dispose();
    }
  };
}

export type TunnelBoreOptions = {
  curve: THREE.Curve<THREE.Vector3>;
  lengthM: number;
  guidewayKind: GuidewayKind;
  materials: TunnelMaterials;
  /** Headwalls cap real tunnel mouths; a bore running into a station box has none. */
  portalStart?: boolean;
  portalEnd?: boolean;
};

/**
 * Builds one tunnel bore: lining shell, ceiling luminaires, wall cable runs,
 * contact wire with droppers, and portal headwalls. Everything is returned in a
 * single group whose geometries the caller disposes.
 */
export function buildTunnelBore(options: TunnelBoreOptions): THREE.Group {
  const { curve, lengthM, guidewayKind, materials } = options;
  const group = new THREE.Group();
  group.name = 'Tunnel bore';

  const spec = tunnelSectionFor(guidewayKind);
  const kind = tunnelSectionKindFor(lengthM);
  const profile = sectionProfile(spec, kind);
  // ~8 m between rings keeps curved bores smooth without exploding vertex count.
  const rings = THREE.MathUtils.clamp(Math.ceil(lengthM / 8), 12, 900);

  const lining = new THREE.Mesh(sweepSection(curve, profile, rings, lengthM), materials.lining);
  lining.name = `Tunnel lining (${kind})`;
  group.add(lining);

  buildLuminaires(group, curve, lengthM, spec, kind, materials);
  buildServices(group, curve, lengthM, spec, materials);

  const portalEnds = [options.portalStart !== false ? 0 : -1, options.portalEnd !== false ? 1 : -1].filter((t) => t >= 0);
  if (portalEnds.length > 0) {
    const headwall = portalHeadwall(profile, spec);
    const lateral = new THREE.Vector3();
    const up = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    for (const t of portalEnds) {
      const wall = new THREE.Mesh(headwall.clone(), materials.portal);
      frameAt(curve, t, lateral, up);
      const tangent = curve.getTangentAt(t);
      // Headwall plane spans lateral/up with its normal along the bore.
      matrix.makeBasis(lateral, up, tangent);
      wall.quaternion.setFromRotationMatrix(matrix);
      wall.position.copy(curve.getPointAt(t));
      wall.name = 'Tunnel portal headwall';
      group.add(wall);
    }
    headwall.dispose();
  }

  return group;
}

/**
 * Ceiling luminaires on a fixed spacing. These are emissive-looking only; the
 * actual illumination comes from the lamp rig that follows the vehicle, so the
 * scene never carries hundreds of real lights.
 */
function buildLuminaires(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  lengthM: number,
  spec: TunnelSectionSpec,
  kind: TunnelSectionKind,
  materials: TunnelMaterials
): void {
  const count = THREE.MathUtils.clamp(Math.floor(lengthM / spec.luminaireSpacingM), 2, 400);
  if (count < 2) return;

  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.1, 1.5), materials.luminaire, count);
  const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.16, 1.7), materials.fitting, count);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  const up = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  // Fixtures hang just inside the haunch on one side, as in the real bores.
  const sideOffset = spec.halfWidthM - 0.5;
  const height = kind === 'arched' ? spec.springlineM + 0.9 : spec.crownM - 0.25;

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    curve.getPointAt(t, position);
    frameAt(curve, t, lateral, up);
    const tangent = curve.getTangentAt(t);
    basis.makeBasis(lateral, up, tangent);
    quaternion.setFromRotationMatrix(basis);

    position.addScaledVector(lateral, sideOffset).addScaledVector(up, height);
    matrix.compose(position, quaternion, scale);
    lamps.setMatrixAt(i, matrix);

    position.addScaledVector(up, 0.11);
    matrix.compose(position, quaternion, scale);
    housings.setMatrixAt(i, matrix);
  }

  lamps.instanceMatrix.needsUpdate = true;
  housings.instanceMatrix.needsUpdate = true;
  lamps.name = 'Tunnel luminaires';
  housings.name = 'Tunnel luminaire housings';
  group.add(lamps, housings);
}

/** Wall cable runs and the overhead contact wire with its droppers. */
function buildServices(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  lengthM: number,
  spec: TunnelSectionSpec,
  materials: TunnelMaterials
): void {
  const samples = THREE.MathUtils.clamp(Math.ceil(lengthM / 12), 8, 300);
  const lateral = new THREE.Vector3();
  const up = new THREE.Vector3();

  const offsetCurve = (lateralM: number, upM: number): THREE.CatmullRomCurve3 => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = curve.getPointAt(t);
      frameAt(curve, t, lateral, up);
      points.push(point.addScaledVector(lateral, lateralM).addScaledVector(up, upM));
    }
    return new THREE.CatmullRomCurve3(points, false, 'centripetal');
  };

  // Cable bundles clipped to the wall, both sides.
  for (const side of [-1, 1]) {
    for (const height of [spec.springlineM - 0.55, spec.springlineM - 0.85]) {
      const cable = offsetCurve(side * (spec.halfWidthM - 0.16), height);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(cable, samples, 0.055, 5, false), materials.fitting);
      mesh.name = 'Tunnel cable run';
      group.add(mesh);
    }
  }

  if (spec.contactWireM <= 0) return;

  // One contact wire over each track, with droppers up to the crown.
  for (const trackOffset of [-2.1, 2.1]) {
    const wireCurve = offsetCurve(trackOffset, spec.contactWireM);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(wireCurve, samples, 0.035, 4, false), materials.wire);
    wire.name = 'Tunnel contact wire';
    group.add(wire);
  }

  const dropperCount = THREE.MathUtils.clamp(Math.floor(lengthM / 14), 2, 260);
  const droppers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 1, 0.04), materials.wire, dropperCount * 2);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const dropHeight = Math.max(0.25, spec.crownM - 0.3 - spec.contactWireM);

  for (let i = 0; i < dropperCount; i++) {
    const t = (i + 0.5) / dropperCount;
    frameAt(curve, t, lateral, up);
    const tangent = curve.getTangentAt(t);
    basis.makeBasis(lateral, up, tangent);
    quaternion.setFromRotationMatrix(basis);
    scale.set(1, dropHeight, 1);

    for (const [index, trackOffset] of [-2.1, 2.1].entries()) {
      curve.getPointAt(t, position);
      position.addScaledVector(lateral, trackOffset).addScaledVector(up, spec.contactWireM + dropHeight / 2);
      matrix.compose(position, quaternion, scale);
      droppers.setMatrixAt(i * 2 + index, matrix);
    }
  }

  droppers.instanceMatrix.needsUpdate = true;
  droppers.name = 'Tunnel catenary droppers';
  group.add(droppers);
}

/** Disposes every geometry under a bore group; materials are owned by the caller. */
export function disposeTunnelBore(group: THREE.Object3D): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
  });
}
