import * as THREE from 'three';
import { CameraController, type CameraMode } from '../../world/CameraController';
import type { EngineSystem } from '../core/EngineSystem';

/** Per-frame follow input for the active vehicle (mirrors CameraController.update). */
export type CameraFollowInput = Parameters<CameraController['update']>[0];

/**
 * Owns the perspective camera and its chase/passenger/cab rig, plus zoom, side
 * look, viewport resizing, and pose smoothing.
 *
 * It deliberately does NOT own route simulation, vehicle creation, or the
 * cinematic (photo) camera — those belong to ActiveVehicleSystem and
 * PhotoSystem. The world feeds it a follow input each frame.
 */
export class CameraSystem implements EngineSystem {
  readonly camera: THREE.PerspectiveCamera;
  private readonly controller: CameraController;
  private readonly onResizeBound = () => this.resize();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.controller = new CameraController(this.camera);
    window.addEventListener('resize', this.onResizeBound);
  }

  /**
   * Places the camera just behind the route start so cities with a regional
   * coordinate origin don't fly in over empty terrain on the first frame.
   */
  placeAtStart(startPoint: THREE.Vector3, startTangent: THREE.Vector3): void {
    this.camera.position.set(
      startPoint.x - startTangent.x * 60,
      startPoint.y + 16,
      startPoint.z - startTangent.z * 60
    );
  }

  /** Smooths the camera toward the active-vehicle pose for the current mode. */
  follow(input: CameraFollowInput): void {
    this.controller.update(input);
  }

  cycle(): CameraMode {
    return this.controller.cycle();
  }

  setMode(mode: CameraMode): CameraMode {
    return this.controller.setMode(mode);
  }

  currentMode(): CameraMode {
    return this.controller.currentMode();
  }

  setLookInput(leftHeld: boolean, rightHeld: boolean): void {
    this.controller.setLookInput(leftHeld, rightHeld);
  }

  adjustZoom(delta: number): void {
    this.controller.adjustZoom(delta);
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResizeBound);
  }
}
