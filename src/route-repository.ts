import { loadCityCatalog, resolveCities, stuttgartCity, type CityDefinition } from './cities';
import { loadRouteManifest, loadRoutesForMode, type DemoRoute, type RouteFeedManifest } from './route';
import type { TransportMode } from './domain/transport';

/**
 * Owns city catalog + lazy per-city/mode route loading and caching, independent
 * of React state so the React shell can await it during bootstrap.
 */
export class RouteRepository {
  private readonly routes = new Map<string, DemoRoute[]>();
  private readonly manifests = new Map<string, RouteFeedManifest>();

  /** Loads the resolved city catalog. */
  async loadCities(): Promise<CityDefinition[]> {
    return resolveCities(await loadCityCatalog());
  }

  /** Loads (and caches) one city's route manifest. */
  async loadManifest(city: CityDefinition): Promise<RouteFeedManifest> {
    const cached = this.manifests.get(city.id);
    if (cached) return cached;
    const manifest = await loadRouteManifest(city.manifestFile, city.routeManifestFallback);
    this.manifests.set(city.id, manifest);
    return manifest;
  }

  /** Loads (and caches) the routes for a city/mode, returning them with attribution. */
  async loadRoutes(city: CityDefinition, mode: TransportMode): Promise<{ routes: DemoRoute[]; attribution: string }> {
    const key = `${city.id}:${mode}`;
    const manifest = await this.loadManifest(city);
    const cached = this.routes.get(key);
    if (cached) return { routes: cached, attribution: manifest.attribution };
    const loaded = await loadRoutesForMode(mode, manifest, city.demoRoutesFallback, city.routeManifestFallback.attribution);
    this.routes.set(key, loaded.routes);
    return loaded;
  }
}

export { stuttgartCity };
