import type {
  DeparturesResponse,
  JourneysResponse,
  LocationsResponse,
  SearchJourneyRequest
} from './types';

// Base URL of the transit-simulator-backend service. In dev we always call the
// same origin so requests flow through the Vite proxy (the backend sends no CORS
// headers); production builds call VITE_REALTIME_API_BASE directly (deploy behind
// a reverse proxy or enable CORS on the backend).
const CONFIGURED_BASE = (import.meta.env.VITE_REALTIME_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const API_BASE = import.meta.env.DEV ? '' : CONFIGURED_BASE;
const API_ROOT = `${API_BASE}/api/v1`;

// Envelope the backend uses for 4xx errors.
type ErrorEnvelope = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers }
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as ErrorEnvelope;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/** Autocomplete stops/addresses/POIs by free-text query. */
export function searchLocations(query: string, signal?: AbortSignal): Promise<LocationsResponse> {
  return request<LocationsResponse>(`/locations?query=${encodeURIComponent(query)}`, { signal });
}

/** Finds stops/places within radiusM meters of a coordinate. */
export function nearbyLocations(lat: number, lon: number, radiusM = 700, signal?: AbortSignal): Promise<LocationsResponse> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radiusM: String(radiusM) });
  return request<LocationsResponse>(`/locations/nearby?${params}`, { signal });
}

/** Searches journeys between two places (by id and/or coordinates). */
export function searchJourneys(body: SearchJourneyRequest, signal?: AbortSignal): Promise<JourneysResponse> {
  return request<JourneysResponse>('/journeys', { method: 'POST', body: JSON.stringify(body), signal });
}

/** Live departure board for a station; name/lat/lon help TRIAS resolve the stop. */
export function stationDepartures(
  stationId: string,
  options: { name?: string; lat?: number; lon?: number; at?: string } = {},
  signal?: AbortSignal
): Promise<DeparturesResponse> {
  const params = new URLSearchParams();
  if (options.name) params.set('name', options.name);
  if (options.lat !== undefined) params.set('lat', String(options.lat));
  if (options.lon !== undefined) params.set('lon', String(options.lon));
  if (options.at) params.set('at', options.at);
  const query = params.toString();
  return request<DeparturesResponse>(`/stations/${encodeURIComponent(stationId)}/departures${query ? `?${query}` : ''}`, {
    signal
  });
}
