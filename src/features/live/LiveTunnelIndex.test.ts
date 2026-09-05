import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTunnelIndex } from './LiveTunnelIndex';
import type { TrackedVehicle } from './LiveVehicleStore';

const tracked = (runId: string, lat: number, lon: number): TrackedVehicle => ({
  runId,
  data: { runId, mode: 'light-rail', line: 'U1' },
  render: { lat, lon }
} as unknown as TrackedVehicle);

afterEach(() => vi.unstubAllGlobals());

describe('LiveTunnelIndex', () => {
  it('invalidates an early no-route result when the lazy route feed arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{
          id: 'u1-tunnel',
          line: 'U1',
          geoPoints: [[48.78, 9.18], [48.7805, 9.18]],
          tunnelMask: [true, true]
        }]
      })
    }));

    const index = new LiveTunnelIndex();
    const vehicle = tracked('run-1', 48.78, 9.18);

    expect(index.isInTunnel(vehicle)).toBe(false);
    await vi.waitFor(() => expect(index.version).toBe(1));
    expect(index.isInTunnel(vehicle)).toBe(true);
    expect(index.routeFor(vehicle)?.id).toBe('u1-tunnel');
  });
});
