import * as THREE from 'three';
import type { DemoRoute } from '../../route';
import type { CityDefinition } from '../../cities';
import type { GuidewayKind } from '../../domain/transport';
import type { GeoPoint, LandmarkZone } from '../../landmarks';
import { TerrainSampler } from '../../terrain';
import { OsmSceneStreamer } from '../../osm-scene';
import { LandmarkLayer } from '../../world/layers/LandmarkLayer';
import type { WorldLayerContext } from '../../world/layers/WorldLayerContext';
import type { EngineSystem } from '../core/EngineSystem';

export type EnvironmentContext = {
  scene: THREE.Scene;
  route: DemoRoute;
  city?: CityDefinition;
  guidewayKind: GuidewayKind;
  routeGeo: GeoPoint[];
  projectGeo(lat: number, lon: number): THREE.Vector3;
  surfaceHeightAt(t: number): number;
  nearestSelectedGeoPoint(lat: number, lon: number, points: GeoPoint[]): { distanceM: number; t: number };
};

/**
 * Owns terrain sampling, curated landmarks, streamed OSM scenery, and the
 * ground/underground visibility of those layers.
 *
 * Built in two phases to preserve the world's original construction order:
 * the constructor creates terrain + landmarks (which the static layers may need
 * to sample against); {@link buildScenery} later starts OSM streaming (or a
 * static landmark layer) once the ground mesh exists. The scenery-height blend
 * that keeps streamed buildings sitting on the route corridor lives here too.
 */
export class EnvironmentSystem implements EngineSystem {
  private readonly terrain: TerrainSampler | null;
  private readonly landmarkGroup: THREE.Group;
  private readonly landmarkExclusions: LandmarkZone[];
  private osmScene: OsmSceneStreamer | null = null;
  private ground: THREE.Mesh | null = null;

  constructor(private readonly ctx: EnvironmentContext) {
    this.terrain = ctx.route.elevationDatumM !== undefined ? new TerrainSampler(ctx.route.elevationDatumM) : null;
    const landmarkLayer = ctx.city?.landmarkFactory?.(
      ctx.routeGeo,
      (lat, lon) => ctx.projectGeo(lat, lon),
      (lat, lon) => this.terrain?.sample(lat, lon) ?? Promise.resolve(0)
    );
    this.landmarkGroup = landmarkLayer?.group ?? new THREE.Group();
    this.landmarkExclusions = landmarkLayer?.zones ?? [];
    ctx.scene.add(this.landmarkGroup);
  }

  /**
   * Starts OSM building streaming (or a static landmark layer for routes without
   * geo points), remembering the ground mesh for underground toggling.
   *
   * Ferry routes are on open water — streaming land buildings from surrounding
   * hills at their real elevation produces floating boxes, so they are skipped.
   */
  buildScenery(layerContext: WorldLayerContext, ground: THREE.Mesh | null, initialGeoPoint: GeoPoint | undefined): void {
    this.ground = ground;
    const osmEnabled = this.ctx.guidewayKind !== 'ferry' && this.ctx.routeGeo.length >= 2;
    if (osmEnabled) {
      this.osmScene = new OsmSceneStreamer(
        this.ctx.scene,
        (lat, lon) => this.ctx.projectGeo(lat, lon),
        (lat, lon) => this.scenerySurfaceHeight(lat, lon),
        this.landmarkExclusions
      );
      this.osmScene.update(initialGeoPoint);
    } else if (this.ctx.guidewayKind !== 'ferry') {
      const landmarkLayer = new LandmarkLayer(layerContext);
      landmarkLayer.build();
      this.ctx.scene.add(landmarkLayer.root);
    }
  }

  /** Streams new tiles around the current position (no-op when OSM is disabled). */
  updateStreaming(geoPoint: GeoPoint | undefined): void {
    this.osmScene?.update(geoPoint);
  }

  /** Hides ground/scenery/landmarks while the route is in a tunnel. */
  setUnderground(underground: boolean): void {
    if (this.ground) this.ground.visible = !underground;
    if (this.osmScene) this.osmScene.group.visible = !underground;
    this.landmarkGroup.visible = !underground;
  }

  /**
   * Blends sampled terrain toward the route's own surface height near the
   * corridor so streamed buildings meet the track instead of floating/sinking.
   */
  private async scenerySurfaceHeight(lat: number, lon: number): Promise<number> {
    const sampledHeight = await (this.terrain?.sample(lat, lon) ?? Promise.resolve(0));
    if (this.ctx.routeGeo.length < 2) return sampledHeight;
    const nearest = this.ctx.nearestSelectedGeoPoint(lat, lon, this.ctx.routeGeo);
    const innerCorridorM = this.ctx.guidewayKind === 's-bahn' ? 28 : this.ctx.guidewayKind === 'bus' ? 20 : 12;
    const outerCorridorM = this.ctx.guidewayKind === 's-bahn' ? 110 : this.ctx.guidewayKind === 'bus' ? 80 : 52;
    if (nearest.distanceM >= outerCorridorM) return sampledHeight;
    const routeSurfaceHeight = this.ctx.surfaceHeightAt(nearest.t);
    const blend = THREE.MathUtils.smoothstep(nearest.distanceM, innerCorridorM, outerCorridorM);
    return THREE.MathUtils.lerp(routeSurfaceHeight, sampledHeight, blend);
  }

  dispose(): void {
    this.osmScene?.dispose();
    this.osmScene = null;
    this.ground = null;
  }
}
