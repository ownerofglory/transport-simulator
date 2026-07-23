import * as THREE from 'three';
import type { DemoRoute } from '../../route';
import type { CityDefinition } from '../../cities';
import type { TransportModeDefinition } from '../../domain/transport';
import type { CameraMode } from '../../world/CameraController';
import { buildTransitVehicle } from '../../vehicles';
import type { VehicleInstance } from '../../vehicles/types';
import { VehicleInteriorDisplay } from '../../vehicles/VehicleInteriorDisplay';
import type { EngineSystem } from '../core/EngineSystem';

/** Route-geometry placement helper owned by the world (also used by opposing traffic). */
export type ArticulatedPlacer = (
  root: THREE.Group,
  cars: THREE.Group[],
  distanceM: number,
  direction: 1 | -1,
  trackOffsetM: number
) => void;

export type ActiveVehicleContext = {
  scene: THREE.Scene;
  route: DemoRoute;
  city?: CityDefinition;
  modeDefinition?: TransportModeDefinition;
  activeLaneOffsetM: number;
  placeArticulated: ArticulatedPlacer;
};

const DEFAULT_TRAIN_HALF_LENGTH_M = 20.15;

/**
 * Owns the active {@link VehicleInstance}: builds it, places its articulated
 * sections along the route, animates doors, drives the interior destination
 * display, and toggles interior/cab visibility and exterior lamps. It exposes
 * the vehicle transform (root/cars/half-length) to the camera and photo systems.
 *
 * It does NOT own route positioning math, terrain, camera movement, rendering,
 * OSM streaming, or station building — placement math is supplied by the world.
 */
export class ActiveVehicleSystem implements EngineSystem {
  private vehicle: VehicleInstance | null = null;
  private interiorDisplay: VehicleInteriorDisplay | null = null;
  private doorOpenAmount = 0;

  constructor(private readonly ctx: ActiveVehicleContext) {
    this.vehicle = buildTransitVehicle({
      route: ctx.route,
      city: ctx.city,
      modeDefinition: ctx.modeDefinition,
      makeInteriorDisplayMaterial: () => this.makeInteriorDisplayMaterial()
    });
    ctx.scene.add(this.vehicle.root);
  }

  /** The vehicle root group (identity of the active train in the scene). */
  get root(): THREE.Group {
    return this.vehicle?.root ?? EMPTY_GROUP;
  }

  get cars(): THREE.Group[] {
    return this.vehicle?.cars ?? [];
  }

  get trainHalfLengthM(): number {
    return this.vehicle?.trainHalfLengthM ?? DEFAULT_TRAIN_HALF_LENGTH_M;
  }

  /** Places the articulated sections at the given route distance (forward). */
  place(distanceM: number): void {
    if (!this.vehicle) return;
    this.ctx.placeArticulated(this.vehicle.root, this.vehicle.cars, distanceM, 1, this.ctx.activeLaneOffsetM);
  }

  updateDoors(open: boolean, deltaSeconds: number): void {
    this.doorOpenAmount = THREE.MathUtils.damp(
      this.doorOpenAmount,
      open ? 1 : 0,
      open ? 5.2 : 6.5,
      THREE.MathUtils.clamp(deltaSeconds, 0, 0.1)
    );
    const eased = this.doorOpenAmount * this.doorOpenAmount * (3 - 2 * this.doorOpenAmount);
    for (const leaf of this.vehicle?.doors ?? []) {
      leaf.group.position.z = leaf.closedZ + leaf.direction * 0.72 * eased;
    }
  }

  /** Applies interior/cab window transparency and shell visibility per view. */
  setPresentation(mode: CameraMode, cinematicActive: boolean): void {
    const glassMaterial = this.vehicle?.glassMaterial;
    if (!glassMaterial) return;
    const interiorView = !cinematicActive && (mode === 'passenger' || mode === 'cab');
    const cabView = mode === 'cab';
    glassMaterial.opacity = interiorView ? 0.1 : 0.58;
    glassMaterial.depthWrite = !interiorView;
    glassMaterial.color.setHex(interiorView ? 0xd9f2f8 : 0x91c7dd);
    glassMaterial.needsUpdate = true;
    for (const band of this.vehicle?.windowBands ?? []) band.visible = !interiorView;
    for (const shell of this.vehicle?.cabShells ?? []) shell.visible = !cabView;
    for (const shell of this.vehicle?.passengerShells ?? []) shell.visible = !interiorView;
    for (const display of this.vehicle?.cabDisplays ?? []) display.visible = !cabView;
  }

  /** Head/tail lamps come on in low light (night, dawn, dusk). */
  updateExteriorLights(daylightFactor: number): void {
    this.vehicle?.setExteriorLightsOn?.(daylightFactor < 0.45);
  }

  private makeInteriorDisplayMaterial(): THREE.MeshBasicMaterial {
    this.interiorDisplay = new VehicleInteriorDisplay();
    this.updateInteriorDisplay(this.ctx.route.stations[1]?.name ?? this.ctx.route.destination, false);
    return this.interiorDisplay.material;
  }

  updateInteriorDisplay(nextStation: string, doorsOpen: boolean): void {
    const vehicleKind = this.ctx.modeDefinition?.vehicleKind ?? 'stadtbahn';
    const accentColor = this.ctx.modeDefinition?.lineAccentColor ?? (vehicleKind === 's-bahn' ? '#e0202b' : '#ffd800');
    this.interiorDisplay?.update({
      line: this.ctx.route.line,
      destination: this.ctx.route.destination,
      nextStop: nextStation,
      doorsOpen,
      accentColor
    });
  }

  dispose(): void {
    this.vehicle?.dispose?.();
    this.interiorDisplay?.dispose();
    this.interiorDisplay = null;
    this.vehicle = null;
  }
}

// Fallback so `root` stays non-null before/after the vehicle exists.
const EMPTY_GROUP = new THREE.Group();
