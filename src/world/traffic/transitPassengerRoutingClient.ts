import type { LatLon } from './trafficGeo';

type ApiStop = { id: string; name: string; lat: number; lon: number };
type ApiLeg = { type: string; routeShortName?: string; routeId?: string; tripId?: string; stops?: ApiStop[] };
type ApiItinerary = { departure: string; arrival: string; legs: ApiLeg[] };
type RouteResponse = { itineraries?: ApiItinerary[] };

export type TransitStop = ApiStop;
export type TransitLeg = Required<Pick<ApiLeg, 'type'>> & Omit<ApiLeg, 'type'>;
export type TransitItinerary = ApiItinerary;

const CONFIGURED_BASE = (import.meta.env.VITE_REALTIME_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const API_BASE = import.meta.env.DEV ? '' : CONFIGURED_BASE;

/**
 * Requests a small, scheduled set of journeys through the simulator backend.
 * The backend owns Open Reroute access and its shared cache; callers must keep
 * requests station-level rather than issuing one per visible rider.
 */
export async function fetchTransitItineraries(
  origin: LatLon,
  destination: LatLon,
  signal?: AbortSignal
): Promise<TransitItinerary[] | null> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'public-transport',
        origin,
        destination,
        departure: new Date().toISOString(),
        schedule: true,
        scheduleDuration: 'PT45M',
        scheduleRows: 3
      }),
      signal
    });
    if (!response.ok) return null;
    const data = (await response.json()) as RouteResponse;
    return data.itineraries?.length ? data.itineraries : null;
  } catch {
    return null;
  }
}
