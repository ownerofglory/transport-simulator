import * as THREE from 'three';
import type { GuidewayKind } from '../../domain/transport';
import { BuilderRegistry } from '../../engine/builders/BuilderRegistry';
import { buildTunnelBore, createTunnelMaterials, type TunnelMaterials } from '../tunnels/tunnelSection';
import type { WorldLayerContext } from './WorldLayerContext';

/** Builds the running way (rails, bus street, ferry channel, guideway) and tunnels. */
export class GuidewayLayer {
  /** All meshes go under this group; the world adds it to the scene. */
  readonly root = new THREE.Group();
  // Per-guideway track builders; unmapped kinds fall back to rail track.
  private readonly trackBuilders = new BuilderRegistry<GuidewayKind, () => void>()
    .register('bus', () => this.buildBusRouteStreet())
    .register('ferry', () => this.buildFerryRoutePath())
    .register('schwebebahn', () => this.buildSchwebebahnGuideway())
    .register('zacke', () => this.buildMountainRailwayTrack())
    .register('seilbahn', () => this.buildMountainRailwayTrack());

  // Shared across every bore on the route so the concrete texture is built
  // once; TransitWorld disposes it with the rest of the scene graph.
  private tunnelMaterials: TunnelMaterials | null = null;
  // Lazily built arc-length parameter per control point.
  private controlPointArcT: number[] | null = null;

  constructor(private readonly ctx: WorldLayerContext) {}

  build(): void {
    this.buildTrack();
    this.buildTunnels();
  }

  private buildTrack(): void {
    (this.trackBuilders.resolveOptional(this.ctx.guidewayKind) ?? (() => this.buildRailTrack()))();
  }

