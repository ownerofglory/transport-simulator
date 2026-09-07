import * as THREE from 'three';
import type { Season } from '../app/types';
import { daylightForHour, DEFAULT_WEATHER, type VisualWeather } from './weather';

// A small procedural equirectangular map gives physically based materials a
// believable sky reflection without downloading an HDR asset for every city.
export class SkyEnvironment {
  private readonly width = 256;
  private readonly height = 128;
  private readonly pixels = new Uint8Array(this.width * this.height * 4);
  private readonly texture = new THREE.DataTexture(this.pixels, this.width, this.height, THREE.RGBAFormat);

  constructor(private readonly scene: THREE.Scene) {
    this.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.name = 'Procedural sky reflection environment';
    this.scene.environment = this.texture;
    this.scene.environmentIntensity = 0.7;
    this.update('summer', 12, 0);
  }

  update(season: Season, hour: number, undergroundFactor: number, weather: VisualWeather = DEFAULT_WEATHER): void {
    const daylight = THREE.MathUtils.smoothstep(daylightForHour(hour, weather), 0, 1);
    const dawnDusk = Math.max(0, 1 - Math.abs(hour - weather.sunriseHour) / 2, 1 - Math.abs(hour - weather.sunsetHour) / 2);
    const palettes: Record<Season, [number, number]> = {
      spring: [0x638fb6, 0xd9e9ec],
      summer: [0x4e91c9, 0xdff2ff],
      autumn: [0x9a7554, 0xddcfb5],
      winter: [0x8399aa, 0xe5edf1]
    };
    const [zenithHex, horizonHex] = palettes[season];
    const night = new THREE.Color(0x111a2b);
    const zenith = night.clone().lerp(new THREE.Color(zenithHex), daylight);
    const horizon = night.clone().lerp(new THREE.Color(horizonHex), daylight);
    const sunset = new THREE.Color(0xf0a069);
    zenith.lerp(sunset, dawnDusk * 0.18);
    horizon.lerp(sunset, dawnDusk * 0.45);

    const cloudiness = weather.kind === 'fog' ? 0.9 : Math.max(weather.cloudCover, weather.kind === 'rain' || weather.kind === 'thunder' ? 0.82 : 0);
    const cloudSky = new THREE.Color(weather.kind === 'snow' ? 0xc5d0d7 : 0x6e7880);
    zenith.lerp(cloudSky, cloudiness * 0.72);
    horizon.lerp(cloudSky, cloudiness * 0.52);
    const sunU = ((hour - weather.sunriseHour) / 24 + 0.5) % 1;
    const sunV = THREE.MathUtils.lerp(0.52, 0.14, daylight);
    for (let y = 0; y < this.height; y++) {
      const v = y / (this.height - 1);
      const vertical = Math.pow(1 - Math.abs(v - 0.5) * 2, 0.72);
      const color = horizon.clone().lerp(zenith, Math.max(0, (0.5 - v) * 2));
      color.multiplyScalar(0.55 + vertical * 0.45);
      for (let x = 0; x < this.width; x++) {
        const u = x / (this.width - 1);
        const horizontalDistance = Math.min(Math.abs(u - sunU), 1 - Math.abs(u - sunU));
        const sunDistance = Math.hypot(horizontalDistance * 2.2, (v - sunV) * 1.15);
        const glare = daylight * (1 - cloudiness * 0.92) * Math.exp(-sunDistance * sunDistance * 180);
        const index = (y * this.width + x) * 4;
        this.pixels[index] = Math.round(THREE.MathUtils.clamp((color.r + glare) * 255, 0, 255));
        this.pixels[index + 1] = Math.round(THREE.MathUtils.clamp((color.g + glare * 0.92) * 255, 0, 255));
        this.pixels[index + 2] = Math.round(THREE.MathUtils.clamp((color.b + glare * 0.68) * 255, 0, 255));
        this.pixels[index + 3] = 255;
      }
    }
    this.texture.needsUpdate = true;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.12, 0.7, 1 - undergroundFactor);
  }

  dispose(): void {
    if (this.scene.environment === this.texture) this.scene.environment = null;
    this.texture.dispose();
  }
}
