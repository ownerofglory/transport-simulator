import * as THREE from 'three';
import { TerrainSampler } from '../../terrain';
import type { Projection } from './liveProjection';

// Terrain relief for the 3D view (concept §4.2). A deformed grid provides both
// the visible ground mesh and a fast synchronous height lookup for placing
// vehicles, labels, tracks, tunnels and the follow camera on Stuttgart's actual
// topography instead of a flat plane.
//
// The grid recenters on the camera focus (like the OSM streamer) so following a
// vehicle far from the entry origin keeps the ground under it — the elevation
// datum stays fixed at the origin, so a recentered patch still lines up with the
// buildings the streamer places via the shared `surfaceHeight` sampler.

const GRID = 96; // cells per side → (GRID+1)² sampled nodes
const SPAN_M = 12_000; // grid covers ±6 km around its center
const STEP_M = SPAN_M / GRID;
// Resample when the focus drifts more than this from the current grid center,
// leaving a comfortable margin inside the ±6 km patch.
const RECENTER_M = 3_000;

export class LiveTerrain {
  readonly mesh: THREE.Mesh;
  /** Resolves once the datum and first heightfield are ready. */
  readonly ready: Promise<void>;

  private sampler: TerrainSampler | null = null;
  private heights: Float32Array | null = null; // (GRID+1)² by [iz][ix], relative to datum
  private readonly center = new THREE.Vector2(0, 0); // world x/z the grid is centered on
  private resampling = false;

  constructor(private readonly projection: Projection) {
    const geometry = new THREE.PlaneGeometry(SPAN_M, SPAN_M, GRID, GRID);
    geometry.rotateX(-Math.PI / 2); // lie flat in the XZ plane, +y up
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x6f7d5a }));
    this.mesh.name = 'Live terrain relief';
    this.ready = this.init().catch((error) => {
      console.warn('Live 3D: terrain relief unavailable; falling back to flat ground.', error);
    });
  }

  /**
   * Terrain height (world y) at a world x/z, bilinearly interpolated. Returns 0
   * until the heightfield loads and outside the current grid patch, so callers
   * degrade gracefully to flat ground.
   */
  heightAt(x: number, z: number): number {
    const h = this.heights;
    if (!h) return 0;
    const fx = (x - this.center.x + SPAN_M / 2) / STEP_M;
    const fz = (z - this.center.y + SPAN_M / 2) / STEP_M;
    if (fx < 0 || fx > GRID || fz < 0 || fz > GRID) return 0;
    const ix = Math.min(GRID - 1, Math.floor(fx));
    const iz = Math.min(GRID - 1, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;
    const row = GRID + 1;
    const h00 = h[iz * row + ix];
    const h10 = h[iz * row + ix + 1];
    const h01 = h[(iz + 1) * row + ix];
    const h11 = h[(iz + 1) * row + ix + 1];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h00, h10, tx), THREE.MathUtils.lerp(h01, h11, tx), tz);
  }

  /** Surface height for the OSM streamer; awaits the datum so tiles land on relief. */
  surfaceHeight = async (lat: number, lon: number): Promise<number> => {
    await this.ready;
    return this.sampler ? this.sampler.sample(lat, lon) : 0;
  };

  /** Recenters the grid on a world focus if it has drifted too far (call per frame). */
  update(focusX: number, focusZ: number): void {
    if (!this.sampler || this.resampling) return;
    if (Math.hypot(focusX - this.center.x, focusZ - this.center.y) < RECENTER_M) return;
    void this.resample(focusX, focusZ);
  }

  private async init(): Promise<void> {
    // Datum = elevation at the origin, so the origin sits at y ≈ 0 and every
    // recentered patch shares the same vertical reference as the OSM streamer.
    const probe = new TerrainSampler(0);
    const originElevation = await probe.sample(this.projection.origin.lat, this.projection.origin.lon);
    this.sampler = new TerrainSampler(originElevation);
    await this.resample(0, 0);
  }

  private async resample(cx: number, cz: number): Promise<void> {
    if (!this.sampler) return;
    this.resampling = true;
    try {
      const position = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const count = position.count;
      // Local x/z are fixed; sample real elevation at (center + local) per vertex.
      const samples: Promise<number>[] = [];
      for (let i = 0; i < count; i++) {
        const { lat, lon } = this.projection.unproject(cx + position.getX(i), cz + position.getZ(i));
        samples.push(this.sampler.sample(lat, lon));
      }
      const elevations = await Promise.all(samples);

      const row = GRID + 1;
      const heights = new Float32Array(row * row);
      for (let i = 0; i < count; i++) {
        const elevation = elevations[i];
        position.setY(i, elevation);
        const ix = Math.round((position.getX(i) + SPAN_M / 2) / STEP_M);
        const iz = Math.round((position.getZ(i) + SPAN_M / 2) / STEP_M);
        if (ix >= 0 && ix <= GRID && iz >= 0 && iz <= GRID) heights[iz * row + ix] = elevation;
      }
      position.needsUpdate = true;
      this.mesh.geometry.computeVertexNormals();
      this.mesh.position.set(cx, 0, cz);
      this.heights = heights;
      this.center.set(cx, cz);
    } finally {
      this.resampling = false;
    }
  }
}
