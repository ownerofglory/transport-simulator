import * as THREE from 'three';
import type { Season } from '../app/types';
import { daylightForHour, DEFAULT_WEATHER, type VisualWeather } from './weather';

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
  uniform vec3 cloudColor;
  uniform vec3 sunColor;
  uniform float cloudCover;
  uniform float daylight;
  uniform float sunAzimuth;
  uniform float sunHeight;
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
  void main() {
    vec3 dir = normalize(vDirection);
    float horizon = smoothstep(-0.16, 0.56, dir.y);
    vec3 sky = mix(horizonColor, zenithColor, horizon);
    vec2 cloudUv = vec2(atan(dir.z, dir.x) * 0.75, dir.y * 2.4 + 0.3);
    float cloudField = fbm(cloudUv);
    float clouds = smoothstep(0.66 - cloudCover * 0.46, 0.86 - cloudCover * 0.20, cloudField);
    float cloudMask = clouds * smoothstep(-0.12, 0.72, dir.y) * mix(0.12, 0.96, cloudCover);
    sky = mix(sky, cloudColor, cloudMask);
    vec3 sunDir = normalize(vec3(cos(sunAzimuth), sunHeight, sin(sunAzimuth)));
    float sun = pow(max(dot(dir, sunDir), 0.0), 780.0) * daylight * (1.0 - cloudCover * 0.94);
    float glow = pow(max(dot(dir, sunDir), 0.0), 10.0) * daylight * (1.0 - cloudCover * 0.62);
    gl_FragColor = vec4(sky + sunColor * (sun * 1.8 + glow * 0.16), 1.0);
  }
`;

/** Visible sky dome with forecast-driven cloud cover, separate from the reflection environment. */
export class WeatherSky {
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenithColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      cloudColor: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      cloudCover: { value: 0 },
      daylight: { value: 1 },
      sunAzimuth: { value: 0 },
      sunHeight: { value: 0.7 }
    }
  });
  private readonly mesh = new THREE.Mesh(new THREE.SphereGeometry(50_000, 32, 16), this.material);

  constructor(scene: THREE.Scene) {
    this.mesh.name = 'Forecast-driven procedural sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1_000;
    scene.add(this.mesh);
  }

  update(season: Season, hour: number, weather: VisualWeather = DEFAULT_WEATHER, underground = false): void {
    const daylight = THREE.MathUtils.smoothstep(daylightForHour(hour, weather), 0, 1);
    const palette: Record<Season, [number, number]> = {
      spring: [0x4b87bc, 0xc8e2f2],
      summer: [0x337fc1, 0xd8f0ff],
      autumn: [0x756b72, 0xd6b28b],
      winter: [0x71899a, 0xdde8ee]
    };
    const [zenith, horizon] = palette[season];
    const cloudiness = weather.kind === 'fog' ? 0.96 : Math.max(weather.cloudCover, weather.kind === 'rain' || weather.kind === 'thunder' ? 0.84 : 0);
    const fogTint = weather.kind === 'snow' ? 0xd5dfe4 : weather.kind === 'thunder' ? 0x4a4d56 : 0x75808a;
    (this.material.uniforms.zenithColor.value as THREE.Color).setHex(zenith).lerp(new THREE.Color(fogTint), cloudiness * 0.65).multiplyScalar(0.28 + daylight * 0.72);
    (this.material.uniforms.horizonColor.value as THREE.Color).setHex(horizon).lerp(new THREE.Color(fogTint), cloudiness * 0.45).multiplyScalar(0.24 + daylight * 0.76);
    (this.material.uniforms.cloudColor.value as THREE.Color).setHex(weather.kind === 'snow' ? 0xe2e8eb : 0xa8b0b6);
    (this.material.uniforms.sunColor.value as THREE.Color).setHex(hour < weather.sunriseHour + 1 || hour > weather.sunsetHour - 1 ? 0xffa668 : 0xfff5dc);
    this.material.uniforms.cloudCover.value = cloudiness;
    this.material.uniforms.daylight.value = daylight;
    this.material.uniforms.sunAzimuth.value = ((hour - weather.sunriseHour) / Math.max(1, weather.sunsetHour - weather.sunriseHour)) * Math.PI;
    this.material.uniforms.sunHeight.value = Math.max(0.03, daylight * 0.92);
    this.mesh.visible = !underground;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
