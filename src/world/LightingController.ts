import * as THREE from 'three';
import type { Season } from '../app/types';

export class LightingController {
  private currentSeason: Season = 'summer';
  private timeOfDayHour = 12;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly hemisphere: THREE.HemisphereLight,
    private readonly sun: THREE.DirectionalLight,
    private readonly visibilityFill: THREE.AmbientLight
  ) {}

  initialize(): void {
    this.hemisphere.color.setHex(0xffffff);
    this.hemisphere.groundColor.setHex(0x607080);
    this.hemisphere.intensity = 1.3;
    this.scene.add(this.hemisphere);

    this.visibilityFill.color.setHex(0x8da8c9);
    this.visibilityFill.intensity = 0.12;
    this.scene.add(this.visibilityFill);

    this.sun.color.setHex(0xffffff);
    this.sun.intensity = 2.2;
    this.sun.position.set(-220, 380, -120);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -400;
    this.sun.shadow.camera.right = 400;
    this.sun.shadow.camera.top = 400;
    this.sun.shadow.camera.bottom = -400;
    this.scene.add(this.sun);
    this.apply();
  }

  setSeason(season: Season): void {
    this.currentSeason = season;
    this.apply();
  }

  setTimeOfDay(hour: number): void {
    this.timeOfDayHour = ((hour % 24) + 24) % 24;
    this.apply();
  }

  private apply(): void {
    const hour = this.timeOfDayHour;
    const daylight = THREE.MathUtils.smoothstep(Math.sin(((hour - 6) / 12) * Math.PI), 0, 1);
    const dawnDusk = Math.max(0, 1 - Math.abs(hour - 6) / 2, 1 - Math.abs(hour - 18) / 2);
    const angle = ((hour - 6) / 12) * Math.PI;
    this.sun.position.set(Math.cos(angle) * 420, Math.max(18, Math.sin(angle) * 420), -180);
    this.sun.intensity = 0.38 + daylight * 1.95 + dawnDusk * 0.34;
    this.sun.color.set(dawnDusk > 0.2 ? 0xffbd7a : daylight > 0.2 ? 0xfff7e8 : 0x9bb9e6);
    this.hemisphere.intensity = 0.72 + daylight * 0.58 + dawnDusk * 0.12;
    this.hemisphere.color.set(daylight > 0.15 ? 0xddecff : 0x7898c4);
    this.hemisphere.groundColor.set(daylight > 0.15 ? 0x586a70 : 0x29394b);
    this.visibilityFill.intensity = 0.42 * (1 - daylight) + 0.08;
    this.visibilityFill.color.set(dawnDusk > 0.2 ? 0xc79b7d : 0x89a9d2);

    const seasonSky: Record<Season, THREE.Color> = {
      spring: new THREE.Color(0xb9d6ed),
      summer: new THREE.Color(0xa7d3ff),
      autumn: new THREE.Color(0xcab38f),
      winter: new THREE.Color(0xd8e5ee)
    };
    const nightSky = new THREE.Color(0x172b46);
    const sky = nightSky.clone().lerp(seasonSky[this.currentSeason], daylight);
    if (dawnDusk > 0.2) sky.lerp(new THREE.Color(0xd98961), dawnDusk * 0.3);
    this.scene.background = sky;
    const fogFar = THREE.MathUtils.lerp(2300, this.currentSeason === 'summer' ? 3400 : 2700, daylight);
    this.scene.fog = new THREE.Fog(sky, fogFar * 0.4, fogFar);
    this.renderer.toneMappingExposure = 1.05 + dawnDusk * 0.1 + (1 - daylight) * 0.12;
  }
}
