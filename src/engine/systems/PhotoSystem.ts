import * as THREE from 'three';
import type { EngineSystem } from '../core/EngineSystem';

export type CinematicPreset =
  | 'platform-fly-by'
  | 'front-tracking-shot'
  | 'side-tracking-shot'
  | 'high-drone-shot'
  | 'cab-approach'
  | 'station-departure';

const CINEMATIC_PRESETS: Array<{ id: CinematicPreset; label: string }> = [
  { id: 'platform-fly-by', label: 'Platform fly-by' },
  { id: 'front-tracking-shot', label: 'Front tracking shot' },
  { id: 'side-tracking-shot', label: 'Side tracking shot' },
  { id: 'high-drone-shot', label: 'High drone shot' },
  { id: 'cab-approach', label: 'Cab approach' },
  { id: 'station-departure', label: 'Station departure' }
];

/** Everything the cinematic camera needs per frame, supplied by the world. */
export type CinematicCameraContext = {
  camera: THREE.PerspectiveCamera;
  distanceM: number;
  routeLengthM: number;
  trainPosition: THREE.Vector3;
  tangent: THREE.Vector3;
  trainHalfLengthM: number;
  activeLaneOffsetM: number;
  normalAt(t: number): THREE.Vector3;
  nearestStations(distanceM: number): { previous?: { distanceM: number }; next?: { distanceM: number } };
  routePointAtDistance(distanceM: number, laneOffsetM: number): THREE.Vector3;
  routeTangentAtDistance(distanceM: number): THREE.Vector3;
};

/**
 * Owns the cinematic (photo) presentation: enter/exit, preset cycling, the
 * preset label, and the smoothed cinematic camera positioning. It drives the
 * camera the CameraSystem owns; it does not create its own.
 */
export class PhotoSystem implements EngineSystem {
  private active = false;
  private presetIndex = 0;

  setActive(active: boolean): { active: boolean; label: string } {
    this.active = active;
    return { active: this.active, label: this.currentLabel() };
  }

  toggle(): { active: boolean; label: string } {
    return this.setActive(!this.active);
  }

  isActive(): boolean {
    return this.active;
  }

  cyclePreset(): { preset: CinematicPreset; label: string } {
    this.presetIndex = (this.presetIndex + 1) % CINEMATIC_PRESETS.length;
    return { preset: this.currentPreset(), label: this.currentLabel() };
  }

  currentPreset(): CinematicPreset {
    return CINEMATIC_PRESETS[this.presetIndex]?.id ?? 'platform-fly-by';
  }

  currentLabel(): string {
    return CINEMATIC_PRESETS[this.presetIndex]?.label ?? 'Platform fly-by';
  }

  /** Smooths the camera toward the current cinematic preset pose. */
  updateCamera(ctx: CinematicCameraContext): void {
    const { camera, trainPosition, tangent, routeLengthM, distanceM } = ctx;
    const routeT = THREE.MathUtils.clamp(distanceM / routeLengthM, 0, 1);
    const normal = ctx.normalAt(routeT);
    const halfLength = ctx.trainHalfLengthM;
    const { previous, next } = ctx.nearestStations(distanceM);
    let cameraPosition = camera.position.clone();
    let lookAt = trainPosition.clone().add(new THREE.Vector3(0, 2.5, 0));

    switch (this.currentPreset()) {
      case 'platform-fly-by': {
        const stationDistanceM = next?.distanceM ?? Math.min(routeLengthM, distanceM + 120);
        const anchor = ctx.routePointAtDistance(stationDistanceM, ctx.activeLaneOffsetM);
        const anchorTangent = ctx.routeTangentAtDistance(stationDistanceM);
        const anchorNormal = new THREE.Vector3(anchorTangent.z, 0, -anchorTangent.x).normalize();
        cameraPosition = anchor
          .add(anchorNormal.multiplyScalar(12))
          .add(anchorTangent.multiplyScalar(-14))
          .add(new THREE.Vector3(0, 3.2, 0));
        break;
      }
      case 'front-tracking-shot':
        cameraPosition = trainPosition.clone()
          .add(tangent.clone().multiplyScalar(halfLength + 22))
          .add(normal.clone().multiplyScalar(1.8))
          .add(new THREE.Vector3(0, 4.8, 0));
        lookAt = trainPosition.clone().add(tangent.clone().multiplyScalar(halfLength * 0.2)).add(new THREE.Vector3(0, 2.5, 0));
        break;
      case 'side-tracking-shot':
        cameraPosition = trainPosition.clone()
          .add(normal.clone().multiplyScalar(14))
          .add(tangent.clone().multiplyScalar(-3.5))
          .add(new THREE.Vector3(0, 5.4, 0));
        break;
      case 'high-drone-shot':
        cameraPosition = trainPosition.clone()
          .add(normal.clone().multiplyScalar(10))
          .add(tangent.clone().multiplyScalar(-16))
          .add(new THREE.Vector3(0, 52, 0));
        lookAt = trainPosition.clone().add(new THREE.Vector3(0, 3.5, 0));
        break;
      case 'cab-approach':
        cameraPosition = trainPosition.clone()
          .add(tangent.clone().multiplyScalar(halfLength + 34))
          .add(normal.clone().multiplyScalar(0.8))
          .add(new THREE.Vector3(0, 3.4, 0));
        lookAt = trainPosition.clone().add(tangent.clone().multiplyScalar(halfLength * 0.3)).add(new THREE.Vector3(0, 2.6, 0));
        break;
      case 'station-departure': {
        const stationDistanceM = previous?.distanceM ?? Math.max(0, distanceM - 90);
        const anchor = ctx.routePointAtDistance(stationDistanceM, ctx.activeLaneOffsetM);
        const anchorTangent = ctx.routeTangentAtDistance(stationDistanceM);
        const anchorNormal = new THREE.Vector3(anchorTangent.z, 0, -anchorTangent.x).normalize();
        cameraPosition = anchor
          .add(anchorNormal.multiplyScalar(12))
          .add(anchorTangent.multiplyScalar(-26))
          .add(new THREE.Vector3(0, 6.4, 0));
        break;
      }
    }

    camera.up.lerp(new THREE.Vector3(0, 1, 0), 0.4).normalize();
    camera.position.lerp(cameraPosition, 0.11);
    camera.lookAt(lookAt);
  }

  dispose(): void {
    this.active = false;
  }
}
