import * as THREE from 'three';
import type { Season } from '../app/types';
import { daylightForHour, DEFAULT_WEATHER, effectiveCloudCover, solarPositionForHour, type VisualWeather } from './weather';

/** Controls sun, sky, fog, and fill lighting based on season and local time. */
export class LightingController {
  private readonly sunDirection = new THREE.Vector3(-220, 380, -120).normalize();
  private readonly focus = new THREE.Vector3();
  private currentSeason: Season = 'summer';

  // Default to noon before the app applies real/local time.
  private timeOfDayHour = 12;

  // 0 on the surface … 1 fully inside a tunnel. Blended by the caller so
  // portal transitions fade instead of popping.
  private undergroundFactor = 0;
  private weather: VisualWeather = DEFAULT_WEATHER;

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
    this.sun.position.copy(this.sunDirection).multiplyScalar(520);
    this.sun.castShadow = true;

    // Keep shadow texels around the vehicle; a city-wide frustum makes wheels,
    // doors and platform edges lose their contact shadows.
    this.sun.shadow.camera.left = -120;
    this.sun.shadow.camera.right = 120;
    this.sun.shadow.camera.top = 120;
    this.sun.shadow.camera.bottom = -120;
    this.sun.shadow.camera.far = 1_100;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.035;

    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.apply();
  }

  /** Tracks the local vehicle area while preserving the time-of-day sun angle. */
  setFocus(position: THREE.Vector3): void {
    this.focus.copy(position);
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.sunDirection).multiplyScalar(520).add(this.focus);
    this.sun.target.updateMatrixWorld();
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

  /** 0 on the surface … 1 fully underground; drives tunnel darkness and fog. */
  setUndergroundFactor(factor: number): void {
    this.undergroundFactor = THREE.MathUtils.clamp(factor, 0, 1);
    this.apply();
  }

  /** Applies real-world cloud, visibility, and precipitation lighting without changing simulation state. */
  setWeather(weather: VisualWeather): void {
    this.weather = weather;
    this.apply();
  }

  /** 0 at night, 1 at full daylight; used e.g. to switch vehicle lamps. */
  daylightFactor(): number {
    return THREE.MathUtils.smoothstep(daylightForHour(this.timeOfDayHour, this.weather), 0, 1);
  }

  /** Recomputes lighting, sky, fog, and exposure from season/time state. */
  private apply(): void {
    const hour = this.timeOfDayHour;

    const daylight = this.daylightFactor();
    const skyDaylight = daylight > 0.01 ? 0.52 + Math.sqrt(daylight) * 0.48 : 0;
    const solar = solarPositionForHour(hour, this.weather, this.currentSeason);
    const dawnDusk = solar.twilight * Math.pow(solar.daylight, 0.35);

    // Open-Meteo supplies the city-local daylight window; seasonal elevation
    // keeps the directional shadows low in winter and high in summer.
    const horizontal = Math.cos(solar.elevationRad);
    this.sunDirection.set(
      Math.sin(solar.azimuthRad) * horizontal,
      Math.sin(solar.elevationRad),
      Math.cos(solar.azimuthRad) * horizontal
    );
    this.sun.position.copy(this.sunDirection).multiplyScalar(520).add(this.focus);

    // Underground, daylight must not reach the bore: the sun is cut almost to
    // nothing and the sky ambient is replaced by a dim warm tunnel fill, so the
    // only real light left is the lamp rig travelling with the vehicle.
    const below = this.undergroundFactor;

    const cloudiness = effectiveCloudCover(this.weather);
    this.sun.intensity = (0.025 + daylight * 2.28 + dawnDusk * 0.28) * (1 - cloudiness * 0.72) * (1 - below * 0.97); // cloud cover softens direct light while tunnels still suppress it.
    this.sun.castShadow = daylight > 0.08 && below < 0.8;
    this.sun.color.set(dawnDusk > 0.2 ? 0xffbd7a : daylight > 0.2 ? 0xfff7e8 : 0x9bb9e6); // warm dusk, pale day, blue night.

    this.hemisphere.intensity = THREE.MathUtils.lerp(0.72 + daylight * 0.58 + dawnDusk * 0.12 + cloudiness * 0.22, 0.05, below); // overcast skies trade direct sun for diffuse ambient light.
    this.hemisphere.color.set(daylight > 0.15 ? 0xddecff : 0x7898c4); // bright sky vs blue night sky.
    this.hemisphere.groundColor.set(daylight > 0.15 ? 0x586a70 : 0x29394b); // lighter ground bounce by day.

    this.visibilityFill.intensity = THREE.MathUtils.lerp(0.42 * (1 - daylight) + 0.08, 0.07, below); // stronger fill at night, small fill by day.
    this.visibilityFill.color.set(below > 0.5 ? 0xb9ad95 : dawnDusk > 0.2 ? 0xc79b7d : 0x89a9d2); // warm tunnel/dusk fill, cool general fill.

    const seasonSky: Record<Season, THREE.Color> = {
      spring: new THREE.Color(0xb9d6ed), // soft spring blue.
      summer: new THREE.Color(0xa7d3ff), // saturated summer blue.
      autumn: new THREE.Color(0xcab38f), // warm hazy autumn sky.
      winter: new THREE.Color(0xd8e5ee) // pale cold winter sky.
    };

    const nightSky = new THREE.Color(0x172b46); // deep blue night sky.
    const sky = nightSky.clone().lerp(seasonSky[this.currentSeason], skyDaylight);

    // Add orange sunrise/sunset warmth without fully replacing the seasonal sky.
    if (dawnDusk > 0.2) sky.lerp(new THREE.Color(0xd98961), dawnDusk * 0.3);

    // The sky stays the background even underground: the bore encloses the view,
    // so the only place it shows through is the portal — which is exactly the
    // blown-out white hole you see driving towards daylight.
    this.scene.background = sky;

    // Fog draws farther in daylight, especially in summer.
    // The floor keeps even a dense-fog reading from closing the view to a couple
    // of blocks; below roughly this distance fog reads as a painted backdrop.
    const weatherVisibility = THREE.MathUtils.clamp(this.weather.visibilityM * 0.42, 900, 4_000);
    const fogFar = Math.min(THREE.MathUtils.lerp(2300, this.currentSeason === 'summer' ? 3400 : 2700, daylight), weatherVisibility);
    // Underground the fog turns near-black and closes right in, so the lining
    // falls off into darkness a few car lengths ahead instead of staying evenly lit.
    const fogColor = sky.clone().lerp(new THREE.Color(0x07080a), below);
    // Clear conditions keep the usual short ramp near the horizon. When weather
    // closes the view in, the ramp is stretched instead of scaled down: haze has
    // to fade in over several hundred metres, or fog stands up as a flat wall a
    // couple of blocks ahead rather than veiling the distance.
    const fogNear = Math.min(fogFar * 0.4, Math.max(90, fogFar - 800));
    const near = THREE.MathUtils.lerp(fogNear, 12, below);
    const far = THREE.MathUtils.lerp(fogFar, 155, below);

    // Mutate the existing fog rather than replacing it; underground blending
    // re-applies this on every step of a portal transition.
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(fogColor);
      this.scene.fog.near = near;
      this.scene.fog.far = far;
    } else {
      this.scene.fog = new THREE.Fog(fogColor, near, far);
    }

    // Slightly lift exposure at dusk/night so the scene stays readable.
    this.renderer.toneMappingExposure = 1.05 + dawnDusk * 0.1 + (1 - daylight) * 0.12;
  }
}
