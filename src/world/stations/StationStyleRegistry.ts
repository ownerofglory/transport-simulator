import type { StationStyleProvider } from './types';

/**
 * Keyed lookup of station style providers by `stationStyleId`. Cities/modes
 * register their provider once; StationLayer resolves by id at build time.
 * New styles register without editing existing dispatch logic, preserving
 * multi-city support (e.g. `vvs-stadtbahn`, `db-sbahn`, `odessa-tram`).
 */
export class StationStyleRegistry {
  private readonly providers = new Map<string, StationStyleProvider>();

  register(provider: StationStyleProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  resolveOptional(id: string | undefined): StationStyleProvider | undefined {
    return id ? this.providers.get(id) : undefined;
  }
}
