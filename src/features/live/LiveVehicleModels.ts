import * as THREE from 'three';
import { buildTransitVehicle } from '../../vehicles';
import { fallbackTransportModeDefinition, type VehicleKind } from '../../domain/transport';
import { makeLabelTexture } from '../../labels';
import type { DemoRoute } from '../../route';
import { modeColor, type LiveMode } from './liveTypes';
import type { LiveVehicleStore, TrackedVehicle } from './LiveVehicleStore';
import type { Projection } from './liveProjection';

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

// A throwaway route carrying only the fields the procedural builder reads.
const STUB_ROUTE = { line: '', destination: '', controlPoints: [] } as unknown as DemoRoute;

type NearHit = { v: TrackedVehicle; x: number; z: number; d2: number };

/** Owns the near-field vehicle models and floating line labels for Live3DScene. */
export class LiveVehicleModels {
  private readonly templates = new Map<VehicleKind, THREE.Group | null>();
  private readonly pools = new Map<VehicleKind, THREE.Group[]>();
  private readonly labelPool: THREE.Sprite[] = [];
  private readonly labelTextures = new Map<string, THREE.Texture>();

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
    groundHeightAt: (x: number, z: number) => number
  ): Set<string> {
    const modeled = new Set<string>();

    // Project once and reuse for both models and labels.
    const hits: NearHit[] = [];
    const wantModels = altitudeM < MODEL_ALT_M;
    const wantLabels = altitudeM < LABEL_ALT_M;
    if (wantModels || wantLabels) {
      const maxR = Math.max(wantModels ? MODEL_RADIUS_M : 0, wantLabels ? LABEL_RADIUS_M : 0);
      const maxR2 = maxR * maxR;
      for (const v of store.list()) {
        const p = this.projection.project(v.render.lat, v.render.lon);
        const dx = p.x - target.x;
        const dz = p.z - target.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= maxR2) hits.push({ v, x: p.x, z: p.z, d2 });
      }
      hits.sort((a, b) => a.d2 - b.d2);
    }

    // ---- Models (nearest, closest ring) ----
    const usedByKind = new Map<VehicleKind, number>();
    if (wantModels) {
      const r2 = MODEL_RADIUS_M * MODEL_RADIUS_M;
      let placed = 0;
      for (const hit of hits) {
        if (placed >= MODEL_CAP) break;
        if (hit.d2 > r2) break;
        const kind = kindForMode(hit.v.data.mode);
        const group = this.acquireModel(kind, usedByKind);
        if (!group) continue;
        const ground = groundHeightAt(hit.x, hit.z);
        group.position.set(hit.x, ground + (isInTunnel(hit.v) ? -4.7 : 0.3), hit.z);
        group.rotation.set(0, -hit.v.bearing * DEG, 0);
        group.userData.liveRunId = hit.v.runId;
        group.visible = true;
        modeled.add(hit.v.runId);
        placed++;
      }
    }
    this.hideUnusedModels(usedByKind);

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
        // Underground vehicles are represented at the surface by their label,
        // matching the subdued tunnel-glow treatment in the live-mode concept.
        sprite.position.set(hit.x, groundHeightAt(hit.x, hit.z) + 9, hit.z);
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

  private acquireModel(kind: VehicleKind, used: Map<VehicleKind, number>): THREE.Group | null {
    const pool = this.pools.get(kind) ?? this.pools.set(kind, []).get(kind)!;
    const i = used.get(kind) ?? 0;
    used.set(kind, i + 1);
    let group = pool[i];
    if (!group) {
      const template = this.getTemplate(kind);
      if (!template) return null;
      group = template.clone(true); // shares geometry/materials with the template
      pool.push(group);
      this.scene.add(group);
    }
    return group;
  }

  private hideUnusedModels(used: Map<VehicleKind, number>): void {
    for (const [kind, pool] of this.pools) {
      for (let i = used.get(kind) ?? 0; i < pool.length; i++) pool[i].visible = false;
    }
  }

  private getTemplate(kind: VehicleKind): THREE.Group | null {
    if (this.templates.has(kind)) return this.templates.get(kind) ?? null;
    let root: THREE.Group | null = null;
    try {
      const instance = buildTransitVehicle({
        route: STUB_ROUTE,
        modeDefinition: { ...fallbackTransportModeDefinition, id: kind, vehicleKind: kind },
        makeInteriorDisplayMaterial: () => new THREE.MeshBasicMaterial({ color: 0x0b0f14 })
      });
      root = instance.root;
      root.visible = false; // template stays hidden; only clones are shown
      this.scene.add(root); // keep it in the graph so dispose() sweeps its resources
    } catch (error) {
      console.warn(`Live 3D: could not build ${kind} vehicle model; falling back to blocks.`, error);
    }
    this.templates.set(kind, root);
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
