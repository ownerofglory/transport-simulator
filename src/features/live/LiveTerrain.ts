import * as THREE from 'three';
import { TerrainSampler } from '../../terrain';
import type { Projection } from './liveProjection';

// Terrain relief for the 3D view (concept §4.2 "terrain relief"). A single
// deformed grid around the fixed scene origin gives both the visible ground mesh
// and a fast synchronous height lookup for placing vehicles, labels, tunnels and
// the follow camera on Stuttgart's actual topography instead of a flat plane.
//
// The origin never moves, so the grid is sampled once and reused for the whole
// session; beyond its span the scene fog hides the edge. All heights are relative
// to the origin's elevation, so the origin sits at world y ≈ 0 and everything the
// OSM streamer places (which shares this sampler via `surfaceHeight`) lines up.

const GRID = 96; // cells per side → (GRID+1)² sampled nodes
const SPAN_M = 12_000; // grid covers ±6 km around the origin
const STEP_M = SPAN_M / GRID;

export class LiveTerrain {
  readonly mesh: THREE.Mesh;
  /** Resolves once the datum and heightfield are ready. */
  readonly ready: Promise<void>;

  private sampler: TerrainSampler | null = null;
  private heights: Float32Array | null = null; // (GRID+1)² row-major by [iz][ix]

  constructor(private readonly projection: Projection) {
    const geometry = new THREE.PlaneGeometry(SPAN_M, SPAN_M, GRID, GRID);
    geometry.rotateX(-Math.PI / 2); // lie flat in the XZ plane, +y up
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x6f7d5a }));
    this.mesh.name = 'Live terrain relief';
    this.ready = this.build(geometry).catch((error) => {
      console.warn('Live 3D: terrain relief unavailable; falling back to flat ground.', error);
    });
  }

  /**
   * Terrain height (world y) at a world x/z, bilinearly interpolated. Returns 0
   * until the heightfield loads and outside the sampled grid, so callers degrade
   * gracefully to the previous flat behavior.
   */
  heightAt(x: number, z: number): number {
    const h = this.heights;
    if (!h) return 0;
    const fx = (x + SPAN_M / 2) / STEP_M;
    const fz = (z + SPAN_M / 2) / STEP_M;
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

  private async build(geometry: THREE.PlaneGeometry): Promise<void> {
    // Datum = elevation at the origin, so the origin sits at y ≈ 0.
    const probe = new TerrainSampler(0);
    const originElevation = await probe.sample(this.projection.origin.lat, this.projection.origin.lon);
    this.sampler = new TerrainSampler(originElevation);

    const position = geometry.attributes.position;
    const count = position.count;
    const samples: Promise<number>[] = [];
    for (let i = 0; i < count; i++) {
      const { lat, lon } = this.projection.unproject(position.getX(i), position.getZ(i));
      samples.push(this.sampler.sample(lat, lon));
    }
    const elevations = await Promise.all(samples);

    // Deform the mesh and build the height lookup, indexing by grid node so the
    // bilinear read never depends on PlaneGeometry's internal vertex order.
    const heights = new Float32Array((GRID + 1) * (GRID + 1));
    const row = GRID + 1;
    for (let i = 0; i < count; i++) {
      const elevation = elevations[i];
      position.setY(i, elevation);
      const ix = Math.round((position.getX(i) + SPAN_M / 2) / STEP_M);
      const iz = Math.round((position.getZ(i) + SPAN_M / 2) / STEP_M);
      if (ix >= 0 && ix <= GRID && iz >= 0 && iz <= GRID) heights[iz * row + ix] = elevation;
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    this.heights = heights;
  }
}
