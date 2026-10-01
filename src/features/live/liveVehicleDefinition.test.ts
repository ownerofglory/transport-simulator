import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { stuttgartCity } from '../../cities/stuttgart';
import { resolveRouteVehicleDefinition } from '../../vehicles/VehicleDefinition';
import { buildTransitVehicle } from '../../vehicles';
import { vehicleVisualFactory } from '../../vehicles/VehicleVisualFactory';
import { parseSBahnBlueprint } from '../../vehicles/blueprint/sbahn/SBahnBlueprintConfig';
import br430Config from '../../vehicles/configs/db-br430-sbahn.json';
import cdmxConfig from '../../vehicles/configs/cdmx-metro-nm16.json';
import { parseBusBlueprint } from '../../vehicles/blueprint/bus/BusBlueprintConfig';
import citaroConfig from '../../vehicles/configs/vvs-citaro-bus.json';
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

  it('keeps the added Tango detail batched for simulator and live-follow', () => {
    const definition = resolveLiveVehicleDefinition(u12Live, stuttgartCity);
    const instance = buildTransitVehicle({
      definition,
      makeInteriorDisplayMaterial: () => new THREE.MeshBasicMaterial()
    });
    const named = new Map<string, THREE.Object3D[]>();
    instance.root.traverse((object) => {
      if (!object.name) return;
      const matches = named.get(object.name) ?? [];
      matches.push(object);
      named.set(object.name, matches);
    });

    for (const name of [
      'SSB windshield divider and dual wipers',
      'SSB exterior side destination displays',
      'SSB illuminated exterior door buttons',
      'SSB interior hanging grab loops',
      'SSB roof HVAC vent slats',
      'SSB bogie frames',
      'SSB steel wheels'
    ]) {
      expect(named.get(name)).toHaveLength(4);
      expect(named.get(name)?.every((object) => object instanceof THREE.InstancedMesh)).toBe(true);
    }

    expect((named.get('SSB exterior side destination displays')?.[0] as THREE.InstancedMesh).count).toBe(2);
    expect((named.get('SSB interior hanging grab loops')?.[0] as THREE.InstancedMesh).count).toBe(12);
    expect((named.get('SSB roof HVAC vent slats')?.[0] as THREE.InstancedMesh).count).toBe(15);
    expect((named.get('SSB steel wheels')?.[0] as THREE.InstancedMesh).count).toBe(8);
  });

  it('shares Tango finishes, shell visibility and detail between ride and live-follow factories', () => {
    const ride = vehicleVisualFactory.create(resolveRouteVehicleDefinition(u12Route, stuttgartCity, stadtbahnMode), {
      route: u12Route, city: stuttgartCity, modeDefinition: stadtbahnMode
    });
    const live = vehicleVisualFactory.create(resolveLiveVehicleDefinition(u12Live, stuttgartCity));
    for (const vehicle of [ride, live]) {
      expect(vehicle.cars).toHaveLength(4);
      const fabrics = new Set<THREE.Material>();
      const floors = new Set<THREE.Texture | null>();
      for (const car of vehicle.cars) {
        expect(car.userData.passengerCameraLocal).toEqual([0.08, 2.3, -4.8]);
        expect(car.userData.passengerLookAtLocal).toEqual([0.05, 2.2, 7.5]);
        const seats = car.getObjectByName('SSB paired seat cushions') as THREE.InstancedMesh;
        const shells = car.getObjectByName('SSB molded seat shells') as THREE.InstancedMesh;
        expect(shells.count).toBe(seats.count);
        fabrics.add(seats.material as THREE.Material);
        expect((seats.material as THREE.MeshStandardMaterial).map?.name).toBe('SSB fabric finish');
        const floor = car.getObjectByName('SSB speckled saloon floor') as THREE.Mesh;
        floors.add((floor.material as THREE.MeshStandardMaterial).map);
        expect((car.getObjectByName('SSB recessed roof fans') as THREE.InstancedMesh).count).toBe(6);
        const monitors = car.children.filter((object) => object.name === 'SSB overhead next-station display') as THREE.Mesh[];
        expect(monitors).toHaveLength(2);
        for (const monitor of monitors) {
          const outward = monitor.position.z > -1.15 ? 1 : -1;
          const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(monitor.quaternion);
          expect(normal.z).toBeCloseTo(outward);
          expect(new THREE.Vector3(0, 1, 0).applyQuaternion(monitor.quaternion).y).toBeCloseTo(1);
          expect((monitor.material as THREE.Material).side).toBe(THREE.FrontSide);
        }
      }
      expect(fabrics.size).toBe(1);
      expect(floors.size).toBe(1);
      for (const mode of ['passenger', 'cab', 'chase'] as const) {
        vehicle.setPresentation(mode, false);
        vehicle.root.traverse((object) => {
          if (object instanceof THREE.Mesh && object.material.name === 'SSB satin yellow paint' && object.geometry.type === 'ExtrudeGeometry') {
            // Cab noses have a separate cab-only visibility policy.
            if (object.position.y === 0.52) expect(object.visible).toBe(mode === 'chase');
          }
        });
        expect(vehicle.cars[0].getObjectByName('SSB lower body panel joints')?.visible).toBe(mode === 'chase');
        expect(vehicle.cars[0].getObjectByName('SSB molded seat shells')?.visible).toBe(true);
      }
      vehicle.dispose();
    }
  });

  it('keeps BR430 exterior details opt-in to the DB blueprint', () => {
    const br430 = parseSBahnBlueprint(br430Config);
    const cdmx = parseSBahnBlueprint(cdmxConfig);
    expect(br430.ok && br430.config.exteriorDetailStyle).toBe('br430');
    expect(cdmx.ok && cdmx.config.exteriorDetailStyle).toBeUndefined();
    expect(parseSBahnBlueprint({ ...br430Config, exteriorDetailStyle: 'unknown' }).ok).toBe(false);
  });

  it('builds identical detailed Stuttgart S-Bahn exteriors through ride and live factories', () => {
    const mode = stuttgartCity.transportModes.find((mode) => mode.id === 's-bahn')!;
    const route = { line: 'S1', destination: 'Herrenberg' } as DemoRoute;
    const live = { ...u12Live, line: 'S1', direction: 'Herrenberg', mode: 's-bahn' } as LiveVehicle;
    const definitions = [resolveRouteVehicleDefinition(route, stuttgartCity, mode), resolveLiveVehicleDefinition(live, stuttgartCity)];
    for (const definition of definitions) {
      const visual = vehicleVisualFactory.create(definition);
      expect(visual.cars).toHaveLength(4);
      expect(visual.trainHalfLengthM).toBe(34.2);
      const labels = new Set<THREE.Material>();
      for (const [index, car] of visual.cars.entries()) {
        expect((car.getObjectByName('BR430 steel wheel treads') as THREE.InstancedMesh).count).toBe(8);
        expect((car.getObjectByName('BR430 aluminium door thresholds') as THREE.InstancedMesh).count).toBe(4);
        expect(!!car.getObjectByName('BR430 automatic coupler')).toBe(index === 0 || index === 3);
        expect(car.getObjectByName('BR430 blue multipurpose area')).toBeDefined();
        expect(car.getObjectByName('BR430 S-Bahn Stuttgart branding')).toBeDefined();
        const cabCar = index === 0 || index === 3;
        expect(!!car.getObjectByName('BR430 rounded cab shell')).toBe(cabCar);
        expect(!!car.getObjectByName('BR430 bowed lower cab apron')).toBe(cabCar);
        expect(!!car.getObjectByName('BR430 stepped cab roof fairing')).toBe(cabCar);
        expect(!!car.getObjectByName('BR430 yellow first-class panel')).toBe(cabCar);
        expect(!!car.getObjectByName('BR430 green S-Bahn emblem')).toBe(cabCar);
        expect(!!car.getObjectByName('BR430 lower blue side stripes')).toBe(cabCar);
        if (cabCar) {
          const emblem = car.getObjectByName('BR430 green S cab emblem') as THREE.Mesh;
          expect(emblem.geometry.type).toBe('CircleGeometry');
          const apron = car.getObjectByName('BR430 bowed lower cab apron') as THREE.Mesh;
          apron.geometry.computeBoundingBox();
          expect(apron.geometry.boundingBox!.max.z - apron.geometry.boundingBox!.min.z).toBeGreaterThan(0.5);
          const windscreen = car.getObjectByName('BR430 curved windscreen') as THREE.Mesh;
          const windscreenMaterial = windscreen.material as THREE.MeshPhysicalMaterial;
          expect(windscreenMaterial.depthWrite).toBe(true);
          expect(windscreenMaterial.opacity).toBeGreaterThanOrEqual(0.7);
          expect(windscreen.rotation.y).toBeCloseTo(index === 0 ? Math.PI : 0);
          const mask = car.getObjectByName('BR430 rounded windscreen mask') as THREE.Mesh<THREE.ExtrudeGeometry>;
          expect(mask.rotation.y).toBeCloseTo(index === 0 ? Math.PI : 0);
          const maskShapes = mask.geometry.parameters.shapes;
          expect((Array.isArray(maskShapes) ? maskShapes[0] : maskShapes).holes).toHaveLength(1);
        }
        labels.add((car.getObjectByName('BR430 side destination display') as THREE.Mesh).material as THREE.Material);
        expect(car.getObjectByName('BR430 molded seat back')).toBeDefined();
        expect(car.userData.passengerCameraLocal).toEqual([0.2, 2.3, -4.4]);
        expect(car.userData.passengerLookAtLocal[2]).toBeGreaterThan(car.userData.passengerCameraLocal[2]);
        const screens = car.children.filter((object) => object.name === 'S-Bahn next-stop monitor') as THREE.Mesh[];
        expect(screens).toHaveLength(2);
        expect(screens.map((screen) => Math.round(new THREE.Vector3(0, 0, 1).applyQuaternion(screen.quaternion).z))).toEqual([-1, 1]);
      }
      expect(labels.size).toBe(1);
      visual.setPresentation('passenger', false);
      expect(visual.cars[0].getObjectByName('BR430 side destination display')?.visible).toBe(false);
      visual.setPresentation('chase', false);
      expect(visual.cars[0].getObjectByName('BR430 side destination display')?.visible).toBe(true);
      const texture = ([...labels][0] as THREE.MeshBasicMaterial).map!;
      const disposed = vi.fn();
      texture.addEventListener('dispose', disposed);
      visual.dispose();
      expect(disposed).toHaveBeenCalledOnce();
    }
  });

  it.each([['43', 2], ['99', 1]] as const)('preserves detailed Citaro ride/live parity for line %s', (line, carCount) => {
    const mode = stuttgartCity.transportModes.find((mode) => mode.id === 'bus')!;
    const route = { line, destination: 'Stuttgart' } as DemoRoute;
    const live = { ...u12Live, line, direction: 'Stuttgart', mode: 'bus' } as LiveVehicle;
    const definitions = [resolveRouteVehicleDefinition(route, stuttgartCity, mode), resolveLiveVehicleDefinition(live, stuttgartCity)];
    expect(parseBusBlueprint(citaroConfig).ok).toBe(true);
    expect(parseBusBlueprint({ ...citaroConfig, detailStyle: 'unknown' }).ok).toBe(false);
    for (const definition of definitions) {
      const visual = vehicleVisualFactory.create(definition);
      expect(visual.cars).toHaveLength(carCount);
      const cushionGeometries = new Set<THREE.BufferGeometry>();
      for (const car of visual.cars) {
        expect(car.getObjectByName('Citaro pressed steel rims')).toBeInstanceOf(THREE.InstancedMesh);
        expect(car.getObjectByName('Citaro molded seat back')).toBeDefined();
        expect((car.getObjectByName('Citaro wheel arch') as THREE.Mesh).geometry.type).toBe('RingGeometry');
        car.traverse((object) => {
          if (object.name === 'Citaro upholstered seat cushion' && object instanceof THREE.Mesh) {
            cushionGeometries.add(object.geometry);
            expect((object.material as THREE.MeshStandardMaterial).map?.name).toBe('SSB fabric finish');
          }
        });
      }
      expect(cushionGeometries.size).toBe(1);
      visual.setPresentation('passenger', false);
      expect(visual.cars[0].getObjectByName('Citaro body shell')?.visible).toBe(false);
      visual.setPresentation('chase', false);
      expect(visual.cars[0].getObjectByName('Citaro body shell')?.visible).toBe(true);
      visual.dispose();
    }
  });
});
