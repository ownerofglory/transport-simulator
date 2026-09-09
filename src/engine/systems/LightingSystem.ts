import * as THREE from 'three';
import type { Season } from '../../app/types';
import { LightingController } from '../../world/LightingController';
import { SkyEnvironment } from '../../world/SkyEnvironment';
import { WeatherSky } from '../../world/WeatherSky';
import { DEFAULT_WEATHER, type VisualWeather } from '../../world/weather';
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
// Warm tunnel luminaire colour, matching the emissive fixtures in the bore.
const TUNNEL_LAMP_COLOR = 0xffe6b4;
// Two lamps ahead of and behind the vehicle give the passing pools of light a
// real tunnel has, without putting hundreds of lights in the scene.
const TUNNEL_LAMP_OFFSETS_M = [26, -14];

export class LightingSystem implements EngineSystem {
  private readonly hemisphere = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private readonly visibilityFill = new THREE.AmbientLight();
  private readonly controller: LightingController;
  private readonly skyEnvironment: SkyEnvironment;
  private readonly weatherSky: WeatherSky;
  private season: Season = 'summer';
  private hour = 12;
  private weather: VisualWeather = DEFAULT_WEATHER;

  // Pooled tunnel lamps: created once, moved with the vehicle, never per-frame allocated.
  private readonly tunnelLamps: THREE.PointLight[] = [];
  private undergroundFactor = 0;
  private appliedUndergroundFactor = -1;

  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.controller = new LightingController(scene, renderer, this.hemisphere, this.sun, this.visibilityFill);
    this.skyEnvironment = new SkyEnvironment(scene);
    this.weatherSky = new WeatherSky(scene);
  }

  /** Adds lights and applies the default sky before a season is chosen. */
  initialize(): void {
    this.applySky('default');
    this.controller.initialize();
    this.weatherSky.update(this.season, this.hour, this.weather);
    for (const _offset of TUNNEL_LAMP_OFFSETS_M) {
      const lamp = new THREE.PointLight(TUNNEL_LAMP_COLOR, 0, 52, 1.9);
      lamp.name = 'Tunnel lamp';
      this.tunnelLamps.push(lamp);
      this.scene.add(lamp);
    }
  }

  setSeason(season: Season): void {
    this.season = season;
    this.applySky(season);
    this.controller.setSeason(season);
    this.skyEnvironment.update(this.season, this.hour, this.undergroundFactor, this.weather);
    this.weatherSky.update(this.season, this.hour, this.weather, this.undergroundFactor > 0.5);
  }

  setTimeOfDay(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.controller.setTimeOfDay(this.hour);
    this.skyEnvironment.update(this.season, this.hour, this.undergroundFactor, this.weather);
    this.weatherSky.update(this.season, this.hour, this.weather, this.undergroundFactor > 0.5);
  }

  setWeather(weather: VisualWeather): void {
    this.weather = weather;
    this.controller.setWeather(weather);
    this.skyEnvironment.update(this.season, this.hour, this.undergroundFactor, weather);
    this.weatherSky.update(this.season, this.hour, weather, this.undergroundFactor > 0.5);
  }

  /** 0 (night) … 1 (full day); used to switch vehicle exterior lamps. */
  daylightFactor(): number {
    return this.controller.daylightFactor();
  }

  /**
   * Effective light level the vehicle sees: full daylight on the surface, but
   * driven to night inside a tunnel so head/tail lamps and saloon lighting come
   * on underground the same way they do after dark.
   */
  effectiveDaylightFactor(): number {
    return this.controller.daylightFactor() * (1 - this.undergroundFactor);
  }

  /**
   * Eases the tunnel look in and out so portals fade rather than pop, and keeps
   * the travelling lamps positioned around the vehicle.
   *
   * Called every frame: the controller only re-applies when the blended factor
   * has actually moved, since applying rebuilds the sky/fog values.
   */
  updateUnderground(underground: boolean, vehiclePosition: THREE.Vector3, tangent: THREE.Vector3, deltaSeconds: number): void {
    this.weatherSky.advance(deltaSeconds, this.weather, vehiclePosition);
    const target = underground ? 1 : 0;
    // ~0.6 s portal transition, frame-rate independent.
    const step = THREE.MathUtils.clamp(deltaSeconds / 0.6, 0, 1);
    this.undergroundFactor += (target - this.undergroundFactor) * step;
    if (Math.abs(target - this.undergroundFactor) < 0.002) this.undergroundFactor = target;

    if (Math.abs(this.undergroundFactor - this.appliedUndergroundFactor) > 0.01) {
      this.appliedUndergroundFactor = this.undergroundFactor;
      this.controller.setUndergroundFactor(this.undergroundFactor);
      this.skyEnvironment.update(this.season, this.hour, this.undergroundFactor, this.weather);
      this.weatherSky.update(this.season, this.hour, this.weather, this.undergroundFactor > 0.5);
    }

    const intensity = this.undergroundFactor * 95;
    for (const [index, lamp] of this.tunnelLamps.entries()) {
      lamp.intensity = intensity;
      if (intensity <= 0) continue;
      lamp.position.copy(vehiclePosition).addScaledVector(tangent, TUNNEL_LAMP_OFFSETS_M[index]);
      lamp.position.y += 3.4; // just under the crown, where the fixtures hang.
    }
  }

  private applySky(key: Season | 'default'): void {
    const sky = SKY[key];
    this.scene.background = new THREE.Color(sky.color);
    this.scene.fog = new THREE.Fog(sky.color, sky.near, sky.far);
  }

  dispose(): void {
    this.skyEnvironment.dispose();
    this.weatherSky.dispose();
    this.scene.remove(this.hemisphere, this.sun, this.visibilityFill);
    for (const lamp of this.tunnelLamps) {
      this.scene.remove(lamp);
      lamp.dispose();
    }
    this.tunnelLamps.length = 0;
    this.sun.shadow.map?.dispose();
    this.hemisphere.dispose();
    this.sun.dispose();
    this.visibilityFill.dispose();
  }
}
