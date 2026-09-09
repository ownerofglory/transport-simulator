import type { BootstrapResult } from '../../app/useAppBootstrap';
import { useAppState } from '../../app/useAppState';
import { TransportModeTabs } from './TransportModeTabs';

/** Compact city, line, operating-mode, and time selectors. */
export function SelectionPanel({ catalog }: { catalog: BootstrapResult }) {
  const { state, dispatch } = useAppState();
  const route = catalog.routes.find((entry) => entry.id === state.selectedRouteId);
  const stations = route?.stations.slice(0, Math.max(1, route.stations.length - 1)) ?? [];
  const routeLabels = routeOptionLabels(catalog.routes);

  return (
    <>
      <div className="toolbar city-toolbar">
        <select
          aria-label="City"
          value={state.selectedCityId}
          onChange={(e) => dispatch({ type: 'city-selected', cityId: e.target.value })}
        >
          {catalog.cities.map((city) => (
            <option key={city.id} value={city.id}>{city.name}</option>
          ))}
        </select>
      </div>
      {catalog.currentCity && (
        <TransportModeTabs
          definitions={catalog.currentCity.transportModes}
          available={catalog.availableModes}
          selected={state.selectedTransportMode}
          onSelect={(mode) => dispatch({ type: 'transport-mode-selected', mode })}
        />
      )}
      <div className="toolbar">
        <select
          aria-label="Line"
          value={state.selectedRouteId}
          onChange={(e) => dispatch({ type: 'route-selected', routeId: e.target.value })}
        >
          {catalog.routes.map((item) => (
            <option key={item.id} value={item.id}>{routeLabels.get(item.id)}</option>
          ))}
        </select>
        <select
          aria-label="Start station"
          value={state.selectedStartStation}
          onChange={(e) => dispatch({ type: 'start-station-selected', stationIndex: Number(e.target.value) })}
        >
          {stations.map((station, index) => (
            <option key={`${station.name}-${index}`} value={index}>{station.name}</option>
          ))}
        </select>
      </div>
      <div className="compact-settings" aria-label="Operating mode and time of day">
        <div className="compact-switch" aria-label="Mode">
          <button className={state.selectedMode === 'ride' ? 'active' : ''} aria-label="Ride mode" aria-pressed={state.selectedMode === 'ride'} title="Ride mode" onClick={() => dispatch({ type: 'ride-mode-selected', mode: 'ride' })}>◉</button>
          <button className={state.selectedMode === 'driver' ? 'active' : ''} aria-label="Drive mode" aria-pressed={state.selectedMode === 'driver'} title="Drive mode" onClick={() => dispatch({ type: 'ride-mode-selected', mode: 'driver' })}>⌁</button>
        </div>
        <div className="compact-switch" aria-label="Time of day">
          <button className={state.selectedTime === 'auto' ? 'active' : ''} aria-label="Use local time" aria-pressed={state.selectedTime === 'auto'} title="Local time" onClick={() => dispatch({ type: 'time-selected', time: 'auto' })}>◷</button>
          <button className={state.selectedTime === 6 ? 'active' : ''} aria-label="Dawn, 06:00" aria-pressed={state.selectedTime === 6} title="06:00 · Dawn" onClick={() => dispatch({ type: 'time-selected', time: 6 })}>◒</button>
          <button className={state.selectedTime === 9 ? 'active' : ''} aria-label="Morning, 09:00" aria-pressed={state.selectedTime === 9} title="09:00 · Morning" onClick={() => dispatch({ type: 'time-selected', time: 9 })}>◐</button>
          <button className={state.selectedTime === 13 ? 'active' : ''} aria-label="Day, 13:00" aria-pressed={state.selectedTime === 13} title="13:00 · Day" onClick={() => dispatch({ type: 'time-selected', time: 13 })}>☀︎</button>
        </div>
      </div>
    </>
  );
}

/** Adds the route description only where line + destination would be ambiguous. */
function routeOptionLabels(routes: BootstrapResult['routes']): Map<string, string> {
  const counts = new Map<string, number>();
  for (const route of routes) {
    const key = `${route.line}\u0000${route.destination}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map(routes.map((route) => {
    const base = `${route.line} to ${route.destination}`;
    const key = `${route.line}\u0000${route.destination}`;
    return [route.id, counts.get(key)! > 1 ? `${base} · ${route.description}` : base];
  }));
}
