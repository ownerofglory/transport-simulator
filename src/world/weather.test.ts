import { describe, expect, it } from 'vitest';
import { daylightForHour, toVisualWeather } from './weather';

describe('Open-Meteo weather mapping', () => {
  it('maps clear and cloudy WMO codes into sky states', () => {
    expect(toVisualWeather({ current: { weather_code: 0, cloud_cover: 4 } }).kind).toBe('clear');
    expect(toVisualWeather({ current: { weather_code: 3, cloud_cover: 92 } }).kind).toBe('cloudy');
  });

  it('gives precipitation codes priority over cloud cover', () => {
    const weather = toVisualWeather({ current: { weather_code: 63, cloud_cover: 100, precipitation: 1.8, visibility: 4_000 } });
    expect(weather.kind).toBe('rain');
    expect(weather.precipitationMm).toBe(1.8);
    expect(weather.visibilityM).toBe(4_000);
  });

  it('maps snow, fog, and thunderstorm WMO groups', () => {
    expect(toVisualWeather({ current: { weather_code: 73 } }).kind).toBe('snow');
    expect(toVisualWeather({ current: { weather_code: 45 } }).kind).toBe('fog');
    expect(toVisualWeather({ current: { weather_code: 95 } }).kind).toBe('thunder');
  });

  it('uses daily local sunrise and sunset for the solar window', () => {
    const weather = toVisualWeather({
      current: { weather_code: 0 },
      daily: { sunrise: ['2026-09-07T06:41'], sunset: ['2026-09-07T19:49'] }
    });
    expect(weather.sunriseHour).toBeCloseTo(6 + 41 / 60);
    expect(weather.sunsetHour).toBeCloseTo(19 + 49 / 60);
    expect(daylightForHour(5, weather)).toBe(0);
    expect(daylightForHour(13.25, weather)).toBeGreaterThan(0.99);
  });
});
