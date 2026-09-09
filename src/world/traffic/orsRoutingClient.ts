import type { LatLon } from './trafficGeo';

type RouteResponse = { points?: LatLon[] };

const CONFIGURED_BASE = (import.meta.env.VITE_REALTIME_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const API_BASE = import.meta.env.DEV ? '' : CONFIGURED_BASE;

/**
 * One-shot ORS route lookup shared by every profile (driving, walking, ...) —
 * never called per frame. Returns null on any network/parse failure so a bad
 * request is simply skipped rather than retried against the shared server.
 */
export async function fetchOrsRoute(profile: string, origin: LatLon, destination: LatLon, signal?: AbortSignal): Promise<LatLon[] | null> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile,
        origin,
        destination
      }),
      signal
    });
    if (!response.ok) return null;
    const data = (await response.json()) as RouteResponse;
    if (!data.points || data.points.length < 2) return null;
    return data.points;
  } catch {
    return null;
  }
}
