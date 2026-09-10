import type { TrafficDensity } from '../../app/types';

/**
 * Population multiplier for ambient traffic: medium doubles the crowd, many
 * triples it.
 *
 * Only the *population* scales. Every traffic system keeps its routing-request
 * budget fixed at the 'few' rate and fills the extra population from routes it
 * has already fetched — followers spaced out behind a leader on the same road,
 * more walkers per station route, more riders per station itinerary.
 */
export function trafficDensityScale(density: TrafficDensity): number {
  switch (density) {
    case 'many':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}
