import * as THREE from 'three';
import { makeLabelTexture } from '../../labels';
import type { GuidewayKind } from '../../domain/transport';
import { BuilderRegistry } from '../../engine/builders/BuilderRegistry';
import { createStationStyleRegistry, resolveStationPlacement } from '../stations';
import type { StationStyleProvider } from '../stations';
import type { WorldLayerContext } from './WorldLayerContext';

/** Builds platforms, canopies, signage, and stops for every guideway type. */
export class StationLayer {
  /** All meshes go under this group; the world adds it to the scene. */
  readonly root = new THREE.Group();
  // Data-driven station styles selected by the active mode's stationStyleId.
  // Modes without a registered style fall back to the per-guideway builders.
  private readonly styleRegistry = createStationStyleRegistry();
  // Per-guideway station builders; unmapped kinds fall back to rail stations.
  private readonly builders = new BuilderRegistry<GuidewayKind, () => void>()
    .register('bus', () => this.buildBusStops())
    .register('ferry', () => this.buildFerryStops())
    .register('schwebebahn', () => this.buildSchwebebahnStations())
    .register('s-bahn', () => this.buildSbahnStations())
    .register('zacke', () => this.buildMountainRailwayStops())
    .register('seilbahn', () => this.buildMountainRailwayStops());

  constructor(private readonly ctx: WorldLayerContext) {}

  build(): void {
    const style = this.resolveStationStyle();
    if (style) {
      this.buildStyledStations(style);
      return;
    }
    this.builders.resolve(this.ctx.guidewayKind)();
  }

  // Prefer the mode's explicit stationStyleId; otherwise every stadtbahn-guideway
  // city (Odessa/Ulm/… trams, not just Stuttgart) falls back to the vvs-stadtbahn
  // provider, which is the generic light-rail design the legacy buildRailStations
  // produced. Non-rail guideways use their dedicated builders.
  private resolveStationStyle(): StationStyleProvider | undefined {
    const explicit = this.styleRegistry.resolveOptional(this.ctx.stationStyleId);
    if (explicit) return explicit;
    if (this.ctx.guidewayKind === 'stadtbahn') return this.styleRegistry.resolveOptional('vvs-stadtbahn');
    return undefined;
  }

  // Coordinator path for data-driven station styles: resolve placement + a
  // visual definition per stop, then let the provider build it.
  private buildStyledStations(style: StationStyleProvider): void {
    const buildContext = { layer: this.ctx, root: this.root };
    this.ctx.route.stations.forEach((station, index) => {
      const placement = resolveStationPlacement(station, index, this.ctx);
      const definition = style.resolve(station, { layer: this.ctx, placement });
      style.build(definition, placement, buildContext);
    });
  }

