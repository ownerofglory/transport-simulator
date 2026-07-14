import * as THREE from 'three';
import { makeLabelTexture } from '../../labels';
import type { GuidewayKind } from '../../domain/transport';
import { BuilderRegistry } from '../../engine/builders/BuilderRegistry';
import type { WorldLayerContext } from './WorldLayerContext';

/** Builds platforms, canopies, signage, and stops for every guideway type. */
export class StationLayer {
  /** All meshes go under this group; the world adds it to the scene. */
  readonly root = new THREE.Group();
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
    (this.builders.resolveOptional(this.ctx.guidewayKind) ?? (() => this.buildRailStations()))();
  }

  private buildRailStations(): void {
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xb9b7b0, roughness: 0.9 });
    const platformEdgeMat = new THREE.MeshStandardMaterial({ color: 0x696b6c, roughness: 0.82 });
    const tactileMat = new THREE.MeshStandardMaterial({ color: 0xeee7cf, roughness: 0.92 });
    const ssbBlueMat = new THREE.MeshStandardMaterial({ color: 0x174a73, roughness: 0.45, metalness: 0.28 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xa9d0dd,
      roughness: 0.12,
      metalness: 0.08,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide
    });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.38, metalness: 0.34 });
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x234e68, roughness: 0.68 });
    const machineMat = new THREE.MeshStandardMaterial({ color: 0xffd800, roughness: 0.48 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4cf, emissiveIntensity: 2.1 });
    const undergroundWallMat = new THREE.MeshStandardMaterial({ color: 0xcacbc8, roughness: 0.88 });

    for (const station of this.ctx.route.stations) {
      const t = THREE.MathUtils.clamp(station.distanceM / this.ctx.route.routeLengthM, 0, 1);
      const p = this.ctx.curve.getPointAt(t);
      const tangent = this.ctx.curve.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const underground = this.ctx.stationIsUnderground(t);
      const stationGroup = new THREE.Group();
      stationGroup.name = `${underground ? 'Underground' : 'Surface'} station ${station.name}`;
      stationGroup.position.copy(p);
      stationGroup.rotation.y = yaw;
      this.root.add(stationGroup);

      if (underground) {
        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(27, 0.48, 82), undergroundWallMat);
        ceiling.position.y = 5.7;
        ceiling.receiveShadow = true;
        stationGroup.add(ceiling);
        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.3, 82), undergroundWallMat);
          wall.position.set(side * 12.2, 2.75, 0);
          wall.receiveShadow = true;
          stationGroup.add(wall);
        }
      }

      for (const side of [-1, 1]) {
        const halfLengthM = 38;
        const startT = THREE.MathUtils.clamp((station.distanceM - halfLengthM) / this.ctx.route.routeLengthM, 0, 1);
        const endT = THREE.MathUtils.clamp((station.distanceM + halfLengthM) / this.ctx.route.routeLengthM, 0, 1);
        const platformEdge = new THREE.Mesh(this.ctx.makeRouteStrip(side * 7.4, 8.25, startT, endT, 28, 0.12), platformEdgeMat);
        platformEdge.receiveShadow = true;
        stationGroup.parent?.add(platformEdge);
        const platform = new THREE.Mesh(this.ctx.makeRouteStrip(side * 7.4, 8, startT, endT, 24, 0.22), platformMat);
        platform.receiveShadow = true;
        platform.name = `Curved platform ${station.name}`;
        stationGroup.parent?.add(platform);

        const tactileOffset = side * 3.72;
        const tactile = new THREE.Mesh(this.ctx.makeRouteStrip(tactileOffset, 0.72, startT, endT, 28, 0.245), tactileMat);
        tactile.name = `Tactile platform edge ${station.name}`;
        stationGroup.parent?.add(tactile);

        if (underground) {
          for (const z of [-24, 0, 24]) {
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 5.1, 0.58), ssbBlueMat);
            pillar.position.set(side * 9.7, 2.72, z);
            pillar.castShadow = true;
            stationGroup.add(pillar);
          }
          for (const z of [-24, -8, 8, 24]) {
            const light = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 8.5), lightMat);
            light.position.set(side * 7.1, 5.4, z);
            stationGroup.add(light);
          }
        } else {
          const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.24, 25), canopyMat);
          roof.position.set(side * 7.8, 4.25, 8);
          roof.rotation.z = side * -0.035;
          roof.castShadow = true;
          stationGroup.add(roof);
          for (const roofEdge of [-1, 1]) {
            const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 25.2), ssbBlueMat);
            fascia.position.set(side * 7.8 + roofEdge * 3.05, 4.12, 8);
            stationGroup.add(fascia);
          }

          const glassBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.55, 22), glassMat);
          glassBack.position.set(side * 10.55, 2.55, 8);
          stationGroup.add(glassBack);
          for (const z of [-2.5, 8, 18.5]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.55, 0.16), ssbBlueMat);
            post.position.set(side * 10.5, 2.25, z);
            post.castShadow = true;
            stationGroup.add(post);
            const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 5.5), lightMat);
            lamp.position.set(side * 7.8, 4.08, z);
            stationGroup.add(lamp);
          }
        }

        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.48, 4.8), benchMat);
        bench.position.set(side * 8.8, 0.78, underground ? 9 : 8);
        bench.castShadow = true;
        stationGroup.add(bench);
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.15, 4.8), benchMat);
        backrest.position.set(side * 9.32, 1.25, underground ? 9 : 8);
        stationGroup.add(backrest);

        const ticketMachine = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.9, 1.05), machineMat);
        ticketMachine.position.set(side * 9.25, 1.18, -8);
        ticketMachine.castShadow = true;
        stationGroup.add(ticketMachine);
        const ticketScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.42), new THREE.MeshBasicMaterial({ color: 0x82c9ef }));
        ticketScreen.position.set(side * 9.63, 1.52, -8);
        ticketScreen.rotation.y = side * Math.PI / 2;
        stationGroup.add(ticketScreen);

        const timetableCase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 1.35), ssbBlueMat);
        timetableCase.position.set(side * 9.45, 1.46, -13);
        stationGroup.add(timetableCase);
        const timetable = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.52), new THREE.MeshBasicMaterial({ color: 0xf6f3e9 }));
        timetable.position.set(side * 9.55, 1.46, -13);
        timetable.rotation.y = side * Math.PI / 2;
        stationGroup.add(timetable);

        const signTexture = makeLabelTexture(`${this.ctx.route.line}  ${station.name}`, {
          width: 1024,
          height: 180,
          bg: '#174a73',
          fg: '#ffffff'
        });
        for (const z of [-21, 21]) {
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(8.6, 1.5),
            new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.FrontSide })
          );
          sign.position.set(side * 10.75, underground ? 3.55 : 3.05, z);
          sign.rotation.y = side * Math.PI / 2;
          stationGroup.add(sign);
          const signBack = sign.clone();
          signBack.rotation.y += Math.PI;
          stationGroup.add(signBack);
          this.ctx.stationMarkers.push(sign, signBack);
        }

        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 12), ssbBlueMat);
        bin.position.set(side * 9.35, 0.7, 14);
        stationGroup.add(bin);
      }

      if (underground) {
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
        stationGroup.add(wayfinding);
        const wayfindingBack = wayfinding.clone();
        wayfindingBack.rotation.y = Math.PI;
        stationGroup.add(wayfindingBack);
      }
    }
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
