import * as THREE from 'three';
import type { InteriorCameraProfile } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import type { VehicleInstance } from './types';
import type { VehicleInteriorDisplay } from './VehicleInteriorDisplay';
import type { WeatherKind } from '../world/weather';

// Everything that "presents" a built vehicle, independent of how it is placed:
// animated doors, the next-stop interior display, per-view window transparency and
// body/cab shell visibility, and exterior lamps. Shared by the simulator's active
// vehicle and the live follow vehicle so both behave identically; only placement
// (route distance vs live along-track) differs and lives outside this class.
//
// It owns presentation + shared resource disposal. It does NOT own route
// positioning, projection, terrain, cameras, live traffic, or schedule state.

/** Per-frame presentation inputs. */
export type VehiclePresentationState = {
  doorsOpen: boolean;
  nextStop: string;
  cameraMode: CameraMode;
  cinematicActive: boolean;
  daylightFactor: number;
  deltaSeconds: number;
};

// The presentation metadata the controller needs. In a later step this is replaced
// by the shared VehicleDefinition; kept minimal here so PR ordering stays clean.
export type VehiclePresentationConfig = {
  line: string;
  destination: string;
  lineAccentColor: string;
  interiorCameraProfile: InteriorCameraProfile;
};

export class VehicleVisualController {
  readonly root: THREE.Group;
  readonly cars: THREE.Group[];
  readonly trainHalfLengthM: number;
  readonly cameraProfile: InteriorCameraProfile;

  private doorOpenAmount = 0;

  // Lit-saloon state: the emissive material is created on first use and the
  // bands' own materials are kept so the swap can be undone in daylight.
  private windowsLit = false;
  private litWindowMaterial: THREE.MeshStandardMaterial | null = null;
  private unlitBandMaterials: (THREE.Material | THREE.Material[])[] | null = null;
  private readonly exteriorGlassColor: THREE.Color | null;
  private readonly exteriorGlassOpacity: number;
  private readonly exteriorGlassDepthWrite: boolean;
  private readonly exteriorPaintFinish: Array<{ material: THREE.MeshStandardMaterial; roughness: number; clearcoat: number }>;
  private readonly exteriorGlassRoughness: number;

  constructor(
    private readonly instance: VehicleInstance,
    private readonly display: VehicleInteriorDisplay | null,
    private readonly config: VehiclePresentationConfig
  ) {
    this.root = instance.root;
    this.cars = instance.cars;
    this.trainHalfLengthM = instance.trainHalfLengthM;
    this.cameraProfile = config.interiorCameraProfile;
    this.exteriorGlassColor = instance.glassMaterial?.color.clone() ?? null;
    this.exteriorGlassOpacity = instance.glassMaterial?.opacity ?? 1;
    this.exteriorGlassDepthWrite = instance.glassMaterial?.depthWrite ?? true;
    this.exteriorGlassRoughness = instance.glassMaterial?.roughness ?? 0;
    this.exteriorPaintFinish = [...new Set(instance.exteriorPaintMaterials ?? [])].map((material) => ({
      material,
      roughness: material.roughness,
      clearcoat: material instanceof THREE.MeshPhysicalMaterial ? material.clearcoat : 0
    }));
  }

  /** Applies every presentation aspect for the frame. */
  update(state: VehiclePresentationState): void {
    this.updateDoors(state.doorsOpen, state.deltaSeconds);
    this.updateInteriorDisplay(state.nextStop, state.doorsOpen);
    this.setPresentation(state.cameraMode, state.cinematicActive);
    this.updateExteriorLights(state.daylightFactor);
  }

  updateDoors(open: boolean, deltaSeconds: number): void {
    this.doorOpenAmount = THREE.MathUtils.damp(
      this.doorOpenAmount,
      open ? 1 : 0,
      open ? 5.2 : 6.5,
      THREE.MathUtils.clamp(deltaSeconds, 0, 0.1)
    );
    const eased = this.doorOpenAmount * this.doorOpenAmount * (3 - 2 * this.doorOpenAmount);
    for (const leaf of this.instance.doors) {
      leaf.group.position.z = leaf.closedZ + leaf.direction * 0.72 * eased;
    }
  }

