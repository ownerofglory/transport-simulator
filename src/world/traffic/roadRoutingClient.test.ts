import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRoadRoute } from './roadRoutingClient';

const origin = { lat: 48.7758, lon: 9.1829 };
const destination = { lat: 48.78, lon: 9.19 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRoadRoute', () => {
  it('posts to the given profile and parses the geometry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        points: [
          { lat: 48.7758, lon: 9.1829 },
          { lat: 48.777, lon: 9.185 },
          { lat: 48.78, lon: 9.19 }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const points = await fetchRoadRoute('driving-hgv', origin, destination);

    expect(points).toEqual([
      { lat: 48.7758, lon: 9.1829 },
      { lat: 48.777, lon: 9.185 },
      { lat: 48.78, lon: 9.19 }
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/routes');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ profile: 'driving-hgv', origin, destination });
  });

  it('returns null on a non-ok response instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchRoadRoute('driving-car', origin, destination)).toBeNull();
  });

  it('returns null when the response has no usable geometry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ points: [] }) })
    );
    expect(await fetchRoadRoute('cycling-regular', origin, destination)).toBeNull();
  });

  it('returns null instead of throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchRoadRoute('driving-car', origin, destination)).toBeNull();
  });
});
