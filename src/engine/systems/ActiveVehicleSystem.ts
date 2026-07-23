import * as THREE from 'three';
import type { DemoRoute } from '../../route';
import type { CityDefinition } from '../../cities';
import type { TransportModeDefinition } from '../../domain/transport';
import type { CameraMode } from '../../world/CameraController';
import { buildTransitVehicle } from '../../vehicles';
import type { VehicleInstance } from '../../vehicles/types';
import { VehicleInteriorDisplay } from '../../vehicles/VehicleInteriorDisplay';
import { VehicleVisualController } from '../../vehicles/VehicleVisualController';
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
  // Shared presentation (doors, interior display, visibility, lamps); placement
  // stays here because the simulator drives it by route distance.
  private readonly visual: VehicleVisualController;

  constructor(private readonly ctx: ActiveVehicleContext) {
    let display: VehicleInteriorDisplay | null = null;
    this.vehicle = buildTransitVehicle({
      route: ctx.route,
      city: ctx.city,
      modeDefinition: ctx.modeDefinition,
      makeInteriorDisplayMaterial: () => {
        display = new VehicleInteriorDisplay();
        return display.material;
      }
    });
    ctx.scene.add(this.vehicle.root);

    const vehicleKind = ctx.modeDefinition?.vehicleKind ?? 'stadtbahn';
    this.visual = new VehicleVisualController(this.vehicle, display, {
      line: ctx.route.line,
      destination: ctx.route.destination,
      lineAccentColor: ctx.modeDefinition?.lineAccentColor ?? (vehicleKind === 's-bahn' ? '#e0202b' : '#ffd800'),
      interiorCameraProfile: ctx.modeDefinition?.interiorCameraProfile ?? 'tram'
    });
    // Initial board so it isn't blank before the first schedule update.
    this.visual.updateInteriorDisplay(ctx.route.stations[1]?.name ?? ctx.route.destination, false);
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
    this.visual.updateDoors(open, deltaSeconds);
  }

  /** Applies interior/cab window transparency and shell visibility per view. */
  setPresentation(mode: CameraMode, cinematicActive: boolean): void {
    this.visual.setPresentation(mode, cinematicActive);
  }

  /** Head/tail lamps come on in low light (night, dawn, dusk). */
  updateExteriorLights(daylightFactor: number): void {
    this.visual.updateExteriorLights(daylightFactor);
  }

  updateInteriorDisplay(nextStation: string, doorsOpen: boolean): void {
    this.visual.updateInteriorDisplay(nextStation, doorsOpen);
  }

  dispose(): void {
    this.visual.dispose();
    this.vehicle = null;
  }
}

// Fallback so `root` stays non-null before/after the vehicle exists.
const EMPTY_GROUP = new THREE.Group();
