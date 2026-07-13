import * as THREE from 'three';
import type { DemoRoute } from '../../route';
import type { CityDefinition } from '../../cities';
import type { TransportModeDefinition } from '../../domain/transport';
import type { CameraMode } from '../../world/CameraController';
import { buildTransitVehicle } from '../../vehicles';
import type { VehicleInstance } from '../../vehicles/types';
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
  private interiorDisplayCanvas: HTMLCanvasElement | null = null;
  private interiorDisplayTexture: THREE.CanvasTexture | null = null;
  private lastInteriorDisplayKey = '';
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
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    this.interiorDisplayCanvas = canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.interiorDisplayTexture = texture;
    this.updateInteriorDisplay(this.ctx.route.stations[1]?.name ?? this.ctx.route.destination, false);
    return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  }

  updateInteriorDisplay(nextStation: string, doorsOpen: boolean): void {
    if (!this.interiorDisplayCanvas || !this.interiorDisplayTexture) return;
    const route = this.ctx.route;
    const station = nextStation === 'End of line' ? 'Endstation' : nextStation || route.destination;
    const key = `${station}/${doorsOpen}`;
    if (key === this.lastInteriorDisplayKey) return;
    this.lastInteriorDisplayKey = key;

    const context = this.interiorDisplayCanvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#071015';
    context.fillRect(0, 0, 1024, 256);
    const vehicleKind = this.ctx.modeDefinition?.vehicleKind ?? 'stadtbahn';
    const accent = this.ctx.modeDefinition?.lineAccentColor ?? (vehicleKind === 's-bahn' ? '#e0202b' : '#ffd800');
    context.fillStyle = accent;
    context.fillRect(0, 0, 1024, 14);
    context.fillRect(24, 40, 126, 126);
    context.fillStyle = '#11151a';
    context.font = '800 56px Inter, Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(route.line, 87, 104);

    context.textAlign = 'left';
    context.fillStyle = '#a9b7bd';
    context.font = '600 30px Inter, Arial, sans-serif';
    context.fillText(doorsOpen ? 'TÜREN GEÖFFNET · DANACH' : 'NÄCHSTER HALT', 184, 62);

    let fontSize = 58;
    do {
      context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      fontSize -= 2;
    } while (context.measureText(station).width > 806 && fontSize > 30);
    context.fillStyle = '#f5f7f6';
    context.fillText(station, 184, 126);

    context.fillStyle = accent;
    context.font = '500 25px Inter, Arial, sans-serif';
    context.fillText(`Richtung ${route.destination}`, 184, 202);
    this.interiorDisplayTexture.needsUpdate = true;
  }

  dispose(): void {
    this.vehicle?.dispose?.();
    this.interiorDisplayTexture?.dispose();
    this.interiorDisplayCanvas = null;
    this.interiorDisplayTexture = null;
    this.vehicle = null;
  }
}

// Fallback so `root` stays non-null before/after the vehicle exists.
const EMPTY_GROUP = new THREE.Group();
