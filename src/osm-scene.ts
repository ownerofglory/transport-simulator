import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type GeoPoint = { lat: number; lon: number };

type TileEntry = {
  abort: AbortController;
  group: THREE.Group;
};

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

const VECTOR_TILE_ZOOM = 14;
const VISIBLE_RADIUS = 1;
const RETAIN_RADIUS = 2;
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const DEFAULT_BUILDING_HEIGHT_M = 11;

export class OsmSceneStreamer {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, TileEntry>();
  private tileTemplate: Promise<string> | null = null;
  private centerKey = '';
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly projectGeo: (lat: number, lon: number) => THREE.Vector3,
    private readonly surfaceHeight: (lat: number, lon: number) => Promise<number>
  ) {
    this.group.name = 'OpenStreetMap streamed scenery';
    scene.add(this.group);
  }

  update(point: GeoPoint | undefined): void {
    if (!point || this.disposed) return;
    const center = geoToTile(point, VECTOR_TILE_ZOOM);
    const key = `${center.x}/${center.y}`;
    if (key === this.centerKey) return;
    this.centerKey = key;

    for (let dx = -VISIBLE_RADIUS; dx <= VISIBLE_RADIUS; dx++) {
      for (let dy = -VISIBLE_RADIUS; dy <= VISIBLE_RADIUS; dy++) {
        this.ensureTile(center.x + dx, center.y + dy);
      }
    }

    for (const [tileKey, entry] of this.tiles) {
      const [x, y] = tileKey.split('/').map(Number);
      if (Math.abs(x - center.x) <= RETAIN_RADIUS && Math.abs(y - center.y) <= RETAIN_RADIUS) continue;
      entry.abort.abort();
      this.disposeObject(entry.group);
      this.group.remove(entry.group);
      this.tiles.delete(tileKey);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.tiles.values()) {
      entry.abort.abort();
      this.disposeObject(entry.group);
    }
    this.tiles.clear();
    this.group.removeFromParent();
  }

  private ensureTile(x: number, y: number): void {
    const key = `${x}/${y}`;
    if (this.tiles.has(key)) return;
    const entry: TileEntry = { abort: new AbortController(), group: new THREE.Group() };
    entry.group.name = `OSM ${VECTOR_TILE_ZOOM}/${x}/${y}`;
    this.tiles.set(key, entry);
    this.group.add(entry.group);
    void this.loadTile(x, y, key, entry);
  }

  private async loadTile(x: number, y: number, key: string, entry: TileEntry): Promise<void> {
    try {
      const template = await this.getTileTemplate();
      const url = template.replace('{z}', String(VECTOR_TILE_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
      const response = await fetch(url, { signal: entry.abort.signal });
      if (!response.ok) throw new Error(`vector tile request failed: ${response.status}`);
      const tile = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
      if (this.disposed || this.tiles.get(key) !== entry) return;

      await Promise.all([
        this.addBuildings(tile, x, y, entry.group),
        this.addTrees(tile, x, y, entry.group),
        this.addStreetLights(tile, x, y, entry.group)
      ]);
    } catch (error) {
      if (!entry.abort.signal.aborted) console.warn(`Could not load real-world scenery tile ${key}.`, error);
    }
  }

  private getTileTemplate(): Promise<string> {
    if (!this.tileTemplate) {
      this.tileTemplate = fetch(TILEJSON_URL)
        .then(async (response) => {
          if (!response.ok) throw new Error(`OpenFreeMap metadata request failed: ${response.status}`);
          const metadata = (await response.json()) as { tiles?: string[] };
          if (!metadata.tiles?.[0]) throw new Error('OpenFreeMap metadata did not contain a tile URL.');
          return metadata.tiles[0];
        });
    }
    return this.tileTemplate;
  }

  private async addBuildings(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const layer = tile.layers.building;
    if (!layer) return;
    const geometries: THREE.BufferGeometry[] = [];
    const windowVertices: number[] = [];
    const windowIndices: number[] = [];
    const roofVertices: number[] = [];
    const roofIndices: number[] = [];

    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      if (feature.properties.hide_3d === true) continue;
      const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
      const geometry = geoJson.geometry as GeoJsonGeometry;
      const polygons = geometry.type === 'Polygon'
        ? [geometry.coordinates as number[][][]]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates as number[][][][]
          : [];
      const height = numberProperty(feature.properties.render_height, this.defaultBuildingHeight(feature.id, index));
      const minHeight = Math.min(numberProperty(feature.properties.render_min_height, 0), height - 0.5);

      for (const polygon of polygons) {
        const shape = this.polygonShape(polygon);
        if (!shape) continue;
        const anchor = polygon[0]?.[0];
        const baseHeight = anchor ? await this.surfaceHeight(anchor[1], anchor[0]) : 0;
        this.addFacadeWindows(polygon, baseHeight + minHeight, baseHeight + height, windowVertices, windowIndices);
        this.addRoof(polygon, baseHeight + height, feature.id ?? index, roofVertices, roofIndices);
        const building = new THREE.ExtrudeGeometry(shape, {
          depth: Math.max(0.5, height - minHeight),
          bevelEnabled: false,
          curveSegments: 1
        });
        building.translate(0, 0, minHeight + baseHeight);
        building.rotateX(-Math.PI / 2);
        const color = this.buildingColor(feature.properties.colour, feature.id ?? index);
        const colors = new Float32Array(building.attributes.position.count * 3);
        for (let i = 0; i < building.attributes.position.count; i++) color.toArray(colors, i * 3);
        building.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometries.push(building);
      }
    }

    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return;
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.03 })
    );
    mesh.name = 'Real OSM buildings';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    target.add(mesh);

    const windows = this.detailMesh(
      windowVertices,
      windowIndices,
      new THREE.MeshStandardMaterial({
        color: 0x38576a,
        emissive: 0x14242e,
        emissiveIntensity: 0.28,
        roughness: 0.18,
        metalness: 0.12,
        side: THREE.DoubleSide
      }),
      'Batched facade windows'
    );
    if (windows) target.add(windows);

    const roofs = this.detailMesh(
      roofVertices,
      roofIndices,
      new THREE.MeshStandardMaterial({ color: 0x69645e, roughness: 0.9, side: THREE.DoubleSide }),
      'Batched roof forms'
    );
    if (roofs) {
      roofs.castShadow = true;
      roofs.receiveShadow = true;
      target.add(roofs);
    }
  }

  private addFacadeWindows(
    polygon: number[][][],
    baseHeight: number,
    topHeight: number,
    vertices: number[],
    indices: number[]
  ): void {
    const ring = polygon[0];
    if (!ring || topHeight - baseHeight < 4 || vertices.length > 180_000) return;
    const points = ring.map(([lon, lat]) => this.projectGeo(lat, lon));
    const floors = Math.min(14, Math.floor((topHeight - baseHeight - 1.2) / 3));
    for (let edge = 1; edge < points.length; edge++) {
      const a = points[edge - 1];
      const b = points[edge];
      const direction = b.clone().sub(a);
      const length = direction.length();
      const columns = Math.min(18, Math.floor(length / 3.1));
      if (columns < 1) continue;
      direction.normalize();
      const normal = new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(0.055);
      const windowWidth = Math.min(1.85, length / (columns + 0.6));
      for (let floor = 0; floor < floors; floor++) {
        const bottom = baseHeight + 1.45 + floor * 3;
        const top = Math.min(bottom + 1.35, topHeight - 0.45);
        for (let column = 0; column < columns; column++) {
          const centerDistance = ((column + 0.5) / columns) * length;
          const center = a.clone().add(direction.clone().multiplyScalar(centerDistance)).add(normal);
          const half = direction.clone().multiplyScalar(windowWidth / 2);
          this.appendQuad(
            center.clone().sub(half).setY(bottom),
            center.clone().add(half).setY(bottom),
            center.clone().add(half).setY(top),
            center.clone().sub(half).setY(top),
            vertices,
            indices
          );
          const oppositeCenter = center.clone().sub(normal.clone().multiplyScalar(2));
          this.appendQuad(
            oppositeCenter.clone().sub(half).setY(bottom),
            oppositeCenter.clone().add(half).setY(bottom),
            oppositeCenter.clone().add(half).setY(top),
            oppositeCenter.clone().sub(half).setY(top),
            vertices,
            indices
          );
        }
      }
    }
  }

  private addRoof(polygon: number[][][], topHeight: number, seed: number, vertices: number[], indices: number[]): void {
    const ring = polygon[0];
    if (!ring || ring.length < 4) return;
    const points = ring.slice(0, -1).map(([lon, lat]) => this.projectGeo(lat, lon));
    if (points.length < 3) return;
    const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const averageRadius = points.reduce((sum, point) => sum + point.distanceTo(center), 0) / points.length;
    const roofRise = seeded(seed * 19) > 0.42 ? THREE.MathUtils.clamp(averageRadius * 0.18, 1.2, 4.2) : 0.12;
    const apex = center.clone().setY(topHeight + roofRise);
    for (let index = 0; index < points.length; index++) {
      const a = points[index].clone().setY(topHeight + 0.06);
      const b = points[(index + 1) % points.length].clone().setY(topHeight + 0.06);
      const base = vertices.length / 3;
      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, apex.x, apex.y, apex.z);
      indices.push(base, base + 1, base + 2);
    }
  }

  private appendQuad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    vertices: number[],
    indices: number[]
  ): void {
    const base = vertices.length / 3;
    vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private detailMesh(
    vertices: number[],
    indices: number[],
    material: THREE.Material,
    name: string
  ): THREE.Mesh | null {
    if (vertices.length === 0) {
      material.dispose();
      return null;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }

  private async addTrees(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const samples: THREE.Vector3[] = [];
    for (const layerName of ['landcover', 'park']) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let index = 0; index < layer.length; index++) {
        const feature = layer.feature(index);
        const kind = String(feature.properties.class ?? '');
        if (layerName === 'landcover' && !['wood', 'grass'].includes(kind)) continue;
        const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
        const geometry = geoJson.geometry as GeoJsonGeometry;
        const polygons = geometry.type === 'Polygon'
          ? [geometry.coordinates as number[][][]]
          : geometry.type === 'MultiPolygon'
            ? geometry.coordinates as number[][][][]
            : [];
        for (const polygon of polygons) {
          const anchor = polygon[0]?.[0];
          const baseHeight = anchor ? await this.surfaceHeight(anchor[1], anchor[0]) : 0;
          this.samplePolygon(polygon, feature.id ?? index, kind === 'wood' ? 16 : 7, baseHeight, samples);
        }
      }
    }
    if (samples.length === 0) return;

    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.24, 2.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x66503a, roughness: 0.95 }),
      samples.length
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.8, 4.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x3f7542, roughness: 0.92 }),
      samples.length
    );
    const matrix = new THREE.Matrix4();
    samples.forEach((point, index) => {
      const scale = 0.8 + seeded(index + point.x * 0.01) * 0.55;
      matrix.compose(
        point.clone().add(new THREE.Vector3(0, 1.25 * scale, 0)),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale)
      );
      trunks.setMatrixAt(index, matrix);
      matrix.compose(
        point.clone().add(new THREE.Vector3(0, 4.2 * scale, 0)),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale)
      );
      crowns.setMatrixAt(index, matrix);
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    target.add(trunks, crowns);
  }

  private async addStreetLights(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const layer = tile.layers.transportation;
    if (!layer) return;
    const positions: THREE.Vector3[] = [];

    for (let index = 0; index < layer.length && positions.length < 100; index++) {
      const feature = layer.feature(index);
      const roadClass = String(feature.properties.class ?? '');
      if (!['primary', 'secondary', 'tertiary', 'minor'].includes(roadClass)) continue;
      const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
      const geometry = geoJson.geometry as GeoJsonGeometry;
      const lines = geometry.type === 'LineString'
        ? [geometry.coordinates as number[][]]
        : geometry.type === 'MultiLineString'
          ? geometry.coordinates as number[][][]
          : [];
      for (const line of lines) {
        const anchor = line[0];
        const baseHeight = anchor ? await this.surfaceHeight(anchor[1], anchor[0]) : 0;
        this.sampleRoadLights(line, baseHeight, positions);
      }
    }
    if (positions.length === 0) return;

    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.055, 0.075, 5.8, 6),
      new THREE.MeshStandardMaterial({ color: 0x60686c, roughness: 0.5, metalness: 0.65 }),
      positions.length
    );
    const lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.22, 7, 5),
      new THREE.MeshStandardMaterial({ color: 0xfff0bb, emissive: 0x6f5b28, emissiveIntensity: 0.35 }),
      positions.length
    );
    const matrix = new THREE.Matrix4();
    positions.forEach((point, index) => {
      matrix.makeTranslation(point.x, point.y + 2.9, point.z);
      poles.setMatrixAt(index, matrix);
      matrix.makeTranslation(point.x, point.y + 5.85, point.z);
      lamps.setMatrixAt(index, matrix);
    });
    poles.castShadow = true;
    target.add(poles, lamps);
  }

  private polygonShape(rings: number[][][]): THREE.Shape | null {
    if (!rings[0] || rings[0].length < 4) return null;
    const outer = rings[0].map(([lon, lat]) => this.projectGeo(lat, lon));
    const shape = new THREE.Shape(outer.map((point) => new THREE.Vector2(point.x, -point.z)));
    for (const ring of rings.slice(1)) {
      if (ring.length < 4) continue;
      const hole = ring.map(([lon, lat]) => this.projectGeo(lat, lon));
      shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(point.x, -point.z))));
    }
    return shape;
  }

  private samplePolygon(rings: number[][][], seed: number, count: number, baseHeight: number, output: THREE.Vector3[]): void {
    const ring = rings[0];
    if (!ring || ring.length < 4) return;
    const points = ring.map(([lon, lat]) => this.projectGeo(lat, lon));
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minZ = Math.min(...points.map((point) => point.z));
    const maxZ = Math.max(...points.map((point) => point.z));
    if ((maxX - minX) * (maxZ - minZ) < 400) return;
    let accepted = 0;
    for (let attempt = 0; attempt < count * 5 && accepted < count; attempt++) {
      const x = THREE.MathUtils.lerp(minX, maxX, seeded(seed * 31 + attempt * 2));
      const z = THREE.MathUtils.lerp(minZ, maxZ, seeded(seed * 47 + attempt * 2 + 1));
      if (pointInPolygon(x, z, points)) {
        output.push(new THREE.Vector3(x, baseHeight, z));
        accepted++;
      }
    }
  }

  private sampleRoadLights(line: number[][], baseHeight: number, output: THREE.Vector3[]): void {
    if (line.length < 2) return;
    const points = line.map(([lon, lat]) => this.projectGeo(lat, lon));
    let carried = 0;
    for (let i = 1; i < points.length && output.length < 100; i++) {
      const start = points[i - 1];
      const end = points[i];
      const segment = end.clone().sub(start);
      const length = segment.length();
      if (length < 1) continue;
      const direction = segment.clone().normalize();
      const normal = new THREE.Vector3(direction.z, 0, -direction.x);
      for (let distance = 55 - carried; distance < length; distance += 55) {
        const point = start.clone().add(direction.clone().multiplyScalar(distance)).add(normal.clone().multiplyScalar(4.5));
        point.y = baseHeight;
        output.push(point);
      }
      carried = (carried + length) % 55;
    }
  }

  private defaultBuildingHeight(id: number | undefined, index: number): number {
    return DEFAULT_BUILDING_HEIGHT_M + Math.floor(seeded((id ?? index) * 13) * 4) * 3;
  }

  private buildingColor(value: number | string | boolean | undefined, seed: number): THREE.Color {
    if (typeof value === 'string') {
      const aliases: Record<string, string> = {
        anthrazit: '#383e42',
        light_blue: '#add8e6',
        light_grey: '#d3d3d3',
        dark_grey: '#555b5e'
      };
      const normalized = aliases[value.toLowerCase()] ?? value;
      if (/^#[0-9a-f]{3,8}$/i.test(normalized) || /^(rgb|hsl)a?\(/i.test(normalized) || CSS.supports('color', normalized)) {
        return new THREE.Color().setStyle(normalized);
      }
    }
    const palette = [0xd0c5b5, 0xbda996, 0xd7d3c9, 0xaeb7b8, 0xc6bba9, 0xe0d8ca];
    return new THREE.Color(palette[Math.floor(seeded(seed * 7) * palette.length)]);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    });
  }
}

function geoToTile(point: GeoPoint, zoom: number): { x: number; y: number } {
  const latRad = (point.lat * Math.PI) / 180;
  const n = 2 ** zoom;
  return {
    x: Math.floor(((point.lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  };
}

function numberProperty(value: number | string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function seeded(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function pointInPolygon(x: number, z: number, polygon: THREE.Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