  updateInteriorDisplay(nextStop: string, doorsOpen: boolean): void {
    this.display?.update({
      line: this.config.line,
      destination: this.config.destination,
      nextStop,
      doorsOpen,
      accentColor: this.config.lineAccentColor
    });
  }

  // In passenger/cab views the opaque body shells hide so the outside shows through
  // the glass; in cab view the cab shell/display hide so the line ahead is visible.
  setPresentation(mode: CameraMode, cinematicActive: boolean): void {
    const interiorView = !cinematicActive && (mode === 'passenger' || mode === 'cab');
    const cabView = mode === 'cab';
    const glass = this.instance.glassMaterial;
    if (glass) {
      glass.opacity = interiorView ? Math.min(0.1, this.exteriorGlassOpacity) : this.exteriorGlassOpacity;
      glass.depthWrite = interiorView ? false : this.exteriorGlassDepthWrite;
      if (this.exteriorGlassColor) glass.color.copy(this.exteriorGlassColor);
    }
    for (const band of this.instance.windowBands) band.visible = !interiorView;
    for (const shell of this.instance.cabShells) shell.visible = !cabView;
    for (const shell of this.instance.passengerShells) shell.visible = !interiorView;
    for (const display of this.instance.cabDisplays) display.visible = !cabView;
  }

  /** Head/tail lamps and lit windows come on in low light (night, dawn, dusk, tunnels). */
  updateExteriorLights(daylightFactor: number): void {
    const lightsOn = daylightFactor < 0.45;
    this.instance.setExteriorLightsOn?.(lightsOn);
    this.setWindowsLit(lightsOn);
  }

  /** Rain darkens reflections and sharpens the clearcoat without changing the paint color. */
  setWeather(kind: WeatherKind): void {
    const wetness = kind === 'rain' || kind === 'thunder' ? 1 : kind === 'fog' ? 0.25 : 0;
    for (const finish of this.exteriorPaintFinish) {
      finish.material.roughness = THREE.MathUtils.lerp(finish.roughness, 0.17, wetness);
      if (finish.material instanceof THREE.MeshPhysicalMaterial) {
        finish.material.clearcoat = THREE.MathUtils.lerp(finish.clearcoat, Math.max(0.72, finish.clearcoat), wetness);
      }
    }
    const glass = this.instance.glassMaterial;
    if (glass) glass.roughness = THREE.MathUtils.lerp(this.exteriorGlassRoughness, 0.13, wetness);
  }

  /**
   * Makes the saloon read as lit from outside.
   *
   * The window bands are dark strips sitting behind the glass, so with the
   * interior lit the windows still showed as black holes in a tunnel. Swapping
   * the band material for a warm emissive one puts the glow behind the glass
   * where it belongs. The bands carry body materials shared with other trim, so
   * this swaps the mesh's material rather than mutating the material itself.
   */
  private setWindowsLit(lit: boolean): void {
    const bands = this.instance.windowBands;
    if (lit === this.windowsLit || bands.length === 0) return;
    this.windowsLit = lit;

    if (lit) {
      this.unlitBandMaterials ??= bands.map((band) => band.material);
      this.litWindowMaterial ??= new THREE.MeshStandardMaterial({
        color: 0xd9c7ab,
        emissive: 0xffdca6,
        emissiveIntensity: 0.32,
        roughness: 0.65,
        transparent: true,
        opacity: 0.3,
        depthWrite: false
      });
      for (const band of bands) band.material = this.litWindowMaterial;
      return;
    }

    const unlit = this.unlitBandMaterials;
    if (unlit) for (const [index, band] of bands.entries()) band.material = unlit[index];
  }

  dispose(): void {
    this.instance.dispose?.();
    this.display?.dispose();
    this.litWindowMaterial?.dispose();
    this.litWindowMaterial = null;
  }
}
