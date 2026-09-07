import { useEffect, useState } from 'react';
import type { CityDefinition } from '../../cities';
import type { DemoRoute } from '../../route';
import { fetchWeatherReport, weatherLocationFor, type WeatherKind, type WeatherReport } from '../../world/weather';

type Props = { city: CityDefinition | null; route: DemoRoute | undefined };

/** Compact display of the current city condition that drives the 3D weather. */
export function CityWeatherForecast({ city, route }: Props) {
  const [report, setReport] = useState<WeatherReport | null>(null);

  useEffect(() => {
    setReport(null);
    if (!city || !route) return;
    const location = weatherLocationFor(city, route);
    if (!location) return;
    const abort = new AbortController();
    void fetchWeatherReport(location, abort.signal).then(
      (next) => { if (!abort.signal.aborted) setReport(next); },
      () => { /* The renderer keeps a clear-weather fallback if the service is unavailable. */ }
    );
    return () => abort.abort();
  }, [city, route]);

  if (!city || !report) return null;
  return (
    <section className="weather-current" aria-label={`Current weather for ${city.name}`}>
      <span className="weather-current-icon" aria-hidden>{weatherIcon(report.current.kind)}</span>
      <span>{city.name}</span>
      <span>{weatherLabel(report.current.kind)}</span>
      {report.current.temperatureC !== null && <strong>{Math.round(report.current.temperatureC)}°</strong>}
      <span className="weather-current-wind">{Math.round(report.current.windSpeedKmh)} km/h</span>
    </section>
  );
}

function weatherIcon(kind: WeatherKind): string {
  return ({ clear: '☀︎', cloudy: '☁︎', fog: '≋', rain: '🌧︎', snow: '❄︎', thunder: '⛈︎' })[kind];
}

function weatherLabel(kind: WeatherKind): string {
  return ({ clear: 'Clear', cloudy: 'Cloudy', fog: 'Fog', rain: 'Rain', snow: 'Snow', thunder: 'Thunderstorms' })[kind];
}
