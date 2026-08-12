import { stuttgartCity } from './stuttgart';
import { ulmCity } from './ulm';
import { odessaCity } from './odessa';
import { zurichCity } from './zurich';
import { freiburgCity } from './freiburg';
import { lvivCity } from './lviv';
import { mexicoCity } from './mexico-city';
import { bodoCity } from './bodo';
import { badenWuerttembergRailCity } from './baden-wuerttemberg-rail';
import { wuppertalCity } from './wuppertal';
import { vancouverCity } from './vancouver';
import { karlsruheCity } from './karlsruhe';
import type { CityCatalog, CityCatalogEntry, CityDefinition } from './types';

// Built-in city definitions keyed by stable city id.
const registry = new Map<string, CityDefinition>([
  [stuttgartCity.id, stuttgartCity],
  [ulmCity.id, ulmCity],
  [odessaCity.id, odessaCity],
  [zurichCity.id, zurichCity],
  [freiburgCity.id, freiburgCity],
  [lvivCity.id, lvivCity],
  [mexicoCity.id, mexicoCity],
  [bodoCity.id, bodoCity],
  [badenWuerttembergRailCity.id, badenWuerttembergRailCity],
  [wuppertalCity.id, wuppertalCity],
  [vancouverCity.id, vancouverCity],
  [karlsruheCity.id, karlsruheCity]
]);

// Fallback catalog used when public/data/cities.json cannot be loaded.
const fallbackCatalog: CityCatalog = {
  generatedAt: new Date(0).toISOString(), // Unix epoch marks this as built-in fallback metadata.
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
    },
    {
      id: odessaCity.id,
      name: odessaCity.name,
      title: odessaCity.title,
      description: odessaCity.description,
      manifestFile: odessaCity.manifestFile,
      defaultTransportMode: odessaCity.defaultTransportMode
    },
    {
      id: zurichCity.id,
      name: zurichCity.name,
      title: zurichCity.title,
      description: zurichCity.description,
      manifestFile: zurichCity.manifestFile,
      defaultTransportMode: zurichCity.defaultTransportMode
    },
    {
      id: freiburgCity.id,
      name: freiburgCity.name,
      title: freiburgCity.title,
      description: freiburgCity.description,
      manifestFile: freiburgCity.manifestFile,
      defaultTransportMode: freiburgCity.defaultTransportMode
    },
    {
      id: lvivCity.id,
      name: lvivCity.name,
      title: lvivCity.title,
      description: lvivCity.description,
      manifestFile: lvivCity.manifestFile,
      defaultTransportMode: lvivCity.defaultTransportMode
    },
    {
      id: mexicoCity.id,
      name: mexicoCity.name,
      title: mexicoCity.title,
      description: mexicoCity.description,
      manifestFile: mexicoCity.manifestFile,
      defaultTransportMode: mexicoCity.defaultTransportMode
    },
    {
      id: badenWuerttembergRailCity.id,
      name: badenWuerttembergRailCity.name,
      title: badenWuerttembergRailCity.title,
      description: badenWuerttembergRailCity.description,
      manifestFile: badenWuerttembergRailCity.manifestFile,
      defaultTransportMode: badenWuerttembergRailCity.defaultTransportMode
    },
    {
      id: wuppertalCity.id,
      name: wuppertalCity.name,
      title: wuppertalCity.title,
      description: wuppertalCity.description,
      manifestFile: wuppertalCity.manifestFile,
      defaultTransportMode: wuppertalCity.defaultTransportMode
    },
    {
      id: vancouverCity.id,
      name: vancouverCity.name,
      title: vancouverCity.title,
      description: vancouverCity.description,
      manifestFile: vancouverCity.manifestFile,
      defaultTransportMode: vancouverCity.defaultTransportMode
    },
    {
      id: karlsruheCity.id,
      name: karlsruheCity.name,
      title: karlsruheCity.title,
      description: karlsruheCity.description,
      manifestFile: karlsruheCity.manifestFile,
      defaultTransportMode: karlsruheCity.defaultTransportMode
    },
  ]
};

/** Combines public catalog metadata with the matching built-in city behavior. */
function mergeCityEntry(entry: CityCatalogEntry): CityDefinition {
  const registered = registry.get(entry.id);

  if (!registered) {
    // Unknown catalog cities reuse Stuttgart defaults until a real code module exists.
    return {
      ...stuttgartCity,
      ...entry,
      shortLabel: entry.name,
      menuTitle: entry.title,
      noticeNetworkName: entry.name,
      freeRideNotice: 'Free non-commercial simulator.',
      transportModes: stuttgartCity.transportModes,
      landmarkFactory: undefined // avoid Stuttgart landmarks for unknown cities.
    };
  }

  return {
    ...registered,
    ...entry,
    shortLabel: registered.shortLabel,
    menuTitle: entry.title ?? registered.menuTitle
  };
}

/** Loads the public city catalog, falling back to built-in city entries. */
export async function loadCityCatalog(): Promise<CityCatalog> {
  try {
    const response = await fetch('/data/cities.json');
    if (!response.ok) throw new Error(`City catalog request failed: ${response.status}`);

    const catalog = (await response.json()) as CityCatalog;
    if (!Array.isArray(catalog.cities) || catalog.cities.length === 0) {
      throw new Error('City catalog did not include any cities.');
    }

    return catalog;
  } catch (error) {
    console.warn('Falling back to built-in city catalog.', error);
    return fallbackCatalog;
  }
}

/** Resolves catalog entries into full city definitions used by the app. */
export function resolveCities(catalog: CityCatalog): CityDefinition[] {
  return catalog.cities.map(mergeCityEntry);
}

/** Returns a built-in city definition by id, defaulting to Stuttgart. */
export function cityDefinitionById(id: string): CityDefinition {
  return registry.get(id) ?? stuttgartCity;
}

export { stuttgartCity };
export { ulmCity };
export { odessaCity };
export { zurichCity };
export { freiburgCity };
export { lvivCity };
export { mexicoCity };
export { bodoCity };
export { badenWuerttembergRailCity };
export { wuppertalCity };
export { vancouverCity };
export { karlsruheCity };
export type { CityCatalog, CityCatalogEntry, CityDefinition } from './types';