  private buildSbahnStations(): void {
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xb6b3aa, roughness: 0.96 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x777a7b, roughness: 0.9 });
    const tactileMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e4d3, roughness: 0.94 });
    const dbBlue = new THREE.MeshStandardMaterial({ color: 0x173f73, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x747b7f, roughness: 0.45, metalness: 0.55 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xaacbd4, transparent: true, opacity: 0.34, roughness: 0.1, side: THREE.DoubleSide });
    const displayMaterial = new THREE.MeshBasicMaterial({ color: 0x101417 });
    const undergroundMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c8c3, roughness: 0.9 });

    for (const station of this.ctx.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.ctx.route.routeLengthM, 0, 1);
      const halfLengthM = 78;
      const startT = THREE.MathUtils.clamp((station.distanceM - halfLengthM) / this.ctx.route.routeLengthM, 0, 1);
      const endT = THREE.MathUtils.clamp((station.distanceM + halfLengthM) / this.ctx.route.routeLengthM, 0, 1);
      const center = this.ctx.curve.getPointAt(t);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const underground = this.ctx.stationIsUnderground(t);
      const stationGroup = new THREE.Group();
      stationGroup.name = `DB S-Bahn station ${station.name}`;
      stationGroup.position.copy(center);
      stationGroup.rotation.y = yaw;
      this.root.add(stationGroup);

      for (const side of [-1, 1]) {
        const platform = new THREE.Mesh(this.ctx.makeRouteStrip(side * 6.25, 5.7, startT, endT, 72, 0.28), platformMaterial);
        platform.receiveShadow = true;
        platform.name = `S-Bahn 96cm platform ${station.name}`;
        this.root.add(platform);
        const edge = new THREE.Mesh(this.ctx.makeRouteStrip(side * 3.55, 0.35, startT, endT, 76, 0.31), edgeMaterial);
        this.root.add(edge);
        const tactile = new THREE.Mesh(this.ctx.makeRouteStrip(side * 3.95, 0.55, startT, endT, 76, 0.335), tactileMaterial);
        this.root.add(tactile);

        for (const z of [-48, 0, 48]) {
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(5.8, 0.88),
            new THREE.MeshBasicMaterial({ map: makeLabelTexture(station.name, { width: 768, height: 128, bg: '#164279', fg: '#fff' }), side: THREE.DoubleSide })
          );
          sign.position.set(side * 7.55, 2.65, z);
          sign.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          stationGroup.add(sign);
          this.ctx.stationMarkers.push(sign);
        }

        const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 28), steel);
        canopy.position.set(side * 6.55, 4.15, 5);
        stationGroup.add(canopy);
        const glassBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.45, 18), glass);
        glassBack.position.set(side * 8.3, 2.35, 5);
        stationGroup.add(glassBack);
        for (const z of [-7, 5, 17]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.4, 0.14), steel);
          post.position.set(side * 6.55, 2.25, z);
          stationGroup.add(post);
        }

        const dfi = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 3.6), displayMaterial);
        dfi.position.set(side * 6.5, 3.45, -15);
        stationGroup.add(dfi);
        const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.08, 24), new THREE.MeshBasicMaterial({ color: 0xf7f7f2 }));
        clock.rotation.z = Math.PI / 2;
        clock.position.set(side * 6.5, 3.45, 22);
        stationGroup.add(clock);
        const sBadge = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture('S', { width: 256, height: 256, bg: '#07864b', fg: '#fff' }) }));
        sBadge.position.set(side * 7.1, 4.7, -24);
        sBadge.scale.set(2.2, 2.2, 1);
        stationGroup.add(sBadge);
      }

      if (underground) {
        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(24, 0.42, 155), undergroundMaterial);
        ceiling.position.y = 5.7;
        stationGroup.add(ceiling);
        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.38, 5.2, 155), undergroundMaterial);
          wall.position.set(side * 11.7, 2.75, 0);
          stationGroup.add(wall);
        }
      }
    }
  }

  private buildMountainRailwayStops(): void {
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xb4b0a5, roughness: 0.95 });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x174a73, roughness: 0.55 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x70472c, roughness: 0.82 });
    for (const station of this.ctx.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.ctx.route.routeLengthM, 0, 1);
      const group = new THREE.Group();
      group.position.copy(this.ctx.curve.getPointAt(t));
      group.rotation.y = Math.atan2(this.ctx.curve.getTangentAt(t).x, this.ctx.curve.getTangentAt(t).z);
      const length = this.ctx.guidewayKind === 'seilbahn' ? 14 : 28;
      const platform = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, length), platformMaterial);
      platform.position.set(2.15, 0.08, 0);
      group.add(platform);
      const shelter = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 5.5), this.ctx.guidewayKind === 'seilbahn' ? wood : postMaterial);
      shelter.position.set(2.2, 3.05, 0);
      group.add(shelter);
      for (const z of [-2.4, 2.4]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), postMaterial);
        post.position.set(2.2, 1.55, z);
        group.add(post);
      }
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`${this.ctx.route.line}  ${station.name}`, { width: 768, height: 160, bg: '#174a73', fg: '#fff' }) }));
      sign.position.set(2.2, 3.75, 0);
      sign.scale.set(7, 1.45, 1);
      group.add(sign);
      this.ctx.stationMarkers.push(sign);
      this.root.add(group);
    }
  }

  private buildSchwebebahnStations(): void {
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c5bb, roughness: 0.94 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x777c7e, roughness: 0.88 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x5f6b73, roughness: 0.44, metalness: 0.58 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x245d85, roughness: 0.5, metalness: 0.24 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xb6d8e4,
      transparent: true,
      opacity: 0.32,
      roughness: 0.08,
      side: THREE.DoubleSide
    });

    for (const station of this.ctx.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.ctx.route.routeLengthM, 0, 1);
      const halfLengthM = 18;
      const startT = THREE.MathUtils.clamp((station.distanceM - halfLengthM) / this.ctx.route.routeLengthM, 0, 1);
      const endT = THREE.MathUtils.clamp((station.distanceM + halfLengthM) / this.ctx.route.routeLengthM, 0, 1);
      const center = this.ctx.curve.getPointAt(t);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);

      const platform = new THREE.Mesh(this.ctx.makeRouteStrip(0, 4.9, startT, endT, 42, -1.38), platformMaterial);
      platform.name = `Schwebebahn island platform ${station.name}`;
      platform.receiveShadow = true;
      this.root.add(platform);

      for (const edgeOffset of [-1.48, 1.48]) {
        const edge = new THREE.Mesh(this.ctx.makeRouteStrip(edgeOffset, 0.18, startT, endT, 44, -1.31), edgeMaterial);
        edge.name = `Schwebebahn platform edge ${station.name}`;
        this.root.add(edge);
      }

      const stationGroup = new THREE.Group();
      stationGroup.name = `Schwebebahn station hall ${station.name}`;
      stationGroup.position.copy(center);
      stationGroup.rotation.y = yaw;
      this.root.add(stationGroup);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.22, 19.5), steel);
      roof.position.set(0, 0.95, 0);
      roof.castShadow = true;
      stationGroup.add(roof);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 19.7), blue);
      ridge.position.set(0, 1.12, 0);
      stationGroup.add(ridge);

      for (const x of [-2.45, 2.45]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, 17.6), glass);
        wall.position.set(x, -0.22, 0);
        stationGroup.add(wall);
      }
      for (const z of [-7.8, 0, 7.8]) {
        for (const x of [-2.5, 2.5]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.8, 0.16), steel);
          post.position.set(x, -0.2, z);
          post.castShadow = true;
          stationGroup.add(post);
        }
      }

      const overheadBeam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.2, 0.55), steel);
      overheadBeam.position.set(0, 2.15, 0);
      stationGroup.add(overheadBeam);

      const signTexture = makeLabelTexture(`60  ${station.name}`, {
        width: 1024,
        height: 180,
        bg: '#174a73',
        fg: '#ffffff'
      });
      for (const z of [-6.4, 6.4]) {
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(4.8, 0.9),
          new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide })
        );
        sign.position.set(0, 0.2, z);
        sign.rotation.y = Math.PI / 2;
        stationGroup.add(sign);
        this.ctx.stationMarkers.push(sign);
      }

      const dfi = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 0.62),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture(`60  ${this.ctx.route.destination}`, { width: 768, height: 140, bg: '#111820', fg: '#ffb300' }), side: THREE.DoubleSide })
      );
      dfi.position.set(0, 0.02, -8.3);
      dfi.rotation.y = Math.PI;
      stationGroup.add(dfi);
    }
  }

  private buildBusStops(): void {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x4c555a, roughness: 0.58, metalness: 0.55 });
    const yellowMaterial = new THREE.MeshStandardMaterial({ color: 0xffdf00, roughness: 0.48 });
    const stopGreenMaterial = new THREE.MeshStandardMaterial({ color: 0x16723a, roughness: 0.5 });
    const shelterMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9dce7,
      transparent: true,
      opacity: 0.32,
      roughness: 0.1,
      side: THREE.DoubleSide
    });
    const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x234e68, roughness: 0.75 });

    for (const station of this.ctx.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.ctx.route.routeLengthM, 0, 1);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const normal = this.ctx.normalAt(t);
      const group = new THREE.Group();
      group.name = `Bus stop ${station.name}`;
      group.position.copy(this.ctx.curve.getPointAt(t)).add(normal.multiplyScalar(-7.2));
      group.rotation.y = Math.atan2(tangent.x, tangent.z);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 3.3, 10), poleMaterial);
      pole.position.y = 1.65;
      group.add(pole);
      const discBorder = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.075, 24), stopGreenMaterial);
      discBorder.rotation.z = Math.PI / 2;
      discBorder.position.set(0, 2.85, 0);
      group.add(discBorder);
      const hBadge = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture('H', { width: 256, height: 256, bg: '#ffdf00', fg: '#176f39' }) }));
      hBadge.position.set(0.06, 2.85, 0);
      hBadge.scale.set(0.65, 0.65, 1);
      group.add(hBadge);

      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(`${this.ctx.route.line}  ${station.name}`, { width: 768, height: 160, bg: '#174a73', fg: '#fff' })
      }));
      label.position.set(0, 3.65, 0);
      label.scale.set(7.2, 1.5, 1);
      group.add(label);

      const dfi = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 0.82),
        new THREE.MeshBasicMaterial({ map: makeLabelTexture(`${this.ctx.route.line}  ${this.ctx.route.destination}`, { width: 768, height: 140, bg: '#111820', fg: '#ffb300' }), side: THREE.DoubleSide })
      );
      dfi.position.set(-0.65, 3.18, 1.25);
      group.add(dfi);

      const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.25, 5.6), shelterMaterial);
      back.position.set(-1.7, 1.42, 2.8);
      group.add(back);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 5.8), poleMaterial);
      roof.position.set(-0.7, 2.58, 2.8);
      group.add(roof);
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.18, 5.95), yellowMaterial);
      fascia.position.set(-0.7, 2.68, 2.8);
      group.add(fascia);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 3.2), seatMaterial);
      seat.position.set(-1.25, 0.72, 2.8);
      group.add(seat);
      this.root.add(group);
      this.ctx.stationMarkers.push(label);
    }
  }

  private buildFerryStops(): void {
    const dockMaterial = new THREE.MeshStandardMaterial({ color: 0xb8b3a6, roughness: 0.96 });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x1f5e88, roughness: 0.56 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xe6ecee, roughness: 0.48 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0xb6dbe4,
      transparent: true,
      opacity: 0.3,
      roughness: 0.12,
      side: THREE.DoubleSide
    });
    for (const station of this.ctx.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.ctx.route.routeLengthM, 0, 1);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const normal = this.ctx.normalAt(t);
      const group = new THREE.Group();
      group.name = `Ferry dock ${station.name}`;
      group.position.copy(this.ctx.curve.getPointAt(t)).add(normal.multiplyScalar(6));
      group.rotation.y = Math.atan2(tangent.x, tangent.z);

      const pier = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 18), dockMaterial);
      pier.position.y = 0.08;
      group.add(pier);
      const pontoon = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.4, 8.5), dockMaterial);
      pontoon.position.set(0, -0.12, -4.2);
      group.add(pontoon);
      const shelterRoof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 5.4), roofMaterial);
      shelterRoof.position.set(0, 2.55, 3.1);
      group.add(shelterRoof);
      for (const x of [-1.2, 1.2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), postMaterial);
        post.position.set(x, 1.26, 3.1);
        group.add(post);
      }
      const glassBack = new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.8, 0.08), glassMaterial);
      glassBack.position.set(0, 1.55, 4.55);
      group.add(glassBack);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(`${this.ctx.route.line}  ${station.name}`, { width: 768, height: 160, bg: '#1f5e88', fg: '#ffffff' })
      }));
      sign.position.set(0, 3.3, 3.1);
      sign.scale.set(7, 1.45, 1);
      group.add(sign);
      this.ctx.stationMarkers.push(sign);
      this.root.add(group);
    }
  }
}
