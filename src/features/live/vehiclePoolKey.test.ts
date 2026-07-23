import { describe, it, expect } from 'vitest';
import { stuttgartCity } from '../../cities/stuttgart';
import { vehiclePoolKey } from './LiveVehicleModels';
import { resolveLiveVehicleDefinition } from './liveVehicleDefinition';
import type { LiveVehicle } from './liveTypes';

const live = (over: Partial<LiveVehicle>): LiveVehicle =>
  ({ runId: 'r', lat: 0, lon: 0, status: 'in_transit', ...over }) as LiveVehicle;

function keyFor(over: Partial<LiveVehicle>): string {
  return vehiclePoolKey(resolveLiveVehicleDefinition(live(over), stuttgartCity));
}

describe('vehiclePoolKey', () => {
  it('shares one pool across lines with the same design + formation', () => {
    // U12 and U6 are both coupled double Stadtbahn formations.
    expect(keyFor({ mode: 'light-rail', line: 'U12' })).toBe(keyFor({ mode: 'light-rail', line: 'U6' }));
  });

  it('separates single from double Stadtbahn formations', () => {
    expect(keyFor({ mode: 'light-rail', line: 'U12' })).not.toBe(keyFor({ mode: 'light-rail', line: 'U14' }));
  });

  it('separates rigid from articulated bus formations', () => {
    // '42' is an articulated line; '70' is rigid (see the VVS Citaro config).
    expect(keyFor({ mode: 'bus', line: '42' })).not.toBe(keyFor({ mode: 'bus', line: '70' }));
  });

  it('separates vehicle kinds', () => {
    expect(keyFor({ mode: 'light-rail', line: 'U5' })).not.toBe(keyFor({ mode: 's-bahn', line: 'S1' }));
  });
});
