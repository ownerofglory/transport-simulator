import type { CityDefinition } from '../../cities';
import type { TransportMode } from '../../domain/transport';
import type { DemoRoute } from '../../route';

/** Everything the shell needs once the catalog + selected routes are loaded. */
export type LoadedCatalog = {
  cities: CityDefinition[];
  currentCity: CityDefinition;
  routes: DemoRoute[];
  availableModes: TransportMode[];
  attribution: string;
};

/**
 * Catalog bootstrap as an explicit state machine, replacing the loose
 * ready/loadingMessage/error/initialized flags the hook used to juggle. The
 * `operationId` carried through `loading-routes` lets stale async responses be
 * rejected so a slow request cannot overwrite a newer city selection.
 */
export type BootstrapState =
  | { value: 'loading-cities' }
  | { value: 'loading-manifest'; cityId: string }
  | { value: 'loading-routes'; cityId: string; mode: TransportMode; operationId: number }
  | { value: 'ready'; catalog: LoadedCatalog }
  | { value: 'failed'; error: Error };

export type BootstrapEvent =
  | { type: 'LOAD_MANIFEST'; cityId: string }
  | { type: 'LOAD_ROUTES'; cityId: string; mode: TransportMode; operationId: number }
  | { type: 'ROUTES_LOADED'; operationId: number; catalog: LoadedCatalog }
  | { type: 'FAIL'; operationId?: number; error: Error };

export function bootstrapInitialState(): BootstrapState {
  return { value: 'loading-cities' };
}

/**
 * Pure transition. A `LOAD_MANIFEST` (city selection) supersedes any in-flight
 * route load; late `ROUTES_LOADED`/`FAIL` events whose operationId no longer
 * matches the active load are ignored.
 */
export function bootstrapTransition(state: BootstrapState, event: BootstrapEvent): BootstrapState {
  switch (event.type) {
    case 'LOAD_MANIFEST':
      // A newer city selection always wins, even over a ready/failed state.
      return { value: 'loading-manifest', cityId: event.cityId };
    case 'LOAD_ROUTES':
      return state.value === 'loading-manifest' && state.cityId === event.cityId
        ? { value: 'loading-routes', cityId: event.cityId, mode: event.mode, operationId: event.operationId }
        : state;
    case 'ROUTES_LOADED':
      return state.value === 'loading-routes' && state.operationId === event.operationId
        ? { value: 'ready', catalog: event.catalog }
        : state;
    case 'FAIL':
      // Ignore failures from a superseded operation; unscoped failures always apply.
      if (event.operationId !== undefined && state.value === 'loading-routes' && state.operationId !== event.operationId) {
        return state;
      }
      return { value: 'failed', error: event.error };
    default:
      return state;
  }
}
