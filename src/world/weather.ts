import type { CityDefinition } from '../cities';
import type { DemoRoute } from '../route';
import type { Season } from '../app/types';

export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunder';

export type VisualWeather = {
  kind: WeatherKind;
  cloudCover: number;
  precipitationMm: number;
  snowfallCm: number;
  windSpeedKmh: number;
  temperatureC: number | null;
  visibilityM: number;
  isDay: boolean;
  sunriseHour: number;
  sunsetHour: number;
};

export type WeatherForecastDay = {
  date: string;
  kind: WeatherKind;
  highC: number | null;
  lowC: number | null;
  precipitationProbability: number | null;
};

export type WeatherReport = {
  current: VisualWeather;
  forecast: WeatherForecastDay[];
};

export type SolarPosition = {
  /** East-to-west position around the horizon, in radians. */
  azimuthRad: number;
  /** Signed altitude above the horizon; negative means the sun is below it. */
  elevationRad: number;
  daylight: number;
  twilight: number;
};

type WeatherApiResponse = {
  current?: {
    weather_code?: number;
    cloud_cover?: number;
    precipitation?: number;
    rain?: number;
    snowfall?: number;
    wind_speed_10m?: number;
    temperature_2m?: number;
    visibility?: number;
    is_day?: number;
  };
  daily?: {
    time?: string[];
    sunrise?: string[];
    sunset?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

type LatLon = { lat: number; lon: number };

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const CURRENT_FIELDS = 'temperature_2m,weather_code,cloud_cover,precipitation,rain,snowfall,wind_speed_10m,visibility,is_day';
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; report: WeatherReport }>();

const CITY_CENTRES: Record<string, LatLon> = {
  stuttgart: { lat: 48.7758, lon: 9.1829 },
  ulm: { lat: 48.4011, lon: 9.9876 },
  odessa: { lat: 46.4825, lon: 30.7233 },
  zurich: { lat: 47.3769, lon: 8.5417 },
  freiburg: { lat: 47.9990, lon: 7.8421 },
  lviv: { lat: 49.8397, lon: 24.0297 },
  'mexico-city': { lat: 19.4326, lon: -99.1332 },
  bodo: { lat: 47.6980, lon: 9.4790 },
  'baden-wuerttemberg-rail': { lat: 48.7758, lon: 9.1829 },
  wuppertal: { lat: 51.2562, lon: 7.1508 },
  vancouver: { lat: 49.2827, lon: -123.1207 },
  karlsruhe: { lat: 49.0069, lon: 8.4037 }
};

export const DEFAULT_WEATHER: VisualWeather = {
  kind: 'clear', cloudCover: 0.1, precipitationMm: 0, snowfallCm: 0, windSpeedKmh: 8, temperatureC: null, visibilityM: 20_000, isDay: true, sunriseHour: 6, sunsetHour: 18
};

/** Uses the selected city centre, falling back to the current route midpoint for future cities. */
export function weatherLocationFor(city: CityDefinition | undefined, route: DemoRoute): LatLon | null {
  if (city && CITY_CENTRES[city.id]) return CITY_CENTRES[city.id];
  const points = route.geoPoints;
  if (!points?.length) return null;
  const point = points[Math.floor(points.length / 2)];
  return { lat: point[0], lon: point[1] };
}

/** Fetches the current, keyless Open-Meteo condition set and maps WMO codes to rendering states. */
export async function fetchCurrentWeather(location: LatLon, signal?: AbortSignal): Promise<VisualWeather> {
  return (await fetchWeatherReport(location, signal)).current;
}

/** Fetches current conditions plus a small local daily forecast for the HUD. */
export async function fetchWeatherReport(location: LatLon, signal?: AbortSignal): Promise<WeatherReport> {
  const cacheKey = `${location.lat.toFixed(3)},${location.lon.toFixed(3)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.report;

  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('latitude', String(location.lat));
  url.searchParams.set('longitude', String(location.lon));
  url.searchParams.set('current', CURRENT_FIELDS);
  url.searchParams.set('daily', 'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('forecast_days', '3');
  url.searchParams.set('timezone', 'auto');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Open-Meteo weather request failed: ${response.status}`);
  const apiResponse = (await response.json()) as WeatherApiResponse;
  const report = { current: toVisualWeather(apiResponse), forecast: toForecast(apiResponse) };
  cache.set(cacheKey, { report, expiresAt: Date.now() + CACHE_TTL_MS });
  return report;
}

