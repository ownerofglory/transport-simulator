import * as THREE from 'three';
import type { Season } from '../app/types';
import { DEFAULT_WEATHER, effectiveCloudCover, solarPositionForHour, type VisualWeather } from './weather';

const VERTEX_SHADER = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform vec3 cloudLitColor;
  uniform vec3 cloudShadowColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform float cloudCover;
  uniform float daylight;
  uniform float twilight;
  uniform float cloudTime;
  varying vec3 vDirection;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    value += noise(p) * 0.56;
    value += noise(p * 2.03) * 0.27;
    value += noise(p * 4.08) * 0.17;
    return value;
  }
  float cloudField(vec2 uv) {
    float broad = fbm(uv * 0.78);
    float detail = fbm(uv * 2.1 + broad * 1.7);
    return broad * 0.72 + detail * 0.28;
  }
  void main() {
    vec3 dir = normalize(vDirection);
    float horizon = smoothstep(-0.16, 0.56, dir.y);
    vec3 sky = mix(horizonColor, zenithColor, horizon);
    // Latitude/longitude-like noise on the dome makes broad cumulus banks
    // rather than a flat screen-space overlay. Wind only moves the pattern.
    vec2 cloudUv = vec2(atan(dir.z, dir.x) * 0.82, dir.y * 2.65) + vec2(cloudTime * 0.008, cloudTime * 0.002);
    float field = cloudField(cloudUv);
    float threshold = mix(0.92, 0.24, cloudCover);
    float softness = mix(0.075, 0.19, cloudCover);
    float cloudShape = smoothstep(threshold - softness, threshold + softness, field);
    float ceiling = smoothstep(-0.08, 0.2, dir.y) * (1.0 - smoothstep(0.94, 1.0, dir.y) * 0.24);
    float cloudMask = cloudShape * ceiling * smoothstep(0.06, 0.28, cloudCover);
    // An overcast ceiling still has visible depth and darker moisture bands;
    // otherwise 100% cover would collapse into a featureless grey fill.
    cloudMask = mix(cloudMask, (0.36 + field * 0.56) * ceiling, smoothstep(0.8, 1.0, cloudCover));
    float sunOnCloud = pow(max(dot(dir, normalize(sunDirection)), 0.0), 3.0) * daylight;
    float cloudVolume = smoothstep(0.22, 0.78, field);
    vec3 clouds = mix(cloudShadowColor, cloudLitColor, 0.16 + cloudVolume * 0.62 + sunOnCloud * 0.22);
    sky = mix(sky, clouds, cloudMask);
    float sunDot = max(dot(dir, normalize(sunDirection)), 0.0);
    float sunDisc = smoothstep(0.99925, 0.99992, sunDot) * daylight * (1.0 - cloudCover * 0.9);
    float sunHalo = pow(sunDot, 22.0) * daylight * (1.0 - cloudCover * 0.56);
    float horizonGlow = pow(sunDot, 4.0) * twilight * (1.0 - cloudCover * 0.48);
    gl_FragColor = vec4(sky + sunColor * (sunDisc * 3.5 + sunHalo * 0.21 + horizonGlow * 0.13), 1.0);
  }
