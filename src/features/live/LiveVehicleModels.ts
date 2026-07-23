import * as THREE from 'three';
import { buildTransitVehicle, isStadtbahnDoubleFormation, isBusLineArticulated, defaultBusBlueprint } from '../../vehicles';
import { fallbackTransportModeDefinition, type InteriorCameraProfile, type VehicleKind } from '../../domain/transport';
import { makeLabelTexture } from '../../labels';
import type { DemoRoute } from '../../route';
import { modeColor, type LiveMode } from './liveTypes';
import type { LiveVehicleStore, TrackedVehicle } from './LiveVehicleStore';
import type { Projection } from './liveProjection';

/** World-space pose along a run's track at a metre offset ahead/behind its center. */
export type OffsetPose = (runId: string, offsetM: number) => { x: number; z: number; bearing: number } | null;

/** The rendered model of a followed run, for anchoring interior/chase cameras. */
export type FollowModel = {
  train: THREE.Group;
  cars: THREE.Group[];
  trainHalfLengthM: number;
  profile: InteriorCameraProfile;
};

// The interior-camera profile the Explore rigs key on, from the live mode.
function profileForKind(kind: VehicleKind): InteriorCameraProfile {
  if (kind === 'bus') return 'bus';
  if (kind === 's-bahn') return 's-bahn';
  return 'tram'; // stadtbahn (light-rail / tram)
}

// Level-of-detail for the 3D view (concept §4.1): near vehicles get the full
// procedural models (the same kind-builders the ride view uses), everything else
// stays as the instanced blocks in Live3DScene. Line-label sprites fade in with
// altitude. Models and labels are pooled and reused — never built per frame.

const DEG = Math.PI / 180;
// Below this camera altitude, nearby vehicles upgrade to full models.
const MODEL_ALT_M = 900;
const MODEL_RADIUS_M = 1400;
const MODEL_CAP = 45;
// Labels fade in a bit higher than models and cover a wider ring.
const LABEL_ALT_M = 2400;
const LABEL_RADIUS_M = 2600;
const LABEL_CAP = 60;

function kindForMode(mode: LiveMode | undefined): VehicleKind {
  if (mode === 'bus') return 'bus';
  if (mode === 's-bahn' || mode === 'rail') return 's-bahn';
  return 'stadtbahn'; // light-rail, tram
}

// Which model formation a live run should use, and a representative line that makes
// the shared vehicle builder produce it. Formation follows the same VVS rules the
// Explore/ride view uses (double-traction Stadtbahn lines, articulated bus lines),
// so a U12 shows four Tango sections and an X-bus bends, exactly like Explore.
// Templates are cached per variant, so only a handful are ever built.
type Variant = { key: string; kind: VehicleKind; line: string };

function variantFor(v: TrackedVehicle): Variant {
  const kind = kindForMode(v.data.mode);
  const line = v.data.line;
  if (kind === 'stadtbahn') {
    const double = isStadtbahnDoubleFormation(line);
    return { key: 'stadtbahn:' + (double ? 'double' : 'single'), kind, line: double ? 'U12' : 'U5' };
  }
  if (kind === 'bus') {
    // Live has no city context yet, so formation follows the "city unknown" rule.
    const artic = isBusLineArticulated(defaultBusBlueprint, line, undefined);
    return { key: 'bus:' + (artic ? 'artic' : 'rigid'), kind, line: artic ? 'X1' : '70' };
  }
  return { key: kind, kind, line: '' };
}

type NearHit = { v: TrackedVehicle; x: number; z: number; d2: number; bearing: number };

/** Owns the near-field vehicle models and floating line labels for Live3DScene. */
export class LiveVehicleModels {
  // Keyed by formation variant (see variantFor), not just kind, so single/double
  // Stadtbahn and rigid/articulated bus each get their own pooled model.
  private readonly templates = new Map<string, THREE.Group | null>();
  private readonly templateMeta = new Map<string, { trainHalfLengthM: number; profile: InteriorCameraProfile }>();
  private readonly pools = new Map<string, THREE.Group[]>();
  private readonly labelPool: THREE.Sprite[] = [];
  private readonly labelTextures = new Map<string, THREE.Texture>();
  // Scratch objects reused across the per-car articulation loop (never per-frame allocs).
  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly projection: Projection
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
    offsetPose: OffsetPose
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
        const variant = variantFor(hit.v);
        const group = this.acquireModel(variant, usedByVariant);
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

  /** Model of a currently-rendered followed run, or null if it has no near model. */
  getFollowModel(runId: string): FollowModel | null {
    for (const pool of this.pools.values()) {
      for (const group of pool) {
        if (group.visible && group.userData.liveRunId === runId) {
          return {
            train: group,
            cars: (group.userData.liveCars as THREE.Group[]) ?? [],
            trainHalfLengthM: (group.userData.trainHalfLengthM as number) ?? 20,
            profile: (group.userData.interiorCameraProfile as InteriorCameraProfile) ?? 'tram'
          };
        }
      }
    }
    return null;
  }

  private acquireModel(variant: Variant, used: Map<string, number>): THREE.Group | null {
    const pool = this.pools.get(variant.key) ?? this.pools.set(variant.key, []).get(variant.key)!;
    const i = used.get(variant.key) ?? 0;
    used.set(variant.key, i + 1);
    let group = pool[i];
    if (!group) {
      const template = this.getTemplate(variant);
      if (!template) return null;
      group = template.clone(true); // shares geometry/materials with the template
      this.captureCars(group);
      const meta = this.templateMeta.get(variant.key);
      group.userData.trainHalfLengthM = meta?.trainHalfLengthM ?? 20;
      group.userData.interiorCameraProfile = meta?.profile ?? profileForKind(variant.kind);
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

  private getTemplate(variant: Variant): THREE.Group | null {
    if (this.templates.has(variant.key)) return this.templates.get(variant.key) ?? null;
    let root: THREE.Group | null = null;
    try {
      // A throwaway route carrying only the fields the builder reads; the line
      // drives the formation (double-traction / articulation).
      const route = { line: variant.line, destination: '', controlPoints: [] } as unknown as DemoRoute;
      const instance = buildTransitVehicle({
        route,
        modeDefinition: { ...fallbackTransportModeDefinition, id: variant.kind, vehicleKind: variant.kind },
        makeInteriorDisplayMaterial: () => new THREE.MeshBasicMaterial({ color: 0x0b0f14 })
      });
      root = instance.root;
      root.visible = false; // template stays hidden; only clones are shown
      // Tag cars so clones can recover the ordered car list (for articulation and
      // interior-camera anchoring); record formation length + interior profile.
      instance.cars.forEach((car, index) => {
        car.userData.liveCarIndex = index;
      });
      this.templateMeta.set(variant.key, {
        trainHalfLengthM: instance.trainHalfLengthM,
        profile: profileForKind(variant.kind)
      });
      this.scene.add(root); // keep it in the graph so dispose() sweeps its resources
    } catch (error) {
      console.warn(`Live 3D: could not build ${variant.key} vehicle model; falling back to blocks.`, error);
    }
    this.templates.set(variant.key, root);
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
