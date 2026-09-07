import * as THREE from 'three';
import { buildTransitVehicle } from '../../vehicles';
import type { VehicleDefinition } from '../../vehicles/VehicleDefinition';
import type { CityDefinition } from '../../cities';
import { makeLabelTexture } from '../../labels';
import { modeColor, type LiveMode } from './liveTypes';
import { resolveLiveVehicleDefinition } from './liveVehicleDefinition';
import type { LiveVehicleStore, TrackedVehicle } from './LiveVehicleStore';
import type { Projection } from './liveProjection';

/** World-space pose along a run's track at a metre offset ahead/behind its center. */
export type OffsetPose = (runId: string, offsetM: number) => { x: number; z: number; bearing: number } | null;

// Level-of-detail for the 3D view (concept §4.1): near vehicles get the full
// procedural models (the same kind-builders the ride view uses), everything else
// stays as the instanced blocks in Live3DScene. Line-label sprites fade in with
// altitude. Models and labels are pooled and reused — never built per frame.

const DEG = Math.PI / 180;
// Below this camera altitude, nearby vehicles upgrade to full models.
const MODEL_ALT_M = 900;
const MODEL_RADIUS_M = 1400;
const MODEL_CAP = 32;
// Labels fade in a bit higher than models and cover a wider ring.
const LABEL_ALT_M = 2400;
const LABEL_RADIUS_M = 2600;
const LABEL_CAP = 60;

// Overview models pool by resolved definition, so vehicles that build the same
// design + formation share one template (e.g. every double Stadtbahn line), while
// single/double Stadtbahn and rigid/articulated bus each get their own.
export function vehiclePoolKey(definition: VehicleDefinition): string {
  return [
    definition.vehicleDesignId ?? definition.vehicleKind,
    definition.formation?.doubleFormation ? 'double' : 'single',
    definition.formation?.articulated ? 'articulated' : 'rigid'
  ].join(':');
}

type NearHit = { v: TrackedVehicle; x: number; z: number; d2: number; bearing: number };

