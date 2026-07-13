import * as THREE from 'three';
import type { Season } from '../../app/types';
import { LightingController } from '../../world/LightingController';
import type { EngineSystem } from '../core/EngineSystem';

/** Per-season sky tint and fog distances. */
const SKY: Record<Season | 'default', { color: number; near: number; far: number }> = {
  default: { color: 0xaac8df, near: 900, far: 2800 },
  spring: { color: 0xb9d6ed, near: 900, far: 2800 },
  summer: { color: 0xa7d3ff, near: 1100, far: 3200 },
  autumn: { color: 0xcab38f, near: 760, far: 2300 },
  winter: { color: 0xd8e5ee, near: 620, far: 1800 }
};

/**
 * Owns sun/ambient/hemisphere lighting, time-of-day transitions, season-based
 * lighting, and the sky/fog presentation. Seasonal decorative props
 * (leaves/snow) are scene decorations and remain with the world/EnvironmentSystem.
 */
export class LightingSystem implements EngineSystem {
  private readonly hemisphere = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private readonly visibilityFill = new THREE.AmbientLight();
  private readonly controller: LightingController;

  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.controller = new LightingController(scene, renderer, this.hemisphere, this.sun, this.visibilityFill);
  }

  /** Adds lights and applies the default sky before a season is chosen. */
  initialize(): void {
    this.applySky('default');
    this.controller.initialize();
  }

  setSeason(season: Season): void {
    this.applySky(season);
    this.controller.setSeason(season);
  }

  setTimeOfDay(hour: number): void {
    this.controller.setTimeOfDay(hour);
  }

  /** 0 (night) … 1 (full day); used to switch vehicle exterior lamps. */
  daylightFactor(): number {
    return this.controller.daylightFactor();
  }

  private applySky(key: Season | 'default'): void {
    const sky = SKY[key];
    this.scene.background = new THREE.Color(sky.color);
    this.scene.fog = new THREE.Fog(sky.color, sky.near, sky.far);
  }

  dispose(): void {
    this.scene.remove(this.hemisphere, this.sun, this.visibilityFill);
    this.sun.shadow.map?.dispose();
    this.hemisphere.dispose();
    this.sun.dispose();
    this.visibilityFill.dispose();
  }
}
