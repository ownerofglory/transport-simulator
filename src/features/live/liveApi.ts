import type { BBox } from './viewport';
import {
  isRenderable,
  type LiveMode,
  type LiveTrafficStatus,
  type LiveVehicle,
  type RenderableVehicle,
  type VehicleSnapshot
} from './liveTypes';

// Shares the realtime feature's base-URL strategy: same-origin (Vite proxy) in
// dev, VITE_REALTIME_API_BASE in production. Kept local to the live feature so
// it stays code-split and does not import the realtime module.
const CONFIGURED_BASE = (import.meta.env.VITE_REALTIME_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const API_BASE = import.meta.env.DEV ? '' : CONFIGURED_BASE;
const API_ROOT = `${API_BASE}/api/v1`;

type ErrorEnvelope = { error?: { code?: string; message?: string } };

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as ErrorEnvelope;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

/** Whether live traffic is available at all (double-gate with the city check). */
export async function fetchLiveStatus(signal?: AbortSignal): Promise<LiveTrafficStatus> {
  return request<LiveTrafficStatus>('/live/status', signal);
}

/** A tightened snapshot: only vehicles the UI can actually place on the map. */
export type LiveSnapshot = Omit<VehicleSnapshot, 'vehicles'> & { vehicles: RenderableVehicle[] };

/** Viewport-bounded vehicle snapshot. `modes` must be non-empty (API requires it). */
export async function fetchVehicles(
  bbox: BBox,
  modes: LiveMode[],
  options: { at?: string } = {},
  signal?: AbortSignal
): Promise<LiveSnapshot> {
  const params = new URLSearchParams({
    latMin: String(bbox.latMin),
    lonMin: String(bbox.lonMin),
    latMax: String(bbox.latMax),
    lonMax: String(bbox.lonMax),
    modes: modes.join(',')
  });
  if (options.at) params.set('at', options.at);
  const snapshot = await request<VehicleSnapshot>(`/live/vehicles?${params}`, signal);
  return { ...snapshot, vehicles: (snapshot.vehicles ?? []).filter(isRenderable) };
}

/** Per-run estimate used while following a single vehicle (concept §6.2). */
export async function fetchVehicle(runId: string, options: { at?: string } = {}, signal?: AbortSignal): Promise<LiveVehicle> {
  const query = options.at ? `?at=${encodeURIComponent(options.at)}` : '';
  return request<LiveVehicle>(`/live/vehicles/${encodeURIComponent(runId)}${query}`, signal);
}
