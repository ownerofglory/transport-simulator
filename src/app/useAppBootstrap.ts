import { useEffect, useRef, useState } from 'react';
import type { CityDefinition } from '../cities';
import type { TransportMode } from '../domain/transport';
import type { DemoRoute } from '../route';
import { RouteRepository, stuttgartCity } from '../route-repository';
import { readUrlState } from './AppUrlState';
import { useAppState } from './useAppState';
import { searchJourneys } from '../features/realtime/api';
import { enrichRouteFromTerrain } from '../features/realtime/catalogTerrain';
import { buildJourneyRoute } from '../features/realtime/journeyRoute';

export type BootstrapResult = {
  ready: boolean;
  loadingMessage: string | null;
  error: Error | null;
  cities: CityDefinition[];
  currentCity: CityDefinition | null;
  routes: DemoRoute[];
  availableModes: TransportMode[];
  attribution: string;
};

/**
 * Loads the city catalog, then lazily loads the manifest + routes for the
 * selected city/mode, dispatching resolved selections back into app state.
 * All Three.js / rendering work stays out of here.
 */
export function useAppBootstrap(): BootstrapResult {
  const { state, dispatch } = useAppState();
  const repository = useRef<RouteRepository | null>(null);
  repository.current ??= new RouteRepository();
  const initialUrl = useRef(readUrlState());
  const initialized = useRef(false);
  const restoredRealtime = useRef(false);
  const operation = useRef(0);
  const [result, setResult] = useState<BootstrapResult>({
    ready: false,
    loadingMessage: 'Loading city catalog...',
    error: null,
    cities: [],
    currentCity: null,
    routes: [],
    availableModes: [],
    attribution: ''
  });

  // 1. Load the city catalog once and apply URL-derived environment state.
  useEffect(() => {
    let active = true;
    void repository.current!.loadCities()
      .then((cities) => {
        if (!active) return;
        const requested = initialUrl.current.city;
        const city = cities.find((entry) => entry.id === requested) ?? cities[0] ?? stuttgartCity;
        const url = initialUrl.current;
        dispatch({
          type: 'initial-state-loaded',
          state: {
            selectedCityId: city.id,
            ...(url.rideMode && { selectedMode: url.rideMode }),
            ...(url.season && { selectedSeason: url.season }),
            ...(url.time !== undefined && { selectedTime: url.time }),
            ...(url.cameraMode && { selectedCameraMode: url.cameraMode })
          }
        });
        setResult((old) => ({ ...old, cities, currentCity: city, loadingMessage: `Loading ${city.name} routes...` }));
      })
      .catch((error: unknown) => setResult((old) => ({ ...old, error: asError(error), loadingMessage: null })));
    return () => {
      active = false;
    };
  }, [dispatch]);

  // 2. For the selected city/mode, load the manifest + routes and resolve a route.
  useEffect(() => {
    if (!result.cities.length) return;
    const id = ++operation.current;
    const city = result.cities.find((entry) => entry.id === state.selectedCityId) ?? result.cities[0] ?? stuttgartCity;
    void repository.current!.loadManifest(city)
      .then(async (manifest) => {
        const availableModes = manifest.modes.map((entry) => entry.mode);
        const requested = !initialized.current ? initialUrl.current.transportMode : state.selectedTransportMode;
        const mode = requested && availableModes.includes(requested) ? requested : city.defaultTransportMode;
        const loaded = await repository.current!.loadRoutes(city, mode);
        if (id !== operation.current) return;
        const preferred = !initialized.current ? initialUrl.current.routeId : state.selectedRouteId;
        const route = loaded.routes.find((entry) => entry.id === preferred)
          ?? loaded.routes.find((entry) => entry.id === city.defaultRouteIdByMode?.[mode])
          ?? loaded.routes.find((entry) => entry.line === city.defaultLineByMode[mode])
          ?? loaded.routes[0];
        if (!route) throw new Error(`No ${mode} routes are available for ${city.name}`);
        const station = !initialized.current ? initialUrl.current.startStationIndex ?? 0 : 0;
        initialized.current = true;
        dispatch({
          type: 'initial-state-loaded',
          state: {
            selectedCityId: city.id,
            selectedTransportMode: mode,
            selectedRouteId: route.id,
            selectedStartStation: Math.min(station, Math.max(0, route.stations.length - 1))
          }
        });
        setResult({ ready: true, loadingMessage: null, error: null, cities: result.cities, currentCity: city, routes: loaded.routes, availableModes, attribution: loaded.attribution });
      })
      .catch((error: unknown) => {
        if (id === operation.current) setResult((old) => ({ ...old, error: asError(error), loadingMessage: null }));
      });
  }, [state.selectedCityId, state.selectedTransportMode, result.cities, dispatch]);

  // A realtime URL stores its endpoints and journey id, then refreshes the
  // live result on load rather than putting a potentially huge geometry blob in
  // the address bar.
  useEffect(() => {
    const saved = initialUrl.current.realtime;
    if (!saved || restoredRealtime.current || !result.ready) return;
    restoredRealtime.current = true;
    void searchJourneys({
      origin: saved.origin,
      originId: saved.origin.id,
      destination: saved.destination,
      destinationId: saved.destination.id
    }).then(async (journeys) => {
      const journey = journeys.find((candidate) => candidate.id === saved.journeyId);
      if (!journey) return;
      const route = buildJourneyRoute(journey, saved.origin, saved.destination);
      await Promise.all([route, ...(route.journeyLegs ?? [])].map((leg) => enrichRouteFromTerrain(leg).catch(() => false)));
      dispatch({ type: 'realtime-route-simulated', route, journey: { origin: saved.origin, destination: saved.destination, journey } });
    }).catch(() => undefined);
  }, [result.ready, dispatch]);

  return result;
}

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
