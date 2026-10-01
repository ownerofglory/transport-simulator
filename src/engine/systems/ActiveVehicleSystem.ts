import * as THREE from 'three';
import type { WeatherKind } from '../../world/weather';
import type { DemoRoute } from '../../route';
import type { CityDefinition } from '../../cities';
import { fallbackTransportModeDefinition, type TransportModeDefinition } from '../../domain/transport';
import type { CameraMode } from '../../world/CameraController';
import { resolveRouteVehicleDefinition } from '../../vehicles/VehicleDefinition';
import type { VehicleVisualController } from '../../vehicles/VehicleVisualController';
import { vehicleVisualFactory } from '../../vehicles/VehicleVisualFactory';
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
  // Shared presentation (doors, interior display, visibility, lamps); placement
  // stays here because the simulator drives it by route distance.
  private readonly visual: VehicleVisualController;

  constructor(private readonly ctx: ActiveVehicleContext) {
    // Resolve the shared definition and build through the shared factory; the real
    // route/city/mode are still forwarded so route-specific builder reads (e.g.
    // funicular orientation) keep working.
    const definition = resolveRouteVehicleDefinition(ctx.route, ctx.city, ctx.modeDefinition ?? fallbackTransportModeDefinition);
    this.visual = vehicleVisualFactory.create(definition, {
      route: ctx.route,
      city: ctx.city,
      modeDefinition: ctx.modeDefinition
    });
    ctx.scene.add(this.visual.root);
    // Initial board from the real schedule (first stop), not just the destination.
    this.visual.updateInteriorDisplay(ctx.route.stations[1]?.name ?? ctx.route.destination, false);
  }

  /** The vehicle root group (identity of the active train in the scene). */
  get root(): THREE.Group {
    return this.visual.root;
  }

  get cars(): THREE.Group[] {
    return this.visual.cars;
  }

  get trainHalfLengthM(): number {
    return this.visual.trainHalfLengthM;
  }

  /** Places the articulated sections at the given route distance (forward). */
  place(distanceM: number): void {
    this.ctx.placeArticulated(this.visual.root, this.visual.cars, distanceM, 1, this.ctx.activeLaneOffsetM);
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

  setWeather(kind: WeatherKind): void {
    this.visual.setWeather(kind);
  }

  updateInteriorDisplay(nextStation: string, doorsOpen: boolean): void {
    this.visual.updateInteriorDisplay(nextStation, doorsOpen);
  }

  dispose(): void {
    this.visual.dispose();
  }
}