/** Owns the near-field vehicle models and floating line labels for Live3DScene. */
export class LiveVehicleModels {
  // Keyed by resolved-definition pool key (see vehiclePoolKey).
  private readonly templates = new Map<string, THREE.Group | null>();
  private readonly pools = new Map<string, THREE.Group[]>();
  private readonly labelPool: THREE.Sprite[] = [];
  private readonly labelTextures = new Map<string, THREE.Texture>();
  // Scratch objects reused across the per-car articulation loop (never per-frame allocs).
  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly projection: Projection,
    private readonly city?: CityDefinition
  ) {}

  /**
   * Places models on the nearest vehicles and labels on a wider ring, both gated
   * by camera altitude. Returns the runIds that received a full model so the
   * caller can omit them from the instanced blocks.
   */
  update(
    store: LiveVehicleStore,
    target: THREE.Vector3,
    altitudeM: number,
    isInTunnel: (vehicle: TrackedVehicle) => boolean,
    groundHeightAt: (x: number, z: number) => number,
    resolveWorld: (vehicle: TrackedVehicle) => { x: number; z: number; bearing: number },
    cameraPos: THREE.Vector3,
    offsetPose: OffsetPose,
    excludeRunId: string | null = null
  ): Set<string> {
    const modeled = new Set<string>();

    // Project once (route-snapped) and reuse for both models and labels.
    const hits: NearHit[] = [];
    const wantModels = altitudeM < MODEL_ALT_M;
    const wantLabels = altitudeM < LABEL_ALT_M;
    if (wantModels || wantLabels) {
      const maxR = Math.max(wantModels ? MODEL_RADIUS_M : 0, wantLabels ? LABEL_RADIUS_M : 0);
      const maxR2 = maxR * maxR;
      for (const v of store.list()) {
        const w = resolveWorld(v);
        const dx = w.x - target.x;
        const dz = w.z - target.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= maxR2) hits.push({ v, x: w.x, z: w.z, d2, bearing: w.bearing });
      }
      hits.sort((a, b) => a.d2 - b.d2);
    }

    // ---- Models (nearest, closest ring) ----
    const usedByVariant = new Map<string, number>();
    if (wantModels) {
      const r2 = MODEL_RADIUS_M * MODEL_RADIUS_M;
      let placed = 0;
      for (const hit of hits) {
        if (placed >= MODEL_CAP) break;
        if (hit.d2 > r2) break;
        if (hit.v.runId === excludeRunId) continue; // dedicated follow vehicle renders this run
        const definition = resolveLiveVehicleDefinition(hit.v.data, this.city);
        const group = this.acquireModel(definition, vehiclePoolKey(definition), usedByVariant);
        if (!group) continue;
        const yOff = isInTunnel(hit.v) ? -4.7 : 0.3;
        this.placeVehicle(group, hit, groundHeightAt, offsetPose, yOff);
        group.userData.liveRunId = hit.v.runId;
        group.visible = true;
        modeled.add(hit.v.runId);
        placed++;
      }
    }
    this.hideUnusedModels(usedByVariant);

    // ---- Labels (wider ring) ----
    let labelCount = 0;
    if (wantLabels) {
      const r2 = LABEL_RADIUS_M * LABEL_RADIUS_M;
      for (const hit of hits) {
        if (labelCount >= LABEL_CAP) break;
        if (hit.d2 > r2) break;
        const line = hit.v.data.line;
        if (!line) continue;
        const sprite = this.acquireLabel(labelCount, line, hit.v.data.mode);
        const y = groundHeightAt(hit.x, hit.z) + 7;
        sprite.position.set(hit.x, y, hit.z);
        // Scale with distance to the camera so the badge stays a roughly constant,
        // compact on-screen size instead of ballooning when zoomed in on a vehicle.
        const dist = Math.hypot(hit.x - cameraPos.x, y - cameraPos.y, hit.z - cameraPos.z);
        const w = THREE.MathUtils.clamp(dist * 0.05, 3, 60);
        sprite.scale.set(w, w * 0.42, 1);
        sprite.userData.liveRunId = hit.v.runId;
        sprite.visible = true;
        labelCount++;
      }
    }
    for (let i = labelCount; i < this.labelPool.length; i++) this.labelPool[i].visible = false;

    return modeled;
  }

  dispose(): void {
    for (const group of this.pools.values()) for (const g of group) this.scene.remove(g);
    for (const sprite of this.labelPool) {
      this.scene.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const tex of this.labelTextures.values()) tex.dispose();
    // Template geometries/materials are disposed by Live3DScene's scene sweep.
  }

  pick(raycaster: THREE.Raycaster): string | null {
    const labels = raycaster.intersectObjects(this.labelPool.filter((sprite) => sprite.visible), false);
    const label = labels[0]?.object.userData.liveRunId;
    if (typeof label === 'string') return label;

    const roots = [...this.pools.values()].flat().filter((group) => group.visible);
    const hit = raycaster.intersectObjects(roots, true)[0]?.object;
    let object: THREE.Object3D | null | undefined = hit;
    while (object) {
      const runId = object.userData.liveRunId;
      if (typeof runId === 'string') return runId;
      object = object.parent;
    }
    return null;
  }

  // Places a model. When the run is matched to a track, each car (a child group
  // carrying userData.centerOffsetM) is swung to its own along-track pose so the
  // train bends through curves — the same articulation the Explore view uses.
  // Otherwise cars are restored to their straight built-in layout.
  private placeVehicle(
    group: THREE.Group,
    hit: NearHit,
    groundHeightAt: (x: number, z: number) => number,
    offsetPose: OffsetPose,
    yOff: number
  ): void {
    const rootY = groundHeightAt(hit.x, hit.z) + yOff;
    group.position.set(hit.x, rootY, hit.z);
    group.rotation.set(0, -hit.bearing * DEG, 0); // yaw keeps group.quaternion in sync

    const cars = group.userData.liveCars as THREE.Group[] | undefined;
    if (!cars || cars.length < 2) return; // single-body vehicle: nothing to articulate

    const invRoot = this._q.copy(group.quaternion).invert();
    for (const car of cars) {
      const def = car.userData as { defaultPos: THREE.Vector3; defaultQuat: THREE.Quaternion };
      // Only cars with an explicit along-body offset articulate (procedural
      // Stadtbahn); blueprint sections bake their offset into meshes, so they stay
      // rigid at their built local transform.
      const offsetRaw = car.userData.centerOffsetM;
      const pose = offsetRaw === undefined ? null : offsetPose(hit.v.runId, Number(offsetRaw));
      if (!pose) {
        car.position.copy(def.defaultPos);
        car.quaternion.copy(def.defaultQuat);
        continue;
      }
      // Car center in the root's local frame (same height plane as the root).
      this._v.set(pose.x - hit.x, 0, pose.z - hit.z).applyQuaternion(invRoot);
      car.position.set(this._v.x, def.defaultPos.y, this._v.z);
      // Local yaw = inverse(root) * world-yaw(-pose.bearing).
      car.quaternion
        .setFromAxisAngle(this._up, -pose.bearing * DEG)
        .premultiply(invRoot);
    }
  }

  private acquireModel(definition: VehicleDefinition, key: string, used: Map<string, number>): THREE.Group | null {
    const pool = this.pools.get(key) ?? this.pools.set(key, []).get(key)!;
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    let group = pool[i];
    if (!group) {
      const template = this.getTemplate(definition, key);
      if (!template) return null;
      group = template.clone(true); // shares geometry/materials with the template
      this.captureCars(group);
      pool.push(group);
      this.scene.add(group);
    }
    return group;
  }

  // Records a clone's cars (ordered by liveCarIndex) and each car's built-in
  // (straight) local transform, so placeVehicle can bend the articulable ones and
  // restore them, and the interior camera can anchor to a car.
  private captureCars(group: THREE.Group): void {
    const indexed: Array<{ index: number; car: THREE.Group }> = [];
    group.traverse((child) => {
      if (child instanceof THREE.Group && child.userData.liveCarIndex !== undefined) {
        child.userData.defaultPos = child.position.clone();
        child.userData.defaultQuat = child.quaternion.clone();
        indexed.push({ index: child.userData.liveCarIndex as number, car: child });
      }
    });
    indexed.sort((a, b) => a.index - b.index);
    group.userData.liveCars = indexed.map((e) => e.car);
  }

  private hideUnusedModels(used: Map<string, number>): void {
    for (const [key, pool] of this.pools) {
      for (let i = used.get(key) ?? 0; i < pool.length; i++) pool[i].visible = false;
    }
  }

  private getTemplate(definition: VehicleDefinition, key: string): THREE.Group | null {
    if (this.templates.has(key)) return this.templates.get(key) ?? null;
    let root: THREE.Group | null = null;
    try {
      // Build from the shared definition — the same design/formation the follow
      // vehicle and the simulator resolve. A dummy display material is fine; the
      // overview model has no live next-stop board.
      const instance = buildTransitVehicle({
        definition,
        makeInteriorDisplayMaterial: () => new THREE.MeshBasicMaterial({ color: 0x0b0f14 })
      });
      root = instance.root;
      prepareOverviewVehicle(root);
      root.visible = false; // template stays hidden; only clones are shown
      // Tag cars so clones can recover the ordered car list (used for articulation).
      instance.cars.forEach((car, index) => {
        car.userData.liveCarIndex = index;
      });
      this.scene.add(root); // keep it in the graph so dispose() sweeps its resources
    } catch (error) {
      console.warn(`Live 3D: could not build ${key} vehicle model; falling back to blocks.`, error);
    }
    this.templates.set(key, root);
    return root;
  }

  private acquireLabel(index: number, line: string, mode: LiveMode | undefined): THREE.Sprite {
    let sprite = this.labelPool[index];
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      sprite.scale.set(20, 9, 1);
      this.labelPool.push(sprite);
      this.scene.add(sprite);
    }
    const key = `${line}|${mode ?? ''}`;
    let texture = this.labelTextures.get(key);
    if (!texture) {
      texture = makeLabelTexture(line, { width: 220, height: 96, bg: modeColor(mode), fg: '#0b0f14' });
      this.labelTextures.set(key, texture);
    }
    const material = sprite.material as THREE.SpriteMaterial;
    if (material.map !== texture) {
      material.map = texture;
      material.needsUpdate = true;
    }
    return sprite;
  }
}

/**
 * Overview vehicles reuse the complete registered mesh, but never its real
 * lights. Every cloned PointLight/SpotLight consumes shader uniforms even when
 * switched off; a few dozen vehicles can otherwise make the whole Live scene
 * fail to compile on common GPUs. The dedicated followed vehicle is built
 * separately and keeps the complete lighting and interior presentation.
 */
export function prepareOverviewVehicle(root: THREE.Object3D): void {
  const lights: THREE.Light[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Light) lights.push(object);
    // Keep close-up geometry owned by the template so normal world disposal
    // still reaches it, but clones inherit `visible = false` and never draw it.
    if (object.userData.liveOverviewOmit === true) object.visible = false;
    if (object instanceof THREE.Mesh) object.castShadow = false;
  });
  for (const light of lights) light.removeFromParent();
}
