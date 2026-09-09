import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTransitItineraries } from './transitPassengerRoutingClient';

const origin = { lat: 48.7758, lon: 9.1829 };
const destination = { lat: 48.78, lon: 9.19 };

afterEach(() => vi.unstubAllGlobals());

describe('fetchTransitItineraries', () => {
  it('uses the backend public-transport profile with a bounded schedule query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ itineraries: [{ departure: '2026-09-07T09:00:00+02:00', arrival: '2026-09-07T09:15:00+02:00', legs: [] }] })
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchTransitItineraries(origin, destination);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/routes');
    expect(JSON.parse(init.body)).toMatchObject({
      profile: 'public-transport', origin, destination, schedule: true, scheduleDuration: 'PT45M', scheduleRows: 3
    });
  });

  it('returns null when itinerary lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchTransitItineraries(origin, destination)).toBeNull();
  });
});
