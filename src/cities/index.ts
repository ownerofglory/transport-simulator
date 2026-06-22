import { stuttgartCity } from './stuttgart';
import { ulmCity } from './ulm';
import type { CityCatalog, CityCatalogEntry, CityDefinition } from './types';

const registry = new Map<string, CityDefinition>([
  [stuttgartCity.id, stuttgartCity],
  [ulmCity.id, ulmCity]
]);

const fallbackCatalog: CityCatalog = {
  generatedAt: new Date(0).toISOString(),
  cities: [
    {
      id: stuttgartCity.id,
      name: stuttgartCity.name,
      title: stuttgartCity.title,
      description: stuttgartCity.description,
      manifestFile: stuttgartCity.manifestFile,
      defaultTransportMode: stuttgartCity.defaultTransportMode
    },
    {
      id: ulmCity.id,
      name: ulmCity.name,
      title: ulmCity.title,
      description: ulmCity.description,
      manifestFile: ulmCity.manifestFile,
      defaultTransportMode: ulmCity.defaultTransportMode
    }
  ]
};

function mergeCityEntry(entry: CityCatalogEntry): CityDefinition {
  const registered = registry.get(entry.id);
  if (!registered) {
    return {
      ...stuttgartCity,
      ...entry,
      shortLabel: entry.name,
      menuTitle: entry.title,
      noticeNetworkName: entry.name,
      freeRideNotice: 'Free non-commercial simulator.',
      transportModes: stuttgartCity.transportModes,
      landmarkFactory: undefined
    };
  }
  return {
    ...registered,
    ...entry,
    shortLabel: registered.shortLabel,
    menuTitle: entry.title ?? registered.menuTitle
  };
}

export async function loadCityCatalog(): Promise<CityCatalog> {
  try {
    const response = await fetch('/data/cities.json');
    if (!response.ok) throw new Error(`City catalog request failed: ${response.status}`);
    const catalog = (await response.json()) as CityCatalog;
    if (!Array.isArray(catalog.cities) || catalog.cities.length === 0) throw new Error('City catalog did not include any cities.');
    return catalog;
  } catch (error) {
    console.warn('Falling back to built-in city catalog.', error);
    return fallbackCatalog;
  }
}

export function resolveCities(catalog: CityCatalog): CityDefinition[] {
  return catalog.cities.map(mergeCityEntry);
}

export function cityDefinitionById(id: string): CityDefinition {
  return registry.get(id) ?? stuttgartCity;
}

export { stuttgartCity };
export { ulmCity };
export type { CityCatalog, CityCatalogEntry, CityDefinition } from './types';
