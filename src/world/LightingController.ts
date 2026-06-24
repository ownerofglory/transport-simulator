import * as THREE from 'three';
import type { Season } from '../app/types';

/** Controls sun, sky, fog, and fill lighting based on season and local time. */
export class LightingController {
  private currentSeason: Season = 'summer';

  // Default to noon before the app applies real/local time.
  private timeOfDayHour = 12;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly hemisphere: THREE.HemisphereLight,
    private readonly sun: THREE.DirectionalLight,
    private readonly visibilityFill: THREE.AmbientLight
  ) {}

  /** Adds lights to the scene and applies the initial season/time look. */
  initialize(): void {
    this.hemisphere.color.setHex(0xffffff); // neutral white sky light.
    this.hemisphere.groundColor.setHex(0x607080); // cool grey-blue ground bounce.
    this.hemisphere.intensity = 1.3; // strong ambient base for readable untextured scenery.
    this.scene.add(this.hemisphere);

    this.visibilityFill.color.setHex(0x8da8c9); // cool fill for night/shadow visibility.
    this.visibilityFill.intensity = 0.12; // low default fill so daylight still has contrast.
    this.scene.add(this.visibilityFill);

    this.sun.color.setHex(0xffffff); // neutral sun color before time-of-day tint.
    this.sun.intensity = 2.2; // bright directional key light.
    this.sun.position.set(-220, 380, -120); // initial elevated southwest-style sun position.
    this.sun.castShadow = true;

    // Large shadow box covers trains, stations, and nearby scenery.
    this.sun.shadow.camera.left = -400;
    this.sun.shadow.camera.right = 400;
    this.sun.shadow.camera.top = 400;
    this.sun.shadow.camera.bottom = -400;

    this.scene.add(this.sun);
    this.apply();
  }

  /** Changes seasonal sky/fog tint while preserving the current time of day. */
  setSeason(season: Season): void {
    this.currentSeason = season;
    this.apply();
  }

  /** Sets local hour, normalized into the 0–24 range. */
  setTimeOfDay(hour: number): void {
    this.timeOfDayHour = ((hour % 24) + 24) % 24;
    this.apply();
  }

  /** Recomputes lighting, sky, fog, and exposure from season/time state. */
  private apply(): void {
    const hour = this.timeOfDayHour;

    // Daylight rises after 06:00, peaks around noon, and falls by 18:00.
    const daylight = THREE.MathUtils.smoothstep(Math.sin(((hour - 6) / 12) * Math.PI), 0, 1);

    // Warm tint around 06:00 and 18:00, fading over about two hours.
    const dawnDusk = Math.max(0, 1 - Math.abs(hour - 6) / 2, 1 - Math.abs(hour - 18) / 2);

    // Solar arc: 06:00 horizon, 12:00 high sun, 18:00 horizon.
    const angle = ((hour - 6) / 12) * Math.PI;

    this.sun.position.set(
      Math.cos(angle) * 420, // horizontal sun travel radius.
      Math.max(18, Math.sin(angle) * 420), // keep sun slightly above horizon at night.
      -180 // fixed north/south offset for consistent shadows.
    );

    this.sun.intensity = 0.38 + daylight * 1.95 + dawnDusk * 0.34; // base night sun + daylight + golden-hour boost.
    this.sun.color.set(dawnDusk > 0.2 ? 0xffbd7a : daylight > 0.2 ? 0xfff7e8 : 0x9bb9e6); // warm dusk, pale day, blue night.

    this.hemisphere.intensity = 0.72 + daylight * 0.58 + dawnDusk * 0.12; // ambient light tracks daytime brightness.
    this.hemisphere.color.set(daylight > 0.15 ? 0xddecff : 0x7898c4); // bright sky vs blue night sky.
    this.hemisphere.groundColor.set(daylight > 0.15 ? 0x586a70 : 0x29394b); // lighter ground bounce by day.

    this.visibilityFill.intensity = 0.42 * (1 - daylight) + 0.08; // stronger fill at night, small fill by day.
    this.visibilityFill.color.set(dawnDusk > 0.2 ? 0xc79b7d : 0x89a9d2); // warm dusk fill, cool general fill.

    const seasonSky: Record<Season, THREE.Color> = {
      spring: new THREE.Color(0xb9d6ed), // soft spring blue.
      summer: new THREE.Color(0xa7d3ff), // saturated summer blue.
      autumn: new THREE.Color(0xcab38f), // warm hazy autumn sky.
      winter: new THREE.Color(0xd8e5ee) // pale cold winter sky.
    };

    const nightSky = new THREE.Color(0x172b46); // deep blue night sky.
    const sky = nightSky.clone().lerp(seasonSky[this.currentSeason], daylight);

    // Add orange sunrise/sunset warmth without fully replacing the seasonal sky.
    if (dawnDusk > 0.2) sky.lerp(new THREE.Color(0xd98961), dawnDusk * 0.3);

    this.scene.background = sky;

    // Fog draws farther in daylight, especially in summer.
    const fogFar = THREE.MathUtils.lerp(2300, this.currentSeason === 'summer' ? 3400 : 2700, daylight);
    this.scene.fog = new THREE.Fog(sky, fogFar * 0.4, fogFar); // near fog starts at 40% of far distance.

    // Slightly lift exposure at dusk/night so the scene stays readable.
    this.renderer.toneMappingExposure = 1.05 + dawnDusk * 0.1 + (1 - daylight) * 0.12;
  }
}