export function toVisualWeather(response: WeatherApiResponse): VisualWeather {
  const current = response.current ?? {};
  const weatherCode = current.weather_code ?? 0;
  const precipitationMm = Math.max(0, current.precipitation ?? current.rain ?? 0);
  const snowfallCm = Math.max(0, current.snowfall ?? 0);
  return {
    kind: kindForWmoCode(weatherCode, precipitationMm, snowfallCm),
    cloudCover: clamp01((current.cloud_cover ?? (weatherCode === 0 ? 5 : 70)) / 100),
    precipitationMm,
    snowfallCm,
    windSpeedKmh: Math.max(0, current.wind_speed_10m ?? 0),
    temperatureC: current.temperature_2m ?? null,
    visibilityM: Math.max(200, current.visibility ?? 20_000),
    isDay: current.is_day !== 0,
    sunriseHour: localHour(response.daily?.sunrise?.[0], DEFAULT_WEATHER.sunriseHour),
    sunsetHour: localHour(response.daily?.sunset?.[0], DEFAULT_WEATHER.sunsetHour)
  };
}

function toForecast(response: WeatherApiResponse): WeatherForecastDay[] {
  const daily = response.daily;
  const days = daily?.time ?? [];
  return days.slice(0, 3).map((date, index) => {
    const code = daily?.weather_code?.[index] ?? 0;
    return {
      date,
      kind: kindForWmoCode(code, 0, 0),
      highC: daily?.temperature_2m_max?.[index] ?? null,
      lowC: daily?.temperature_2m_min?.[index] ?? null,
      precipitationProbability: daily?.precipitation_probability_max?.[index] ?? null
    };
  });
}

/** Daylight strength follows the forecast's city-local sun window, not a fixed 06:00–18:00 assumption. */
export function daylightForHour(hour: number, weather: Pick<VisualWeather, 'sunriseHour' | 'sunsetHour'>): number {
  const length = Math.max(1, weather.sunsetHour - weather.sunriseHour);
  const progress = Math.min(1, Math.max(0, (hour - weather.sunriseHour) / length));
  return Math.sin(progress * Math.PI);
}

/** Rendering floor for WMO conditions when a provider's measured percentage is delayed or missing. */
export function effectiveCloudCover(weather: Pick<VisualWeather, 'kind' | 'cloudCover'>): number {
  const conditionFloor: Partial<Record<WeatherKind, number>> = {
    cloudy: 0.68,
    fog: 0.96,
    rain: 0.84,
    snow: 0.76,
    thunder: 0.94
  };
  return clamp01(Math.max(weather.cloudCover, conditionFloor[weather.kind] ?? 0));
}

/**
 * A lightweight city-local solar arc. Sunrise and sunset come from Open-Meteo;
 * season changes the peak elevation so a winter noon stays visibly lower than
 * a summer one even when the user picks the same clock hour.
 */
export function solarPositionForHour(hour: number, weather: Pick<VisualWeather, 'sunriseHour' | 'sunsetHour'>, season: Season): SolarPosition {
  const dayLength = Math.max(1, weather.sunsetHour - weather.sunriseHour);
  const phase = (hour - weather.sunriseHour) / dayLength;
  const arc = Math.sin(phase * Math.PI);
  const maxElevation: Record<Season, number> = {
    spring: THREE_QUARTER_PI,
    summer: 1.12,
    autumn: 0.62,
    winter: 0.34
  };
  const daylight = Math.max(0, arc);
  return {
    azimuthRad: -Math.PI / 2 + phase * Math.PI,
    elevationRad: arc * maxElevation[season],
    daylight,
    twilight: Math.max(0, 1 - Math.abs(hour - weather.sunriseHour) / 1.35, 1 - Math.abs(hour - weather.sunsetHour) / 1.35)
  };
}

const THREE_QUARTER_PI = Math.PI * 0.75;

function kindForWmoCode(code: number, precipitationMm: number, snowfallCm: number): WeatherKind {
  if (snowfallCm > 0 || [71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunder';
  if (precipitationMm > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([45, 48].includes(code)) return 'fog';
  if ([1, 2, 3].includes(code)) return 'cloudy';
  return 'clear';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function localHour(isoTime: string | undefined, fallback: number): number {
  if (!isoTime) return fallback;
  const match = isoTime.match(/T(\d{2}):(\d{2})/);
  if (!match) return fallback;
  return Number(match[1]) + Number(match[2]) / 60;
}
