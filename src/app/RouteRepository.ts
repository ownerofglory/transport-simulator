import { loadRouteManifest, loadRoutesForMode, type DemoRoute, type RouteFeedManifest } from '../route';
import { transportModeLabel, type TransportMode } from '../domain/transport';
import type { CityDefinition } from '../cities';

/**
 * Owns city route manifests, lazy per-city/mode route loading, in-memory
 * caching, fallbacks, and the active GTFS attribution string.
 *
 * Route packages are loaded lazily per city+mode so switching cities does not
 * fetch every mode. The repository holds no UI concerns: callers decide when to
 * show loading progress, using {@link hasRoutes} to detect a cache hit first.
 */
export class RouteRepository {
  // Keyed by `${cityId}:${mode}` so each city/mode combination is fetched once.
  private readonly routesByCityMode = new Map<string, DemoRoute[]>();
  private readonly manifestsByCity = new Map<string, RouteFeedManifest>();
  private attributionText = 'VVS GTFS route package has not loaded yet.';

  /** Latest data-source attribution from the most recently loaded manifest/feed. */
  get attribution(): string {
    return this.attributionText;
  }

  /** Loads and caches one city's route manifest, falling back to built-in metadata. */
  async loadManifest(city: CityDefinition): Promise<RouteFeedManifest> {
    const manifest = await loadRouteManifest(city.manifestFile, city.routeManifestFallback);
    this.manifestsByCity.set(city.id, manifest);
    this.attributionText = manifest.attribution;
    return manifest;
  }

  /** Returns the cached manifest for a city, or null if it has not been loaded. */
  manifestForCity(cityId: string): RouteFeedManifest | null {
    return this.manifestsByCity.get(cityId) ?? null;
  }

  /** Transport modes advertised by a city's manifest, or its default if unloaded. */
  availableModes(city: CityDefinition): TransportMode[] {
    return this.manifestsByCity.get(city.id)?.modes.map((mode) => mode.mode) ?? [city.defaultTransportMode];
  }

  /** Human-readable "Loading … routes" label for a mode, for progress display. */
  routesLoadingLabel(city: CityDefinition, mode: TransportMode): string {
    return `Loading ${city.name} ${transportModeLabel(mode, city.transportModes)} routes...`;
  }

  /** True when routes for the city/mode are already cached (no fetch needed). */
  hasRoutes(cityId: string, mode: TransportMode): boolean {
    return this.routesByCityMode.has(`${cityId}:${mode}`);
  }

  /** Lazily loads (and caches) route packages for a city/mode, returning them. */
  async loadRoutes(city: CityDefinition, mode: TransportMode): Promise<DemoRoute[]> {
    const manifest = this.manifestsByCity.get(city.id);
    if (!manifest) return [];

    const cacheKey = `${city.id}:${mode}`;
    const cached = this.routesByCityMode.get(cacheKey);
    if (cached) return cached;

    const loaded = await loadRoutesForMode(
      mode,
      manifest,
      city.demoRoutesFallback,
      city.routeManifestFallback.attribution
    );

    this.attributionText = loaded.attribution;
    this.routesByCityMode.set(cacheKey, loaded.routes);
    return loaded.routes;
  }

  /** Returns already-loaded routes for a city/mode, or an empty array. */
  routesFor(cityId: string, mode: TransportMode): DemoRoute[] {
    return this.routesByCityMode.get(`${cityId}:${mode}`) ?? [];
  }

  /** Resolves a single loaded route by id within a city/mode. */
  resolveRoute(cityId: string, mode: TransportMode, routeId: string): DemoRoute | undefined {
    return this.routesFor(cityId, mode).find((route) => route.id === routeId);
  }
}
