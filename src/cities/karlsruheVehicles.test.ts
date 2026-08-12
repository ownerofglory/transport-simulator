import { describe, expect, it } from 'vitest';
import { karlsruheCity } from './karlsruhe';
import { resolveRouteVehicleDefinition } from '../vehicles/VehicleDefinition';
import { vehicleRegistry } from '../vehicles/buildTransitVehicle';
import type { DemoRoute } from '../route';

// Karlsruhe puts two visually different cars on the same 'stadtbahn' vehicle
// kind, so the modes are only told apart by their registered design id. If a
// design id is dropped or renamed, both modes silently fall back to the generic
// Stadtbahn body — these tests make that failure loud.
describe('Karlsruhe vehicle resolution', () => {
  const route = { line: '2', destination: 'Durlach Bahnhof' } as unknown as DemoRoute;

  function modeById(id: string) {
    const mode = karlsruheCity.transportModes.find((entry) => entry.id === id);
    if (!mode) throw new Error(`Karlsruhe has no "${id}" transport mode`);
    return mode;
  }

  it('resolves the tram mode to the VBK design', () => {
    expect(resolveRouteVehicleDefinition(route, karlsruheCity, modeById('tram')).vehicleDesignId).toBe('karlsruhe-vbk-tram');
  });

  it('resolves the stadtbahn mode to the AVG Citylink design', () => {
    expect(resolveRouteVehicleDefinition(route, karlsruheCity, modeById('stadtbahn')).vehicleDesignId).toBe('karlsruhe-avg-citylink');
  });

  it('keeps both designs registered so neither mode falls back to the generic body', () => {
    for (const modeId of ['tram', 'stadtbahn'] as const) {
      const definition = resolveRouteVehicleDefinition(route, karlsruheCity, modeById(modeId));
      const resolved = vehicleRegistry.resolve({
        definition,
        route: { ...route, vehicleDesignId: definition.vehicleDesignId } as unknown as DemoRoute,
        city: karlsruheCity,
        modeDefinition: modeById(modeId),
        makeInteriorDisplayMaterial: () => ({}) as never
      });
      const fallback = vehicleRegistry.resolve({
        definition: { ...definition, vehicleDesignId: undefined },
        route,
        city: undefined,
        modeDefinition: { ...modeById(modeId), vehicleDesignId: undefined },
        makeInteriorDisplayMaterial: () => ({}) as never
      });
      expect(resolved).not.toBe(fallback);
    }
  });

  it('uses an anchored interior camera profile on both rail modes', () => {
    // 'rail' would drop the passenger camera onto the un-anchored fallback path.
    for (const modeId of ['tram', 'stadtbahn'] as const) {
      expect(modeById(modeId).interiorCameraProfile).toBe('tram');
    }
  });
});
