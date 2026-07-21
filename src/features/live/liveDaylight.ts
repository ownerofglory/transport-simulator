// Time-of-day daylight curve for the live 3D view (concept §2.5: "the world's
// lighting keeps following real local time"). Pure and unit-tested; Live3DScene
// samples it from the real local hour and drives the sun, sky and fog.

export type Daylight = {
  skyColor: number; // hex; used for scene background + fog
  sunColor: number; // hex directional light color
  sunIntensity: number;
  hemiIntensity: number; // ambient sky/ground fill
  elevationDeg: number; // sun height above the horizon
  azimuthRad: number; // sun horizontal direction (east → west across the day)
};

type Keyframe = { h: number; sky: number; sun: number; sunI: number; hemiI: number; elev: number };

// Hour-sorted keyframes spanning a full day. The 0:00 and 24:00 frames match so
// the curve is continuous across midnight.
const KEYS: Keyframe[] = [
  { h: 0, sky: 0x0a1420, sun: 0x33405c, sunI: 0.15, hemiI: 0.25, elev: -12 },
  { h: 5, sky: 0x1c2a3e, sun: 0x556080, sunI: 0.25, hemiI: 0.35, elev: -4 },
  { h: 6.5, sky: 0xc9895f, sun: 0xffc08a, sunI: 0.9, hemiI: 0.6, elev: 6 },
  { h: 8, sky: 0x8fb8dd, sun: 0xfff0dd, sunI: 1.4, hemiI: 0.85, elev: 22 },
  { h: 12, sky: 0x9fc6e8, sun: 0xffffff, sunI: 1.75, hemiI: 1.0, elev: 60 },
  { h: 16, sky: 0x9cc2e2, sun: 0xfff2e0, sunI: 1.45, hemiI: 0.9, elev: 30 },
  { h: 18.5, sky: 0xd6885a, sun: 0xffb073, sunI: 0.95, hemiI: 0.6, elev: 6 },
  { h: 20.5, sky: 0x21344c, sun: 0x54618a, sunI: 0.3, hemiI: 0.4, elev: -4 },
  { h: 24, sky: 0x0a1420, sun: 0x33405c, sunI: 0.15, hemiI: 0.25, elev: -12 }
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Interpolates two packed 0xRRGGBB colors per channel.
function lerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

/** Daylight parameters at a local hour (0–24, fractional). */
export function daylightAt(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  let lo = KEYS[0];
  let hi = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (h >= KEYS[i].h && h <= KEYS[i + 1].h) {
      lo = KEYS[i];
      hi = KEYS[i + 1];
      break;
    }
  }
  const span = hi.h - lo.h;
  const t = span > 0 ? (h - lo.h) / span : 0;

  // Sun sweeps from the east before noon to the west after (a plausible arc, not
  // an astronomical ephemeris).
  const azimuthRad = ((h - 12) / 24) * 2 * Math.PI;

  return {
    skyColor: lerpHex(lo.sky, hi.sky, t),
    sunColor: lerpHex(lo.sun, hi.sun, t),
    sunIntensity: lerp(lo.sunI, hi.sunI, t),
    hemiIntensity: lerp(lo.hemiI, hi.hemiI, t),
    elevationDeg: lerp(lo.elev, hi.elev, t),
    azimuthRad
  };
}
