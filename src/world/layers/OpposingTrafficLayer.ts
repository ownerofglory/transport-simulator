import * as THREE from 'three';
import type { WorldLayerContext } from './WorldLayerContext';

/** Oncoming services cloned from the player vehicle and run on the opposite lane. */
export class OpposingTrafficLayer {
  private readonly trains: { root: THREE.Group; cars: THREE.Group[]; phaseM: number }[] = [];

  constructor(private readonly ctx: WorldLayerContext) {}

  /** Clones the player train into evenly-spaced oncoming services. */
  build(playerTrain: THREE.Group): void {
    const trainCount = this.ctx.guidewayKind === 'seilbahn' ? 1 : this.ctx.route.routeLengthM > 5000 ? 3 : 2;
    for (let index = 0; index < trainCount; index++) {
      const root = playerTrain.clone(true);
      root.name = `Opposing service ${index + 1}`;
      // Beam lights stay exclusive to the player train: cloned spotlights would
      // keep aiming at the original train's target and add per-fragment cost.
      const clonedLights: THREE.Object3D[] = [];
      root.traverse((object) => {
        if ((object as THREE.Light).isLight || object.name.startsWith('Exterior lamp')) clonedLights.push(object);
      });
      for (const light of clonedLights) light.parent?.remove(light);
      // A funicular's counterbalance car runs in reverse but its stepped body must
      // still point its tall end uphill, so flip the cloned shell 180° about its
      // vertical axis (relative to the player car's already uphill-oriented shell).
      if (this.ctx.guidewayKind === 'seilbahn') {
        const shell = root.getObjectByName('Funicular step body');
        if (shell) shell.rotation.y += Math.PI;
      }
      const cars = root.children.filter((child): child is THREE.Group => child instanceof THREE.Group && child.name.startsWith('Articulated car'));
      this.trains.push({
        root,
        cars,
        phaseM: ((index + 1) / (trainCount + 1)) * this.ctx.route.routeLengthM
      });
      this.ctx.scene.add(root);
    }
  }

  /** Advances the oncoming services relative to the player distance along the route. */
  update(distanceM: number): void {
    for (const traffic of this.trains) {
      const opposingDistance = this.ctx.guidewayKind === 'seilbahn'
        ? this.ctx.route.routeLengthM - distanceM
        : this.ctx.wrapDistance(this.ctx.route.routeLengthM - distanceM + traffic.phaseM);
      this.ctx.updateArticulatedVehicle(traffic.root, traffic.cars, opposingDistance, -1, this.ctx.oppositeLaneOffsetM);
    }
  }
}
