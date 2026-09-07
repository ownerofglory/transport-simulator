import * as THREE from 'three';
import type { VisualWeather } from './weather';

const PARTICLE_COUNT = 260;

/** Pooled, camera-relative precipitation: one line mesh, no per-frame allocations. */
export class WeatherEffects {
  private readonly group = new THREE.Group();
  private readonly positions = new Float32Array(PARTICLE_COUNT * 2 * 3);
  private readonly velocities = new Float32Array(PARTICLE_COUNT);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({ color: 0xb9d7e8, transparent: true, opacity: 0.38, depthWrite: false });
  private readonly precipitation = new THREE.LineSegments(this.geometry, this.material);
  private snow = false;
  private intensity = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'Camera-relative weather precipitation';
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.precipitation.frustumCulled = false;
    this.group.add(this.precipitation);
    this.seed();
    this.group.visible = false;
    scene.add(this.group);
  }

  setWeather(weather: VisualWeather): void {
    this.snow = weather.kind === 'snow';
    const hasPrecipitation = weather.kind === 'rain' || weather.kind === 'snow' || weather.kind === 'thunder';
    this.intensity = hasPrecipitation
      ? Math.min(1, Math.max(0.2, weather.kind === 'thunder' ? 0.95 : weather.precipitationMm / 2.5))
      : 0;
    this.group.visible = hasPrecipitation;
    this.material.color.setHex(this.snow ? 0xf3fbff : 0xb9d7e8);
    this.material.opacity = this.snow ? 0.66 : 0.28 + this.intensity * 0.35;
  }

  update(anchor: THREE.Vector3, deltaSeconds: number, underground: boolean): void {
    this.group.visible = !underground && this.intensity > 0;
    if (!this.group.visible) return;
    this.group.position.copy(anchor);
    const fallDistance = (this.snow ? 2.4 : 18) * deltaSeconds;
    for (let index = 0; index < PARTICLE_COUNT; index++) {
      const start = index * 6;
      this.positions[start + 1] -= fallDistance * this.velocities[index];
      this.positions[start + 4] = this.positions[start + 1] - (this.snow ? 0.16 : 1.2 + this.intensity * 1.6);
      if (this.positions[start + 1] < -2) this.reset(index, 16 + (index % 9));
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  private seed(): void {
    for (let index = 0; index < PARTICLE_COUNT; index++) this.reset(index, 4 + (index % 18));
  }

  private reset(index: number, height: number): void {
    const seed = ((index * 9301 + 49297) % 233280) / 233280;
    const start = index * 6;
    const x = (seed * 2 - 1) * 16;
    const z = ((((seed * 47) % 1) * 2) - 1) * 16;
    this.positions[start] = this.positions[start + 3] = x;
    this.positions[start + 1] = height;
    this.positions[start + 2] = this.positions[start + 5] = z;
    this.positions[start + 4] = height - 1.4;
    this.velocities[index] = 0.7 + ((seed * 19) % 1) * 0.65;
  }
}
