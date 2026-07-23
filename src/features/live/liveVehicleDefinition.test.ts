import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { stuttgartCity } from '../../cities/stuttgart';
import { resolveRouteVehicleDefinition } from '../../vehicles/VehicleDefinition';
import { buildTransitVehicle } from '../../vehicles';
import type { DemoRoute } from '../../route';
import type { TransportModeDefinition } from '../../domain/transport';
import { resolveLiveVehicleDefinition } from './liveVehicleDefinition';
import type { LiveVehicle } from './liveTypes';

const stadtbahnMode = stuttgartCity.transportModes.find((m) => m.vehicleKind === 'stadtbahn') as TransportModeDefinition;
const u12Route = { line: 'U12', destination: 'Dürrlewang' } as unknown as DemoRoute;
const u12Live = { runId: 'r1', lat: 0, lon: 0, mode: 'light-rail', line: 'U12', direction: 'Dürrlewang', status: 'in_transit' } as LiveVehicle;

describe('vehicle definition parity', () => {
  it('resolves the same Stuttgart U12 design for simulator and live', () => {
    const routeDefinition = resolveRouteVehicleDefinition(u12Route, stuttgartCity, stadtbahnMode);
    const liveDefinition = resolveLiveVehicleDefinition(u12Live, stuttgartCity);

    expect(liveDefinition.vehicleDesignId).toBe(routeDefinition.vehicleDesignId);
    expect(liveDefinition.interiorCameraProfile).toBe(routeDefinition.interiorCameraProfile);
    expect(liveDefinition.vehicleKind).toBe(routeDefinition.vehicleKind);
    expect(liveDefinition.lineAccentColor).toBe(routeDefinition.lineAccentColor);
    // U12 is a coupled double formation in both paths.
    expect(routeDefinition.formation?.doubleFormation).toBe(true);
    expect(liveDefinition.formation?.doubleFormation).toBe(true);
  });
});

// Building a vehicle paints canvas labels; jsdom has no 2D context, so stub a
// permissive one for these assertions.
describe('followed-vehicle capabilities', () => {
  let getContext: unknown;
  beforeAll(() => {
    const ctx = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'measureText') return () => ({ width: 10 });
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
            return () => ({ addColorStop() {} });
          }
          return () => {};
        },
        set() {
          return true;
        }
      }
    );
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
  });
  afterAll(() => (getContext as { mockRestore(): void }).mockRestore());

  it('builds a Stuttgart U12 with an interior, doors and displays', () => {
    const definition = resolveLiveVehicleDefinition(u12Live, stuttgartCity);
    const instance = buildTransitVehicle({
      definition,
      makeInteriorDisplayMaterial: () => new THREE.MeshBasicMaterial()
    });
    // Interior/see-through capability: window bands + glass drive the passenger view.
    expect(instance.windowBands.length).toBeGreaterThan(0);
    expect(instance.glassMaterial).toBeDefined();
    expect(instance.doors.length).toBeGreaterThan(0);
    expect(instance.cabDisplays.length).toBeGreaterThan(0); // next-stop / route display meshes
    // Double formation => four Tango sections.
    expect(instance.cars.length).toBe(4);
  });
});
