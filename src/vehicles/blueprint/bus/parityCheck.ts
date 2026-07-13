import * as THREE from 'three';
import type { CityDefinition } from '../../../cities';
import type { TransportModeDefinition } from '../../../domain/transport';
import type { DemoRoute } from '../../../route';
import { buildTransitVehicle } from '../../buildTransitVehicle';
import type { VehicleBuildContext } from '../../types';

// Dev-only parity harness: fingerprints the full bus scene graph so a refactor
// of the bus builder can be proven visually identical (mesh-for-mesh) to the
// previous implementation. Not imported by app code; use from the browser
// console on the vite dev server:
//
//   const m = await import('/src/vehicles/blueprint/bus/parityCheck.ts');
//   m.captureBaseline();          // before the refactor
//   m.compareWithBaseline();      // after the refactor -> [] means identical
//
// Baselines persist in localStorage across reloads/HMR.

const PARITY_LINES: Record<string, string> = {
  rigid: '35',
  articulated: '40'
};

function makeContext(line: string): VehicleBuildContext {
  const route = {
    id: `parity-${line}`,
    line,
    destination: 'Parity Test'
  } as unknown as DemoRoute;
  const city = { id: 'stuttgart' } as unknown as CityDefinition;
  const modeDefinition = {
    id: 'bus',
    vehicleFamily: 'Stuttgart city bus',
    vehicleKind: 'bus'
  } as unknown as TransportModeDefinition;
  return {
    route,
    city,
    modeDefinition,
    makeInteriorDisplayMaterial: () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// Keeps only JSON-safe primitive entries of THREE geometry parameter bags.
function sanitizeParams(params: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!params || typeof params !== 'object') return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === 'number') out[key] = round(value);
    else if (typeof value === 'string' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function fingerprintMaterial(material: THREE.Material | THREE.Material[]): unknown {
  if (Array.isArray(material)) return material.map((m) => fingerprintMaterial(m));
  const record: Record<string, unknown> = { type: material.type };
  const std = material as THREE.MeshStandardMaterial;
  if (std.color) record.color = std.color.getHexString();
  if (std.emissive) record.emissive = std.emissive.getHexString();
  if (typeof std.emissiveIntensity === 'number') record.emissiveIntensity = round(std.emissiveIntensity);
  if (typeof std.roughness === 'number') record.roughness = round(std.roughness);
  if (typeof std.metalness === 'number') record.metalness = round(std.metalness);
  record.opacity = round(material.opacity);
  record.transparent = material.transparent;
  record.side = material.side;
  record.depthWrite = material.depthWrite;
  record.hasMap = Boolean((std as unknown as { map?: unknown }).map);
  return record;
}

type Fingerprint = Record<string, unknown>;

function fingerprintObject(object: THREE.Object3D): Fingerprint {
  const record: Fingerprint = {
    type: object.type,
    name: object.name,
    position: object.position.toArray().map(round),
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(round),
    scale: object.scale.toArray().map(round),
    castShadow: object.castShadow,
    renderOrder: object.renderOrder
  };
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh) {
    record.geometry = { type: mesh.geometry.type, params: sanitizeParams((mesh.geometry as unknown as { parameters?: unknown }).parameters) };
    record.material = fingerprintMaterial(mesh.material);
  }
  const light = object as THREE.Light & { distance?: number; decay?: number; angle?: number; penumbra?: number };
  if ((object as THREE.Light).isLight) {
    record.light = {
      color: (object as THREE.Light).color.getHexString(),
      intensity: round((object as THREE.Light).intensity),
      distance: light.distance !== undefined ? round(light.distance) : undefined,
      decay: light.decay !== undefined ? round(light.decay) : undefined,
      angle: light.angle !== undefined ? round(light.angle) : undefined,
      penumbra: light.penumbra !== undefined ? round(light.penumbra) : undefined
    };
  }
  record.children = object.children.map((child) => fingerprintObject(child));
  return record;
}

function fingerprintBus(line: string): Fingerprint {
  const vehicle = buildTransitVehicle(makeContext(line));
  const record: Fingerprint = {
    scene: fingerprintObject(vehicle.root),
    doors: vehicle.doors.map((door) => ({ closedZ: round(door.closedZ), direction: door.direction, leaves: door.group.children.length })),
    windowBands: vehicle.windowBands.length,
    cabShells: vehicle.cabShells.length,
    passengerShells: vehicle.passengerShells.length,
    cabDisplays: vehicle.cabDisplays.length,
    cars: vehicle.cars.map((car) => ({ name: car.name, centerOffsetM: car.userData.centerOffsetM })),
    glassMaterial: vehicle.glassMaterial ? fingerprintMaterial(vehicle.glassMaterial) : null,
    trainHalfLengthM: round(vehicle.trainHalfLengthM),
    hasExteriorLights: Boolean(vehicle.setExteriorLightsOn)
  };
  vehicle.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  return record;
}

function storageKey(variant: string): string {
  return `bus-parity-baseline-${variant}`;
}

export function captureBaseline(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const [variant, line] of Object.entries(PARITY_LINES)) {
    const json = JSON.stringify(fingerprintBus(line));
    localStorage.setItem(storageKey(variant), json);
    sizes[variant] = json.length;
  }
  return sizes;
}

function diffValues(path: string, before: unknown, after: unknown, out: string[]): void {
  if (out.length >= 40) return;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
    if (before !== after) out.push(`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    return;
  }
  const beforeRec = before as Record<string, unknown>;
  const afterRec = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRec), ...Object.keys(afterRec)]);
  for (const key of keys) {
    diffValues(`${path}.${key}`, beforeRec[key], afterRec[key], out);
    if (out.length >= 40) return;
  }
}

export function compareWithBaseline(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [variant, line] of Object.entries(PARITY_LINES)) {
    const baselineJson = localStorage.getItem(storageKey(variant));
    if (!baselineJson) {
      result[variant] = ['NO BASELINE CAPTURED'];
      continue;
    }
    const diffs: string[] = [];
    diffValues(variant, JSON.parse(baselineJson), fingerprintBus(line), diffs);
    result[variant] = diffs;
  }
  return result;
}
