import * as THREE from 'three';
import type { WeatherKind } from '../../../weather';

function surfacePattern(tactile: boolean): THREE.DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const noise = ((x * 17 + y * 29 + (x * y) % 19) % 11) - 5;
      let shade: number;
      if (tactile) {
        const dx = (x % 16) - 8;
        const dy = (y % 16) - 8;
        const radius = Math.hypot(dx, dy);
        shade = radius < 4.5 ? 232 + (dx + dy) * 1.2 : 215 + noise;
      } else {
        const joint = x % 64 < 2 || y % 64 < 2;
        const slab = ((Math.floor(x / 64) + Math.floor(y / 64) * 3) % 3) * 3;
        shade = joint ? 133 : 188 + slab + noise;
      }
      pixels[index] = shade;
      pixels[index + 1] = tactile ? shade - 2 : shade - 1;
      pixels[index + 2] = tactile ? shade - 10 : shade - 4;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** SSB/VVS station palette, created once per route and reused across stops. */
export class VvsStationMaterials {
  private readonly pavingPattern = surfacePattern(false);
  private readonly tactilePattern = surfacePattern(true);
  readonly platform = new THREE.MeshStandardMaterial({ color: 0xb9b7b0, roughness: 0.9 });
  readonly platformEdge = new THREE.MeshStandardMaterial({ color: 0x696b6c, roughness: 0.82 });
  readonly tactile = new THREE.MeshStandardMaterial({ color: 0xeee7cf, roughness: 0.92 });
  readonly surfacePavers = new THREE.MeshStandardMaterial({
    map: this.pavingPattern, bumpMap: this.pavingPattern, bumpScale: 0.012, roughness: 0.84
  });
  readonly surfaceTactile = new THREE.MeshStandardMaterial({
    map: this.tactilePattern, bumpMap: this.tactilePattern, bumpScale: 0.008, roughness: 0.87
  });
  readonly surfaceSafetyLine = new THREE.MeshStandardMaterial({ color: 0xd9bd54, roughness: 0.72 });
  readonly dbPavers = new THREE.MeshStandardMaterial({
    color: 0xe3e8ec, map: this.pavingPattern, bumpMap: this.pavingPattern,
    bumpScale: 0.01, roughness: 0.82
  });
  readonly dbTactile = new THREE.MeshStandardMaterial({
    map: this.tactilePattern, bumpMap: this.tactilePattern, bumpScale: 0.009, roughness: 0.86
  });
  readonly dbSafetyLine = new THREE.MeshStandardMaterial({ color: 0xe4e7e7, roughness: 0.68 });
  readonly dbBlue = new THREE.MeshStandardMaterial({ color: 0x183d70, roughness: 0.44, metalness: 0.24 });
  readonly dbCanopyFrame = new THREE.MeshStandardMaterial({ color: 0x5a6571, roughness: 0.38, metalness: 0.45 });
  readonly dbBench = new THREE.MeshStandardMaterial({ color: 0x737e87, roughness: 0.52, metalness: 0.22 });
  readonly dbMachine = new THREE.MeshStandardMaterial({ color: 0xc7252d, roughness: 0.46 });
  readonly canopyGlass = new THREE.MeshStandardMaterial({
    color: 0xc9e0e5, roughness: 0.16, metalness: 0.04,
    transparent: true, opacity: 0.58, depthWrite: false, side: THREE.DoubleSide
  });
  readonly canopyFrame = new THREE.MeshStandardMaterial({ color: 0x7b8489, roughness: 0.36, metalness: 0.55 });
  // Underground twins of the deck surfaces; see the note on `undergroundWall`
  // for why the finishes below ground are slightly self-lit.
  readonly platformUnderground = new THREE.MeshStandardMaterial({
    color: 0xc4c2ba,
    roughness: 0.86,
    emissive: 0x8f8d87,
    emissiveIntensity: 0.32
  });
  readonly platformEdgeUnderground = new THREE.MeshStandardMaterial({
    color: 0x74767a,
    roughness: 0.8,
    emissive: 0x4c4e52,
    emissiveIntensity: 0.28
  });
  readonly tactileUnderground = new THREE.MeshStandardMaterial({
    color: 0xeee7cf,
    roughness: 0.9,
    emissive: 0xb3a98c,
    emissiveIntensity: 0.32
  });
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
  // Dark grey of masts, lamp columns, and sign posts.
  readonly mast = new THREE.MeshStandardMaterial({ color: 0x3a3d41, roughness: 0.55, metalness: 0.32 });
  // SSB orange of the information kiosks and service points.
  readonly kiosk = new THREE.MeshStandardMaterial({ color: 0xe8791a, roughness: 0.52 });
  readonly light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4cf, emissiveIntensity: 2.1 });
  // Underground surfaces carry a slight emissive term. The world's underground
  // lighting is tuned for a tunnel bore — near-zero ambient, tight fog — which
  // is right for a bore but leaves a station box unreadably dark, when the real
  // thing is the brightest place on the line. Self-lit finishes read as an
  // evenly lit hall without adding lights the renderer would have to shade.
  readonly undergroundWall = new THREE.MeshStandardMaterial({
    color: 0xcacbc8,
    roughness: 0.88,
    emissive: 0x9a9a95,
    emissiveIntensity: 0.34
  });
  // Weathered concrete for hillside/cutting retaining walls.
  readonly concrete = new THREE.MeshStandardMaterial({ color: 0x9a978d, roughness: 0.96 });
  // Dark DFI departure-board face; amber text is faked with the label texture.
  readonly dfi = new THREE.MeshBasicMaterial({ color: 0x111820 });
  // Signal-red buffer stop (Prellbock) at terminus track ends.
  readonly buffer = new THREE.MeshStandardMaterial({ color: 0xb0201f, roughness: 0.6, metalness: 0.2 });
  // Dark band above and below a clad wall field, and under the platform coping.
  readonly plinth = new THREE.MeshStandardMaterial({ color: 0x25262a, roughness: 0.72 });
  // Ribbed metal ceiling decks and the soffits stairs disappear into.
  readonly ceilingMetal = new THREE.MeshStandardMaterial({ color: 0x4a4d51, roughness: 0.62, metalness: 0.35 });
  // Brushed stainless of balustrades, escalator cheeks, and lift frames. Kept
  // only mildly metallic: there is no environment map underground, so a high
  // metalness reads as a black cut-out rather than as steel.
  readonly steel = new THREE.MeshStandardMaterial({
    color: 0xa8aeb2,
    roughness: 0.42,
    metalness: 0.3,
    emissive: 0x5c6165,
    emissiveIntensity: 0.32
  });
  // Escalator tread band — darker than the balustrade, ribbed-looking at distance.
  readonly treads = new THREE.MeshStandardMaterial({
    color: 0x74797d,
    roughness: 0.56,
    metalness: 0.22,
    emissive: 0x3f4347,
    emissiveIntensity: 0.34
  });
  // Backlit advertising face; the poster itself is a per-stop label texture.
  readonly vitrine = new THREE.MeshStandardMaterial({
    color: 0xf2f4f6,
    emissive: 0xfff3d8,
    emissiveIntensity: 0.75,
    roughness: 0.3
  });

  // Killesberg's Kodak filmstrip: a near-black carrier with lit frames and pale
  // perforations. The frames carry an emissive term for the same reason the
  // other underground finishes do — the box is lit for a bore, not a gallery.
  readonly filmCarrier = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.6 });
  readonly filmFrame = new THREE.MeshStandardMaterial({
    color: 0xb08a52,
    emissive: 0x6b5228,
    emissiveIntensity: 0.5,
    roughness: 0.45
  });
  readonly filmPerforation = new THREE.MeshStandardMaterial({
    color: 0xe8e4d8,
    emissive: 0x4a473e,
    emissiveIntensity: 0.4,
    roughness: 0.7
  });

  // Materials owned by this palette (reused across stops); per-stop disposal
  // must skip these so a removed station doesn't free shared resources.
  readonly shared = new Set<THREE.Material>([
    this.platform,
    this.platformEdge,
    this.tactile,
    this.surfacePavers,
    this.surfaceTactile,
    this.surfaceSafetyLine,
    this.dbPavers,
    this.dbTactile,
    this.dbSafetyLine,
    this.dbBlue,
    this.dbCanopyFrame,
    this.dbBench,
    this.dbMachine,
    this.canopyGlass,
    this.canopyFrame,
    this.platformUnderground,
    this.platformEdgeUnderground,
    this.tactileUnderground,
    this.ssbBlue,
    this.glass,
    this.canopy,
    this.bench,
    this.machine,
    this.light,
    this.undergroundWall,
    this.concrete,
    this.dfi,
    this.buffer,
    this.mast,
    this.kiosk,
    this.plinth,
    this.ceilingMetal,
    this.steel,
    this.treads,
    this.vitrine,
    this.filmCarrier,
    this.filmFrame,
    this.filmPerforation
  ]);

  // Per-color variants, cached and reused across every stop that requests the
  // same color so tinting stays share-safe. Keyed by role + color because the
  // same hex reads differently as glazed cladding than as a painted post.
  private readonly tintCache = new Map<string, THREE.MeshStandardMaterial>();

  private tinted(role: string, color: string, options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const key = `${role}:${color}`;
    let material = this.tintCache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), ...options });
      this.tintCache.set(key, material);
      this.shared.add(material);
    }
    return material;
  }

  /** Deck finishes for a stop, in their surface or underground variant. */
  surfaces(underground: boolean): {
    platform: THREE.MeshStandardMaterial;
    edge: THREE.MeshStandardMaterial;
    tactile: THREE.MeshStandardMaterial;
  } {
    return underground
      ? { platform: this.platformUnderground, edge: this.platformEdgeUnderground, tactile: this.tactileUnderground }
      : { platform: this.platform, edge: this.platformEdge, tactile: this.tactile };
  }

  /** Accent material for a station family color; falls back to the shared blue. */
  accent(color: string | undefined): THREE.MeshStandardMaterial {
    if (!color) return this.ssbBlue;
    return this.tinted('accent', color, { roughness: 0.45, metalness: 0.28 });
  }

  /** Glazed enamel/tile wall cladding; bare concrete when no color is given. */
  cladding(color: string | undefined, finish: 'concrete' | 'enamel-panel' | 'tile' = 'concrete'): THREE.MeshStandardMaterial {
    if (!color || finish === 'concrete') return this.undergroundWall;
    // Enamel panels are glossier than glazed tile and pick up the strip lights.
    // Both keep their own colour in the emissive term so a lit hall reads as
    // orange tile or yellow enamel rather than washing out to grey.
    return this.tinted(finish, color, {
      roughness: finish === 'enamel-panel' ? 0.28 : 0.42,
      metalness: finish === 'enamel-panel' ? 0.12 : 0.04,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.42
    });
  }

  /** Painted steelwork (trusses, column cladding, ceiling decks). */
  painted(color: string | undefined): THREE.MeshStandardMaterial {
    if (!color) return this.concrete;
    return this.tinted('painted', color, {
      roughness: 0.55,
      metalness: 0.18,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.3
    });
  }

  /** Emissive luminaire face in a given light color; defaults to the warm strip. */
  lamp(color: string | undefined): THREE.MeshStandardMaterial {
    if (!color) return this.light;
    return this.tinted('lamp', color, { emissive: new THREE.Color(color), emissiveIntensity: 2.1 });
  }

  setSurfaceWeather(kind: WeatherKind): void {
    const wet = kind === 'rain' || kind === 'thunder';
    this.surfacePavers.color.setHex(wet ? 0xc6cbcb : kind === 'snow' ? 0xf2f2ed : 0xffffff);
    this.surfacePavers.roughness = wet ? 0.36 : kind === 'snow' ? 0.94 : 0.84;
    this.surfaceSafetyLine.roughness = wet ? 0.42 : 0.72;
    this.dbPavers.color.setHex(wet ? 0xb9c2c9 : kind === 'snow' ? 0xf3f5f6 : 0xe3e8ec);
    this.dbPavers.roughness = wet ? 0.34 : kind === 'snow' ? 0.94 : 0.82;
    this.dbSafetyLine.roughness = wet ? 0.38 : 0.68;
    this.canopyGlass.roughness = wet ? 0.1 : 0.16;
  }

  dispose(): void {
    for (const material of this.shared) material.dispose();
    this.pavingPattern.dispose();
    this.tactilePattern.dispose();
  }
}