`;

/** Visible sky dome with forecast-driven cloud cover, separate from the reflection environment. */
export class WeatherSky {
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      zenithColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      cloudLitColor: { value: new THREE.Color() },
      cloudShadowColor: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      cloudCover: { value: 0 },
      daylight: { value: 1 },
      twilight: { value: 0 },
      cloudTime: { value: 0 }
    }
  });
  // Must remain inside CameraSystem's 5 km far plane. The dome follows the
  // vehicle, so this radius covers every camera rig without clipping the sky.
  private readonly mesh = new THREE.Mesh(new THREE.SphereGeometry(4_500, 32, 16), this.material);
  private readonly cloudRoot = new THREE.Group();
  // Smooth segments avoid the faceted "cracks" visible on close low-poly puffs.
  private readonly cloudGeometry = new THREE.SphereGeometry(1, 24, 16);
  private readonly cloudMaterial = new THREE.MeshLambertMaterial({
    color: 0xd6dde1,
    transparent: true,
    opacity: 0.55,
    // Writing depth lets overlapping translucent puffs resolve as a single
    // cloud bank instead of showing their intersecting back faces.
    depthWrite: true,
    fog: false
  });

  constructor(scene: THREE.Scene) {
    this.mesh.name = 'Forecast-driven procedural sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1_000;
    this.cloudRoot.name = 'Forecast cloud banks';
    this.cloudRoot.renderOrder = -999;
    this.buildCloudBanks();
    scene.add(this.mesh);
    scene.add(this.cloudRoot);
  }

  update(season: Season, hour: number, weather: VisualWeather = DEFAULT_WEATHER, underground = false): void {
    const solar = solarPositionForHour(hour, weather, season);
    const daylight = THREE.MathUtils.smoothstep(solar.daylight, 0, 1);
    // The sky remains brightly diffuse after sunrise even before the direct
    // sun reaches its midday strength; otherwise a normal cloudy morning reads
    // like late night.
    const skyDaylight = daylight > 0.01 ? 0.52 + Math.sqrt(daylight) * 0.48 : 0;
    // Before the actual local sunrise the sky is blue twilight, not a warm
    // sunset. The same rule naturally fades warmth out once the sun sets.
    const sunlitTwilight = solar.twilight * Math.pow(solar.daylight, 0.35);
    const palette: Record<Season, [number, number]> = {
      spring: [0x4b87bc, 0xc8e2f2],
      summer: [0x337fc1, 0xd8f0ff],
      autumn: [0x756b72, 0xd6b28b],
      winter: [0x71899a, 0xdde8ee]
    };
    const [zenith, horizon] = palette[season];
    const cloudiness = effectiveCloudCover(weather);
    const fogTint = weather.kind === 'snow' ? 0xd5dfe4 : weather.kind === 'thunder' ? 0x353947 : weather.kind === 'rain' ? 0x65717c : 0x75808a;
    const night = new THREE.Color(0x172941);
    const warmth = new THREE.Color(0xf19a62);
    const skyWeatherTint = weather.kind === 'thunder' ? cloudiness * 0.68 : weather.kind === 'rain' || weather.kind === 'fog' ? cloudiness * 0.52 : cloudiness * 0.28;
    (this.material.uniforms.zenithColor.value as THREE.Color).copy(night).lerp(new THREE.Color(zenith), skyDaylight).lerp(new THREE.Color(fogTint), skyWeatherTint).lerp(warmth, sunlitTwilight * 0.16);
    (this.material.uniforms.horizonColor.value as THREE.Color).copy(night).lerp(new THREE.Color(horizon), skyDaylight).lerp(new THREE.Color(fogTint), skyWeatherTint * 0.72).lerp(warmth, sunlitTwilight * 0.38);
    (this.material.uniforms.cloudLitColor.value as THREE.Color).setHex(weather.kind === 'snow' ? 0xf1f5f7 : weather.kind === 'thunder' ? 0x6e7886 : 0xe1e6e9).lerp(warmth, sunlitTwilight * 0.35);
    (this.material.uniforms.cloudShadowColor.value as THREE.Color).setHex(weather.kind === 'thunder' ? 0x303847 : weather.kind === 'rain' ? 0x687681 : 0x9aa8b1);
    (this.material.uniforms.sunColor.value as THREE.Color).setHex(sunlitTwilight > 0.16 ? 0xff9d5d : season === 'winter' ? 0xfff0cd : 0xfff8e8);
    const horizontal = Math.cos(solar.elevationRad);
    (this.material.uniforms.sunDirection.value as THREE.Vector3).set(
      Math.sin(solar.azimuthRad) * horizontal,
      Math.sin(solar.elevationRad),
      Math.cos(solar.azimuthRad) * horizontal
    );
    this.material.uniforms.cloudCover.value = cloudiness;
    this.material.uniforms.daylight.value = daylight;
    this.material.uniforms.twilight.value = solar.twilight;
    this.mesh.visible = !underground;
    this.cloudRoot.visible = !underground && cloudiness >= 0.28;
    this.cloudMaterial.color.setHex(weather.kind === 'thunder' ? 0x58606d : weather.kind === 'rain' ? 0x98a4ac : weather.kind === 'snow' ? 0xe4eaed : 0xd8e0e4).lerp(warmth, sunlitTwilight * 0.2);
    this.cloudMaterial.opacity = THREE.MathUtils.lerp(0.3, weather.kind === 'thunder' ? 0.74 : 0.66, cloudiness);
  }

  /** Wind-driven cloud drift is the only per-frame sky update. */
  advance(deltaSeconds: number, weather: VisualWeather = DEFAULT_WEATHER, center?: THREE.Vector3): void {
    this.material.uniforms.cloudTime.value += Math.max(0, deltaSeconds) * THREE.MathUtils.clamp(weather.windSpeedKmh / 12, 0.15, 2.4);
    if (center) {
      this.mesh.position.copy(center);
      this.cloudRoot.position.copy(center);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.cloudRoot.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.cloudGeometry.dispose();
    this.cloudMaterial.dispose();
  }

  private buildCloudBanks(): void {
    // Fixed, sparse bank placement keeps the scene stable while the vehicle
    // moves; each bank has overlapping puffs so cloudy weather has readable
    // silhouettes even at a shallow camera angle.
    for (let bankIndex = 0; bankIndex < 12; bankIndex++) {
      const angle = (bankIndex / 12) * Math.PI * 2 + 0.18;
      // Keep cloud volumes far enough from the vehicle that no individual
      // sphere can cut across the camera's side view.
      const radius = 1_700 + (bankIndex % 4) * 560;
      const bank = new THREE.Group();
      bank.position.set(Math.sin(angle) * radius, 430 + (bankIndex % 3) * 130, Math.cos(angle) * radius);
      bank.rotation.y = -angle;
      for (let puffIndex = 0; puffIndex < 4; puffIndex++) {
        const puff = new THREE.Mesh(this.cloudGeometry, this.cloudMaterial);
        const offset = puffIndex - 1.5;
        puff.position.set(offset * 105, (puffIndex % 2) * 30, Math.sin((bankIndex + 1) * (puffIndex + 2)) * 44);
        puff.scale.set(145 + (puffIndex % 2) * 42, 52 + (puffIndex % 3) * 15, 94 + (puffIndex % 2) * 26);
        puff.renderOrder = -999;
        bank.add(puff);
      }
      this.cloudRoot.add(bank);
    }
  }
}
