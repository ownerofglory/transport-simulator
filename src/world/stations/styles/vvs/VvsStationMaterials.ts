import * as THREE from 'three';

/**
 * SSB/VVS Stadtbahn material palette, created once per route and reused across
 * every stop so stations share GPU resources. Values are lifted verbatim from
 * the legacy StationLayer.buildRailStations so the modular components render an
 * identical result.
 */
export class VvsStationMaterials {
  readonly platform = new THREE.MeshStandardMaterial({ color: 0xb9b7b0, roughness: 0.9 });
  readonly platformEdge = new THREE.MeshStandardMaterial({ color: 0x696b6c, roughness: 0.82 });
  readonly tactile = new THREE.MeshStandardMaterial({ color: 0xeee7cf, roughness: 0.92 });
  readonly ssbBlue = new THREE.MeshStandardMaterial({ color: 0x174a73, roughness: 0.45, metalness: 0.28 });
  readonly glass = new THREE.MeshStandardMaterial({
    color: 0xa9d0dd,
    roughness: 0.12,
    metalness: 0.08,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide
  });
  readonly canopy = new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.38, metalness: 0.34 });
  readonly bench = new THREE.MeshStandardMaterial({ color: 0x234e68, roughness: 0.68 });
  readonly machine = new THREE.MeshStandardMaterial({ color: 0xffd800, roughness: 0.48 });
  readonly light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4cf, emissiveIntensity: 2.1 });
  readonly undergroundWall = new THREE.MeshStandardMaterial({ color: 0xcacbc8, roughness: 0.88 });
  // Weathered concrete for hillside/cutting retaining walls.
  readonly concrete = new THREE.MeshStandardMaterial({ color: 0x9a978d, roughness: 0.96 });
  // Dark DFI departure-board face; amber text is faked with the label texture.
  readonly dfi = new THREE.MeshBasicMaterial({ color: 0x111820 });

  // Materials owned by this palette (reused across stops); per-stop disposal
  // must skip these so a removed station doesn't free shared resources.
  readonly shared = new Set<THREE.Material>([
    this.platform,
    this.platformEdge,
    this.tactile,
    this.ssbBlue,
    this.glass,
    this.canopy,
    this.bench,
    this.machine,
    this.light,
    this.undergroundWall,
    this.concrete,
    this.dfi
  ]);

  // Per-accent-color variants of the SSB-blue accent, cached and reused across
  // every stop that requests the same color so accent tinting stays share-safe.
  private readonly accentCache = new Map<string, THREE.MeshStandardMaterial>();

  /** Accent material for a station family color; falls back to the shared blue. */
  accent(color: string | undefined): THREE.MeshStandardMaterial {
    if (!color) return this.ssbBlue;
    let material = this.accentCache.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.45, metalness: 0.28 });
      this.accentCache.set(color, material);
      this.shared.add(material);
    }
    return material;
  }

  dispose(): void {
    for (const material of this.shared) material.dispose();
  }
}
