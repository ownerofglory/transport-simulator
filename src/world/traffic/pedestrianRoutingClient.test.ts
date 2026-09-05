import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWalkingRoute } from './pedestrianRoutingClient';

const origin = { lat: 48.7758, lon: 9.1829 };
const destination = { lat: 48.78, lon: 9.19 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWalkingRoute', () => {
  it('posts to the foot-walking profile and parses the geometry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        points: [origin, destination]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const points = await fetchWalkingRoute(origin, destination);

    expect(points).toEqual([
      { lat: 48.7758, lon: 9.1829 },
      { lat: 48.78, lon: 9.19 }
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/routes');
    expect(JSON.parse(init.body)).toEqual({ profile: 'foot-walking', origin, destination });
  });

  it('returns null on failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchWalkingRoute(origin, destination)).toBeNull();
  });
});