  private buildRailTrack(): void {
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x7f858a, metalness: 0.7, roughness: 0.28 });
    const sleeperMaterial = new THREE.MeshStandardMaterial({ color: 0x453429, roughness: 0.85 });
    const ballastMaterial = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.95 });
    const trackSegments = THREE.MathUtils.clamp(Math.ceil(this.ctx.route.routeLengthM / 10), 480, 5000);

    for (const trackOffset of [this.ctx.activeLaneOffsetM, this.ctx.oppositeLaneOffsetM]) {
      const ballast = new THREE.Mesh(this.ctx.makeTrackStrip(trackOffset, 4.5, trackSegments), ballastMaterial);
      ballast.receiveShadow = true;
      this.root.add(ballast);

      for (const railOffset of [-this.ctx.railGaugeM / 2, this.ctx.railGaugeM / 2]) {
        const points = this.ctx.offsetCurvePoints(trackOffset + railOffset, trackSegments, 0.22);
        const railCurve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, trackSegments, 0.08, 8), railMaterial);
        rail.castShadow = true;
        this.root.add(rail);
      }
    }

    const sleeperGeo = new THREE.BoxGeometry(this.ctx.guidewayKind === 's-bahn' ? 2.65 : 3.2, 0.15, 0.55);
    const sleeperCount = THREE.MathUtils.clamp(Math.ceil(this.ctx.route.routeLengthM / 8), 240, 4000);
    for (const trackOffset of [this.ctx.activeLaneOffsetM, this.ctx.oppositeLaneOffsetM]) {
      const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMaterial, sleeperCount);
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      for (let i = 0; i < sleeperCount; i++) {
        const t = i / Math.max(1, sleeperCount - 1);
        const p = this.ctx.curve.getPointAt(t).add(this.ctx.normalAt(t).multiplyScalar(trackOffset));
        const tangent = this.ctx.curve.getTangentAt(t).normalize();
        const yaw = Math.atan2(tangent.x, tangent.z);
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2);
        matrix.compose(p.add(new THREE.Vector3(0, 0.08, 0)), rotation, new THREE.Vector3(1, 1, 1));
        sleepers.setMatrixAt(i, matrix);
      }
      sleepers.instanceMatrix.needsUpdate = true;
      sleepers.receiveShadow = true;
      sleepers.name = 'Curve-aligned sleepers';
      this.root.add(sleepers);
    }
  }

  private buildMountainRailwayTrack(): void {
    const rail = new THREE.MeshStandardMaterial({ color: 0x858b8e, metalness: 0.72, roughness: 0.3 });
    const sleeper = new THREE.MeshStandardMaterial({ color: 0x493a2d, roughness: 0.9 });
    const rack = new THREE.MeshStandardMaterial({ color: 0x555b5e, metalness: 0.65, roughness: 0.4 });
    const ballast = new THREE.Mesh(this.ctx.makeTrackStrip(0, 3.1, 220), new THREE.MeshStandardMaterial({ color: 0x66645f, roughness: 1 }));
    this.root.add(ballast);
    for (const offset of [-0.5, 0.5]) {
      const line = new THREE.CatmullRomCurve3(this.ctx.offsetCurvePoints(offset, 240, 0.22));
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(line, 240, 0.07, 7), rail));
    }
    const count = Math.max(80, Math.min(520, Math.floor(this.ctx.route.routeLengthM / (this.ctx.guidewayKind === 'zacke' ? 1.4 : 2.5))));
    const bars = new THREE.InstancedMesh(
      new THREE.BoxGeometry(this.ctx.guidewayKind === 'zacke' ? 1.05 : 2.15, 0.12, 0.22),
      this.ctx.guidewayKind === 'zacke' ? rack : sleeper,
      count
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < count; index++) {
      const t = index / Math.max(1, count - 1);
      const point = this.ctx.curve.getPointAt(t).add(new THREE.Vector3(0, 0.13, 0));
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tangent.x, tangent.z) + Math.PI / 2);
      matrix.compose(point, rotation, new THREE.Vector3(1, 1, 1));
      bars.setMatrixAt(index, matrix);
    }
    bars.name = this.ctx.guidewayKind === 'zacke' ? 'Zacke center rack' : 'Seilbahn sleepers';
    bars.instanceMatrix.needsUpdate = true;
    this.root.add(bars);
    if (this.ctx.guidewayKind === 'seilbahn') {
      const cableCurve = new THREE.CatmullRomCurve3(this.ctx.offsetCurvePoints(0, 240, 0.34));
      const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 240, 0.035, 5), rack);
      cable.name = 'Funicular haul cable';
      this.root.add(cable);
    }
  }

  private buildSchwebebahnGuideway(): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x7b858c, roughness: 0.42, metalness: 0.65 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x4c565d, roughness: 0.46, metalness: 0.55 });
    const deck = new THREE.MeshStandardMaterial({ color: 0x9aa1a5, roughness: 0.56, metalness: 0.32 });

    for (const offset of [this.ctx.activeLaneOffsetM, this.ctx.oppositeLaneOffsetM]) {
      const beam = new THREE.Mesh(this.ctx.makeRouteStrip(offset, 0.8, 0, 1, 420, 2.55), steel);
      beam.name = 'Schwebebahn running beam';
      beam.castShadow = true;
      this.root.add(beam);

      const rail = new THREE.Mesh(this.ctx.makeRouteStrip(offset, 0.16, 0, 1, 420, 2.84), darkSteel);
      rail.name = 'Schwebebahn upper guide rail';
      this.root.add(rail);
    }

    const maintenanceWalkway = new THREE.Mesh(this.ctx.makeRouteStrip(0, 4.2, 0, 1, 360, 2.2), deck);
    maintenanceWalkway.name = 'Schwebebahn maintenance deck';
    maintenanceWalkway.receiveShadow = true;
    this.root.add(maintenanceWalkway);

    const supportCount = THREE.MathUtils.clamp(Math.ceil(this.ctx.route.routeLengthM / 18), 32, 1200);
    const columns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 1, 0.38), steel, supportCount * 2);
    const crossheads = new THREE.InstancedMesh(new THREE.BoxGeometry(3.9, 0.28, 0.7), darkSteel, supportCount);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const identity = new THREE.Vector3(1, 1, 1);
    const columnScale = new THREE.Vector3(1, 1, 1);

    for (let index = 0; index < supportCount; index++) {
      const t = index / Math.max(1, supportCount - 1);
      const center = this.ctx.curve.getPointAt(t);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const groundY = this.ctx.surfaceHeightAt(t);
      const columnHeight = Math.max(4.5, center.y - groundY + 2.5);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

      for (const [columnIndex, offset] of [this.ctx.activeLaneOffsetM, this.ctx.oppositeLaneOffsetM].entries()) {
        const position = center.clone().add(this.ctx.normalAt(t).multiplyScalar(offset));
        position.y = groundY + columnHeight / 2;
        columnScale.set(1, columnHeight, 1);
        matrix.compose(position, rotation, columnScale);
        columns.setMatrixAt(index * 2 + columnIndex, matrix);
      }

      const crossheadPosition = center.clone().add(new THREE.Vector3(0, 2.48, 0));
      matrix.compose(crossheadPosition, rotation, identity);
      crossheads.setMatrixAt(index, matrix);
    }

    columns.instanceMatrix.needsUpdate = true;
    columns.castShadow = true;
    columns.receiveShadow = true;
    columns.name = 'Schwebebahn support columns';
    this.root.add(columns);

    crossheads.instanceMatrix.needsUpdate = true;
    crossheads.castShadow = true;
    crossheads.receiveShadow = true;
    crossheads.name = 'Schwebebahn support crossheads';
    this.root.add(crossheads);
  }

  private buildBusRouteStreet(): void {
    const asphaltMaterial = new THREE.MeshStandardMaterial({
      color: 0x50575c,
      roughness: 0.94,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const sidewalkMaterial = new THREE.MeshStandardMaterial({
      color: 0x989995,
      roughness: 0.98,
      polygonOffset: true,
      polygonOffsetFactor: -1
    });
    const markingMaterial = new THREE.MeshStandardMaterial({
      color: 0xeee5c6,
      roughness: 0.75,
      emissive: 0x342f20,
      emissiveIntensity: 0.18
    });

    const street = new THREE.Mesh(this.ctx.makeRouteStrip(0, 9.2, 0, 1, 420, 0.2), asphaltMaterial);
    street.name = `GTFS bus street corridor ${this.ctx.route.line}`;
    street.receiveShadow = true;
    street.renderOrder = 2;
    this.root.add(street);

    for (const side of [-1, 1]) {
      const sidewalk = new THREE.Mesh(this.ctx.makeRouteStrip(side * 5.45, 2.2, 0, 1, 360, 0.24), sidewalkMaterial);
      sidewalk.name = `Bus corridor sidewalk ${side}`;
      sidewalk.receiveShadow = true;
      sidewalk.renderOrder = 1;
      this.root.add(sidewalk);
    }

    const dashSpacingM = 16;
    const dashCount = THREE.MathUtils.clamp(Math.floor(this.ctx.route.routeLengthM / dashSpacingM), 24, 620);
    const markings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.025, 4.2), markingMaterial, dashCount);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < dashCount; index++) {
      const t = (index + 0.5) / dashCount;
      const position = this.ctx.curve.getPointAt(t).add(new THREE.Vector3(0, 0.28, 0));
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tangent.x, tangent.z));
      matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
      markings.setMatrixAt(index, matrix);
    }
    markings.name = 'GTFS bus corridor center markings';
    markings.instanceMatrix.needsUpdate = true;
    markings.renderOrder = 3;
    this.root.add(markings);
  }

  private buildFerryRoutePath(): void {
    const wakeMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4e8ef,
      roughness: 0.24,
      emissive: 0x5b9cc0,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.72
    });
    const channelMaterial = new THREE.MeshStandardMaterial({
      color: 0x76b3cd,
      roughness: 0.42,
      transparent: true,
      opacity: 0.28
    });
    const path = new THREE.Mesh(this.ctx.makeRouteStrip(0, 10.5, 0, 1, 320, 0.18), channelMaterial);
    path.name = `Ferry route channel ${this.ctx.route.line}`;
    path.renderOrder = 1;
    this.root.add(path);

    const wakeCount = THREE.MathUtils.clamp(Math.floor(this.ctx.route.routeLengthM / 55), 18, 220);
    const wakes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.04, 7.5), wakeMaterial, wakeCount);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < wakeCount; index++) {
      const t = (index + 0.5) / wakeCount;
      const position = this.ctx.curve.getPointAt(t).add(new THREE.Vector3(0, 0.24, 0));
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tangent.x, tangent.z));
      matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
      wakes.setMatrixAt(index, matrix);
    }
    wakes.instanceMatrix.needsUpdate = true;
    wakes.renderOrder = 2;
    wakes.name = 'Ferry wake markers';
    this.root.add(wakes);
  }

  private buildTunnels(): void {
    if (this.ctx.guidewayKind === 'bus' || this.ctx.guidewayKind === 'ferry' || this.ctx.guidewayKind === 'schwebebahn') return;
    const mask = this.ctx.route.tunnelMask;
    if (!mask || !mask.some(Boolean)) return;

    this.tunnelMaterials ??= createTunnelMaterials();

    for (const [start, end] of this.ctx.maskRanges(mask)) {
      if (end - start < 1) continue;
      // Mask indices address control points, so they must be converted to the
      // curve's arc-length parameter before they can be compared with station
      // distances or sampled with getPointAt.
      const rangeStartT = this.arcTAtControlIndex(start - 1);
      const rangeEndT = this.arcTAtControlIndex(end + 1);

      // The bore runs between station boxes, not through them: an underground
      // station has its own hall, and a bore driven across it would wall the
      // platforms off behind the lining.
      const spans = this.tunnelSpansBetweenStations(rangeStartT, rangeEndT);
      for (const [startT, endT] of spans) {
        // Sample the actual route spline instead of re-smoothing raw control
        // points: a separately smoothed bore drifts off the track on tight
        // bends, pushing one wall into the train and camera.
        const lengthM = (endT - startT) * this.ctx.route.routeLengthM;
        const sampleCount = THREE.MathUtils.clamp(Math.ceil(lengthM / 9), 12, 400);
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= sampleCount; i++) {
          points.push(this.ctx.curve.getPointAt(startT + ((endT - startT) * i) / sampleCount));
        }
        this.root.add(
          buildTunnelBore({
            curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
            lengthM,
            guidewayKind: this.ctx.guidewayKind,
            materials: this.tunnelMaterials,
            // Only the real tunnel mouths get a headwall; the ends that were cut
            // for a station open straight into that station's hall.
            portalStart: startT === rangeStartT,
            portalEnd: endT === rangeEndT
          })
        );
      }
    }
  }

  /**
   * Arc-length parameter of a control point, so tunnel mask indices, station
   * distances, and curve sampling all share one space. Control points are not
   * evenly spaced by distance, so index/count is not a usable approximation.
   */
  private arcTAtControlIndex(index: number): number {
    if (!this.controlPointArcT) {
      const points = this.ctx.route.controlPoints;
      const cumulative = [0];
      for (let i = 1; i < points.length; i++) {
        const [ax, ay, az] = points[i - 1];
        const [bx, by, bz] = points[i];
        cumulative.push(cumulative[i - 1] + Math.hypot(bx - ax, by - ay, bz - az));
      }
      const total = cumulative[cumulative.length - 1] || 1;
      this.controlPointArcT = cumulative.map((distance) => distance / total);
    }
    const clamped = THREE.MathUtils.clamp(index, 0, this.controlPointArcT.length - 1);
    return this.controlPointArcT[clamped];
  }

  /**
   * Splits a masked tunnel range into the spans between underground stations,
   * leaving a gap the length of the station hall at each stop.
   */
  private tunnelSpansBetweenStations(startT: number, endT: number): Array<[number, number]> {
    const routeLengthM = this.ctx.route.routeLengthM;
    // Hall lengths come from the station builders: the S-Bahn box is 155 m long,
    // the Stadtbahn one 82 m. The bore has to stop clear of whichever is built,
    // or the lining closes over the platforms.
    const halfHallT = (this.ctx.guidewayKind === 's-bahn' ? 88 : 46) / routeLengthM;
    const spans: Array<[number, number]> = [];
    const stationTs = this.ctx.route.stations
      .map((station) => station.distanceM / routeLengthM)
      .filter((t) => t > startT - halfHallT && t < endT + halfHallT)
      .sort((a, b) => a - b);

    let cursor = startT;
    for (const stationT of stationTs) {
      if (stationT - halfHallT > cursor) spans.push([cursor, Math.min(stationT - halfHallT, endT)]);
      cursor = Math.max(cursor, stationT + halfHallT);
    }
    if (cursor < endT) spans.push([cursor, endT]);

    // Drop slivers too short to read as tunnel.
    return spans.filter(([from, to]) => (to - from) * routeLengthM > 12);
  }
}
