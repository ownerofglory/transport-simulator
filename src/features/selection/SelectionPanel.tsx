import type { BootstrapResult } from '../../app/useAppBootstrap';
import { useAppState } from '../../app/useAppState';
import { TransportModeTabs } from './TransportModeTabs';

/** City / transport-mode / route / start-station / ride-mode / time selectors. */
export function SelectionPanel({ catalog }: { catalog: BootstrapResult }) {
  const { state, dispatch } = useAppState();
  const route = catalog.routes.find((entry) => entry.id === state.selectedRouteId);
  const stations = route?.stations.slice(0, Math.max(1, route.stations.length - 1)) ?? [];

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
            <option key={item.id} value={item.id}>{item.line} to {item.destination}</option>
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
        <select
          aria-label="Mode"
          value={state.selectedMode}
          onChange={(e) => dispatch({ type: 'ride-mode-selected', mode: e.target.value as 'ride' | 'driver' })}
        >
          <option value="ride">Ride</option>
          <option value="driver">Drive</option>
        </select>
        <select
          aria-label="Time of day"
          value={state.selectedTime}
          onChange={(e) => dispatch({ type: 'time-selected', time: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}
        >
          <option value="auto">Local time (auto)</option>
          <option value="6">06:00 · Dawn</option>
          <option value="9">09:00 · Morning</option>
          <option value="13">13:00 · Day</option>
        </select>
      </div>
    </>
  );
}
