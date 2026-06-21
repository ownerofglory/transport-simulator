import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LandmarkZone } from './landmarks';

export type GeoPoint = { lat: number; lon: number };

type TileEntry = {
  abort: AbortController;
  group: THREE.Group;
};

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

type FeatureProperties = Record<string, string | number | boolean>;

type SurfaceStyle = {
  color: number;
  roughness?: number;
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
    private readonly surfaceHeight: (lat: number, lon: number) => Promise<number>,
    private readonly buildingExclusions: LandmarkZone[] = []
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
        this.addLandSurfaces(tile, x, y, entry.group),
        this.addWater(tile, x, y, entry.group),
        this.addRoads(tile, x, y, entry.group),
        this.addTransportInfrastructure(tile, x, y, entry.group),
        this.addBuildings(tile, x, y, entry.group),
        this.addTrees(tile, x, y, entry.group),
        this.addStreetLights(tile, x, y, entry.group),
        this.addPois(tile, x, y, entry.group)
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

  private async addLandSurfaces(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const batches = new Map<string, { style: SurfaceStyle; geometries: THREE.BufferGeometry[] }>();
    for (const layerName of ['landcover', 'landuse']) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let index = 0; index < layer.length; index++) {
        const feature = layer.feature(index);
        const properties = feature.properties as FeatureProperties;
        const kind = String(properties.class ?? '');
        const subclass = String(properties.subclass ?? '');
        const style = this.landSurfaceStyle(layerName, kind, subclass);
        if (!style) continue;
        const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
        const geometry = geoJson.geometry as GeoJsonGeometry;
        const polygons = geometry.type === 'Polygon'
          ? [geometry.coordinates as number[][][]]
          : geometry.type === 'MultiPolygon'
            ? geometry.coordinates as number[][][][]
            : [];
        const batchKey = `${style.color}/${style.roughness ?? 0.96}`;
        let batch = batches.get(batchKey);
        if (!batch) {
          batch = { style, geometries: [] };
          batches.set(batchKey, batch);
        }
        for (const polygon of polygons) {
          const surface = await this.terrainPolygonGeometry(polygon, layerName === 'landuse' ? 0.055 : 0.025);
          if (surface) batch.geometries.push(surface);
        }
      }
    }

    for (const { style, geometries } of batches.values()) {
      this.addMergedMesh(
        target,
        geometries,
        new THREE.MeshStandardMaterial({ color: style.color, roughness: style.roughness ?? 0.96, polygonOffset: true, polygonOffsetFactor: -1 }),
        'Streamed OSM land cover',
        false,
        true
      );
    }
  }

  private landSurfaceStyle(layerName: string, kind: string, subclass: string): SurfaceStyle | null {
    const precise = subclass || kind;
    if (layerName === 'landcover') {
      const styles: Record<string, SurfaceStyle> = {
        vineyard: { color: 0x71864a },
        orchard: { color: 0x78945c },
        allotments: { color: 0x829b62 },
        garden: { color: 0x77966b },
        flowerbed: { color: 0x8a9c68 },
        farmland: { color: 0x9a9f67 },
        farm: { color: 0x9a9f67 },
        grass: { color: 0x668854 },
        grassland: { color: 0x6f8e57 },
        meadow: { color: 0x76935b },
        wood: { color: 0x466d45 },
        forest: { color: 0x466d45 },
        scrub: { color: 0x5f7850 },
        shrubbery: { color: 0x607b52 },
        heath: { color: 0x817a58 },
        wetland: { color: 0x617d68 },
        marsh: { color: 0x617d68 },
        reedbed: { color: 0x6d8262 },
        sand: { color: 0xb6aa7b },
        bare_rock: { color: 0x86837b },
        rock: { color: 0x86837b },
        scree: { color: 0x8d887c }
      };
      return styles[precise] ?? styles[kind] ?? null;
    }

    const styles: Record<string, SurfaceStyle> = {
      railway: { color: 0x74716c },
      cemetery: { color: 0x56785b },
      industrial: { color: 0x777778 },
      commercial: { color: 0x817a75 },
      retail: { color: 0x8d7c78 },
      garages: { color: 0x77736f },
      school: { color: 0xa0876d },
      university: { color: 0x927c68 },
      college: { color: 0x927c68 },
      kindergarten: { color: 0xa88d70 },
      hospital: { color: 0x9b7775 },
      stadium: { color: 0x66866a },
      pitch: { color: 0x4f8654 },
      playground: { color: 0xa18a62 },
      track: { color: 0x8d7358 },
      bus_station: { color: 0x6e7376 },
      quarry: { color: 0x817e76 },
      zoo: { color: 0x66805a }
    };
    return styles[kind] ?? null;
  }

  private async addTransportInfrastructure(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const layer = tile.layers.transportation;
    if (!layer) return;
    const ballast: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const footways: THREE.BufferGeometry[] = [];
    const cycleways: THREE.BufferGeometry[] = [];
    const platforms: THREE.BufferGeometry[] = [];
    const bridges: THREE.BufferGeometry[] = [];
    let lineCount = 0;

    for (let index = 0; index < layer.length && lineCount < 260; index++) {
      const feature = layer.feature(index);
      const properties = feature.properties as FeatureProperties;
      const featureClass = String(properties.class ?? '');
      const subclass = String(properties.subclass ?? '');
      const brunnel = String(properties.brunnel ?? '');
      if (brunnel === 'tunnel') continue;
      const railway = this.isRailway(featureClass, subclass);
      const pedestrian = this.isPedestrianFeature(featureClass, subclass);
      if (!railway && !pedestrian && brunnel !== 'bridge') continue;
      const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
      const geometry = geoJson.geometry as GeoJsonGeometry;

      const polygons = geometry.type === 'Polygon'
        ? [geometry.coordinates as number[][][]]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates as number[][][][]
          : [];
      if (pedestrian && polygons.length) {
        for (const polygon of polygons) {
          const surface = await this.terrainPolygonGeometry(polygon, subclass === 'platform' ? 0.18 : 0.1);
          if (surface) (subclass === 'platform' ? platforms : footways).push(surface);
        }
      }
      if (featureClass === 'bridge' && polygons.length) {
        for (const polygon of polygons) {
          const surface = await this.terrainPolygonGeometry(polygon, 2.22);
          if (surface) bridges.push(surface);
        }
      }

      const lines = geometry.type === 'LineString'
        ? [geometry.coordinates as number[][]]
        : geometry.type === 'MultiLineString'
          ? geometry.coordinates as number[][][]
          : [];
      for (const line of lines) {
        if (line.length < 2 || lineCount++ >= 260) break;
        const lift = brunnel === 'bridge' ? 2.4 : 0;
        const points = await this.projectLine(line, lift);
        if (railway) {
          ballast.push(this.polylineStrip(points, 3.15, 0.09));
          rails.push(this.polylineStrip(this.offsetPolyline(points, -0.72), 0.11, 0.2));
          rails.push(this.polylineStrip(this.offsetPolyline(points, 0.72), 0.11, 0.2));
        } else if (pedestrian) {
          const collection = subclass === 'cycleway' ? cycleways : subclass === 'platform' ? platforms : footways;
          const width = subclass === 'platform' ? 4.4 : subclass === 'pedestrian' ? 3.2 : subclass === 'cycleway' ? 2.3 : 1.75;
          collection.push(this.polylineStrip(points, width, 0.12));
        }
        if (brunnel === 'bridge') {
          const width = railway ? 4.2 : Math.max(3, this.roadWidth(featureClass, subclass) + 1.5);
          bridges.push(this.polylineStrip(points, width, -0.18));
        }
      }
    }

    this.addMergedMesh(target, bridges, new THREE.MeshStandardMaterial({ color: 0x777a7b, roughness: 0.82 }), 'Streamed OSM bridge decks', true, true);
    this.addMergedMesh(target, ballast, new THREE.MeshStandardMaterial({ color: 0x5e5b55, roughness: 1 }), 'Streamed OSM railway ballast', false, true);
    this.addMergedMesh(target, rails, new THREE.MeshStandardMaterial({ color: 0x9da1a2, roughness: 0.35, metalness: 0.72 }), 'Streamed OSM railway rails', false, true);
    this.addMergedMesh(target, footways, new THREE.MeshStandardMaterial({ color: 0xa49d91, roughness: 0.98 }), 'Streamed OSM footways and steps', false, true);
    this.addMergedMesh(target, cycleways, new THREE.MeshStandardMaterial({ color: 0x8e7770, roughness: 0.96 }), 'Streamed OSM cycleways', false, true);
    this.addMergedMesh(target, platforms, new THREE.MeshStandardMaterial({ color: 0xb4afa3, roughness: 0.94 }), 'Streamed OSM public transport platforms', false, true);
  }

  private async addRoads(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const layer = tile.layers.transportation;
    if (!layer) return;
    const roadGeometries: THREE.BufferGeometry[] = [];
    const sidewalkGeometries: THREE.BufferGeometry[] = [];
    const markingVertices: number[] = [];
    let lineCount = 0;

    for (let index = 0; index < layer.length && lineCount < 220; index++) {
      const feature = layer.feature(index);
      const roadClass = String(feature.properties.class ?? '');
      const subclass = String(feature.properties.subclass ?? '');
      const brunnel = String(feature.properties.brunnel ?? '');
      if (brunnel === 'tunnel' || this.isRailway(roadClass, subclass) || this.isPedestrianFeature(roadClass, subclass)) continue;
      const width = this.roadWidth(roadClass, subclass);
      if (width <= 0) continue;
      const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
      const geometry = geoJson.geometry as GeoJsonGeometry;
      const lines = geometry.type === 'LineString'
        ? [geometry.coordinates as number[][]]
        : geometry.type === 'MultiLineString'
          ? geometry.coordinates as number[][][]
          : [];

      for (const line of lines) {
        if (line.length < 2 || lineCount++ >= 220) break;
        const points = await Promise.all(line.map(async ([lon, lat]) => {
          const point = this.projectGeo(lat, lon);
          point.y = await this.surfaceHeight(lat, lon) + (brunnel === 'bridge' ? 2.4 : 0);
          return point;
        }));
        roadGeometries.push(this.polylineStrip(points, width, 0.11));
        if (width >= 5.5) sidewalkGeometries.push(this.polylineStrip(points, width + 3.2, 0.045));
        if (width >= 7) {
          for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
            const a = points[pointIndex - 1];
            const b = points[pointIndex];
            markingVertices.push(a.x, a.y + 0.17, a.z, b.x, b.y + 0.17, b.z);
          }
        }
      }
    }

    const sidewalks = sidewalkGeometries.length ? mergeGeometries(sidewalkGeometries, false) : null;
    for (const geometry of sidewalkGeometries) geometry.dispose();
    if (sidewalks) {
      const mesh = new THREE.Mesh(sidewalks, new THREE.MeshStandardMaterial({ color: 0x9b9b96, roughness: 0.96 }));
      mesh.name = 'Streamed OSM sidewalks';
      mesh.receiveShadow = true;
      target.add(mesh);
    }

    const roads = roadGeometries.length ? mergeGeometries(roadGeometries, false) : null;
    for (const geometry of roadGeometries) geometry.dispose();
    if (roads) {
      const mesh = new THREE.Mesh(roads, new THREE.MeshStandardMaterial({ color: 0x44494c, roughness: 0.92 }));
      mesh.name = 'Streamed OSM roads';
      mesh.receiveShadow = true;
      target.add(mesh);
    }

    if (markingVertices.length) {
      const markings = new THREE.BufferGeometry();
      markings.setAttribute('position', new THREE.Float32BufferAttribute(markingVertices, 3));
      const lines = new THREE.LineSegments(markings, new THREE.LineBasicMaterial({ color: 0xe9e2c3, transparent: true, opacity: 0.78 }));
      lines.name = 'Streamed road center markings';
      target.add(lines);
    }
  }

  private async addWater(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const geometries: THREE.BufferGeometry[] = [];
    const waterLayer = tile.layers.water;
    if (waterLayer) {
      for (let index = 0; index < waterLayer.length; index++) {
        const feature = waterLayer.feature(index);
        const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
        const geometry = geoJson.geometry as GeoJsonGeometry;
        const polygons = geometry.type === 'Polygon'
          ? [geometry.coordinates as number[][][]]
          : geometry.type === 'MultiPolygon'
            ? geometry.coordinates as number[][][][]
            : [];
        for (const polygon of polygons) {
          const water = await this.terrainPolygonGeometry(polygon, 0.16);
          if (water) geometries.push(water);
        }
      }
    }

    const waterwayLayer = tile.layers.waterway;
    if (waterwayLayer) {
      for (let index = 0; index < waterwayLayer.length; index++) {
        const feature = waterwayLayer.feature(index);
        const kind = String(feature.properties.class ?? feature.properties.subclass ?? 'stream');
        const width = this.waterwayWidth(kind);
        const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
        const geometry = geoJson.geometry as GeoJsonGeometry;
        const lines = geometry.type === 'LineString'
          ? [geometry.coordinates as number[][]]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates as number[][][]
            : [];
        for (const line of lines) {
          if (line.length < 2) continue;
          const points = await Promise.all(line.map(async ([lon, lat]) => {
            const point = this.projectGeo(lat, lon);
            point.y = await this.surfaceHeight(lat, lon);
            return point;
          }));
          geometries.push(this.polylineStrip(points, width, 0.14));
        }
      }
    }

    const merged = geometries.length ? mergeGeometries(geometries, false) : null;
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return;
    const water = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({
        color: 0x3b91b5,
        roughness: 0.2,
        metalness: 0.08,
        transparent: true,
        opacity: 0.84,
        side: THREE.DoubleSide
      })
    );
    water.name = 'Streamed OSM rivers and lakes';
    water.receiveShadow = true;
    target.add(water);
  }

  private waterwayWidth(kind: string): number {
    const widths: Record<string, number> = {
      river: 14,
      canal: 9,
      stream: 4,
      ditch: 2.4,
      drain: 1.8
    };
    return widths[kind] ?? 3.2;
  }

  private roadWidth(roadClass: string, subclass: string): number {
    const widths: Record<string, number> = {
      motorway: 15,
      trunk: 13,
      primary: 11,
      secondary: 9,
      tertiary: 7.5,
      minor: 6,
      service: 4.2,
      track: 3.4,
      path: 2.1
    };
    if (roadClass === 'minor' && subclass === 'residential') return 5.5;
    return widths[roadClass] ?? 0;
  }

  private polylineStrip(points: THREE.Vector3[], width: number, heightOffset: number): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index < points.length; index++) {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const direction = next.clone().sub(previous).setY(0).normalize();
      const normal = new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(width / 2);
      const center = points[index].clone().add(new THREE.Vector3(0, heightOffset, 0));
      const left = center.clone().sub(normal);
      const right = center.clone().add(normal);
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
      if (index < points.length - 1) {
        const base = index * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private async addBuildings(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const layer = tile.layers.building;
    if (!layer) return;
    const geometries: THREE.BufferGeometry[] = [];

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
      const height = numberProperty(feature.properties.render_height, DEFAULT_BUILDING_HEIGHT_M);
      const minHeight = Math.min(numberProperty(feature.properties.render_min_height, 0), height - 0.5);

      for (const polygon of polygons) {
        const anchor = polygon[0]?.[0];
        if (anchor && this.buildingIsExcluded(anchor[1], anchor[0])) continue;
        const shape = this.polygonShape(polygon);
        if (!shape) continue;
        const baseHeight = anchor ? await this.surfaceHeight(anchor[1], anchor[0]) : 0;
        const building = new THREE.ExtrudeGeometry(shape, {
          depth: Math.max(0.5, height - minHeight),
          bevelEnabled: false,
          curveSegments: 1
        });
        building.translate(0, 0, minHeight + baseHeight);
        building.rotateX(-Math.PI / 2);
        const color = this.buildingColor(feature.properties.colour);
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
  }

  private async addTrees(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const samples: THREE.Vector3[] = [];
    const shrubs: THREE.Vector3[] = [];
    for (const layerName of ['landcover', 'park']) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let index = 0; index < layer.length; index++) {
        const feature = layer.feature(index);
        const kind = String(feature.properties.class ?? '');
        const subclass = String(feature.properties.subclass ?? '');
        const treeArea = layerName === 'park' || kind === 'wood' || ['forest', 'wood', 'orchard'].includes(subclass);
        const shrubArea = ['vineyard', 'scrub', 'shrubbery', 'allotments'].includes(subclass);
        if (!treeArea && !shrubArea) continue;
        const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
        const geometry = geoJson.geometry as GeoJsonGeometry;
        const polygons = geometry.type === 'Polygon'
          ? [geometry.coordinates as number[][][]]
          : geometry.type === 'MultiPolygon'
            ? geometry.coordinates as number[][][][]
            : [];
        for (const polygon of polygons) {
          const output = shrubArea ? shrubs : samples;
          const density = shrubArea ? 22 : kind === 'wood' ? 16 : 8;
          await this.samplePolygon(polygon, feature.id ?? index, density, output);
        }
      }
    }
    if (samples.length) {
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
        matrix.compose(point.clone().add(new THREE.Vector3(0, 1.25 * scale, 0)), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
        trunks.setMatrixAt(index, matrix);
        matrix.compose(point.clone().add(new THREE.Vector3(0, 4.2 * scale, 0)), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
        crowns.setMatrixAt(index, matrix);
      });
      trunks.name = 'Streamed OSM tree trunks';
      crowns.name = 'Streamed OSM tree crowns';
      trunks.castShadow = true;
      crowns.castShadow = true;
      target.add(trunks, crowns);
    }
    if (shrubs.length) {
      this.addInstances(
        target,
        'Streamed OSM vineyards and shrubs',
        new THREE.DodecahedronGeometry(0.62, 0),
        new THREE.MeshStandardMaterial({ color: 0x527442, roughness: 0.96 }),
        shrubs,
        0.55,
        true
      );
    }
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
        await this.sampleRoadLights(line, positions);
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

  private async addPois(tile: VectorTile, tileX: number, tileY: number, target: THREE.Group): Promise<void> {
    const layer = tile.layers.poi;
    if (!layer) return;
    const buckets = new Map<string, THREE.Vector3[]>();
    const limits: Record<string, number> = {
      transit: 60,
      traffic_signal: 35,
      parking: 35,
      bench: 25,
      waste: 25,
      bicycle: 30,
      fountain: 18,
      bollard: 40,
      amenity: 35
    };

    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      const properties = feature.properties as FeatureProperties;
      const kind = this.poiKind(String(properties.class ?? ''), String(properties.subclass ?? ''));
      if (!kind) continue;
      const bucket = buckets.get(kind) ?? [];
      if (bucket.length >= limits[kind]) continue;
      const rank = numberProperty(properties.rank, 99);
      if (kind === 'amenity' && rank > 12) continue;
      const geoJson = feature.toGeoJSON(tileX, tileY, VECTOR_TILE_ZOOM);
      const geometry = geoJson.geometry as GeoJsonGeometry;
      const coordinates = geometry.type === 'Point'
        ? [geometry.coordinates as number[]]
        : geometry.type === 'MultiPoint'
          ? geometry.coordinates as number[][]
          : [];
      for (const [lon, lat] of coordinates) {
        if (bucket.length >= limits[kind]) break;
        const point = this.projectGeo(lat, lon);
        point.y = await this.surfaceHeight(lat, lon);
        bucket.push(point);
        buckets.set(kind, bucket);
      }
    }

    const grey = new THREE.MeshStandardMaterial({ color: 0x5f6669, roughness: 0.55, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x242a2d, roughness: 0.62 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x17659a, roughness: 0.58 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc7332f, emissive: 0x57110e, emissiveIntensity: 0.5 });

    for (const [kind, positions] of buckets) {
      if (kind === 'transit') {
        this.addInstances(target, 'Streamed transit stop poles', new THREE.CylinderGeometry(0.055, 0.065, 2.5, 6), grey, positions, 1.25);
        this.addInstances(target, 'Streamed transit stop signs', new THREE.BoxGeometry(0.58, 0.72, 0.12), blue, positions, 2.3);
      } else if (kind === 'traffic_signal') {
        this.addInstances(target, 'Streamed traffic signal poles', new THREE.CylinderGeometry(0.065, 0.085, 3.4, 7), grey, positions, 1.7);
        this.addInstances(target, 'Streamed traffic signal heads', new THREE.BoxGeometry(0.34, 0.95, 0.3), dark, positions, 3.25);
        this.addInstances(target, 'Streamed traffic signal lights', new THREE.SphereGeometry(0.105, 7, 5), red, positions, 3.5);
      } else if (kind === 'parking') {
        this.addInstances(target, 'Streamed parking sign poles', new THREE.CylinderGeometry(0.045, 0.055, 1.9, 6), grey, positions, 0.95);
        this.addInstances(target, 'Streamed parking signs', new THREE.BoxGeometry(0.55, 0.55, 0.08), blue, positions, 1.95);
      } else if (kind === 'bench') {
        this.addInstances(target, 'Streamed benches', new THREE.BoxGeometry(1.7, 0.16, 0.48), new THREE.MeshStandardMaterial({ color: 0x79583c, roughness: 0.9 }), positions, 0.58, true);
      } else if (kind === 'waste') {
        this.addInstances(target, 'Streamed bins and recycling points', new THREE.CylinderGeometry(0.26, 0.3, 0.9, 8), dark, positions, 0.45);
      } else if (kind === 'bicycle') {
        this.addInstances(target, 'Streamed bicycle racks', new THREE.TorusGeometry(0.52, 0.055, 6, 10, Math.PI), grey, positions, 0.55, true);
      } else if (kind === 'fountain') {
        this.addInstances(target, 'Streamed fountains', new THREE.CylinderGeometry(1.25, 1.4, 0.38, 12), new THREE.MeshStandardMaterial({ color: 0x777e80, roughness: 0.72 }), positions, 0.19);
      } else if (kind === 'bollard') {
        this.addInstances(target, 'Streamed bollards', new THREE.CylinderGeometry(0.09, 0.12, 0.8, 7), dark, positions, 0.4);
      } else {
        this.addInstances(target, 'Streamed local POI markers', new THREE.CylinderGeometry(0.12, 0.18, 1.7, 6), new THREE.MeshStandardMaterial({ color: 0xd0a82f, roughness: 0.65 }), positions, 0.85);
      }
    }
  }

  private poiKind(featureClass: string, subclass: string): string | null {
    if (subclass === 'traffic_signals') return 'traffic_signal';
    if (['bus_stop', 'tram_stop', 'station', 'halt', 'subway_entrance'].includes(subclass) || ['bus', 'railway', 'entrance'].includes(featureClass)) return 'transit';
    if (['parking', 'parking_entrance'].includes(subclass) || featureClass === 'car') return 'parking';
    if (subclass === 'bench') return 'bench';
    if (['waste_basket', 'recycling', 'waste_disposal'].includes(subclass)) return 'waste';
    if (['bicycle_parking', 'bicycle_rental'].includes(subclass)) return 'bicycle';
    if (['fountain', 'drinking_water'].includes(subclass)) return 'fountain';
    if (subclass === 'bollard') return 'bollard';
    if (['fuel', 'cafe', 'fast_food', 'shop', 'atm', 'post', 'library', 'hospital', 'school', 'attraction', 'castle', 'stadium'].includes(featureClass)) return 'amenity';
    return null;
  }

  private isRailway(featureClass: string, subclass: string): boolean {
    return featureClass === 'rail' || ['rail', 'narrow_gauge', 'preserved', 'funicular', 'subway', 'light_rail', 'monorail', 'tram'].includes(subclass);
  }

  private isPedestrianFeature(featureClass: string, subclass: string): boolean {
    return featureClass === 'path' || ['pedestrian', 'path', 'footway', 'cycleway', 'steps', 'bridleway', 'corridor', 'platform'].includes(subclass);
  }

  private async projectLine(line: number[][], heightOffset = 0): Promise<THREE.Vector3[]> {
    return Promise.all(line.map(async ([lon, lat]) => {
      const point = this.projectGeo(lat, lon);
      point.y = await this.surfaceHeight(lat, lon) + heightOffset;
      return point;
    }));
  }

  private offsetPolyline(points: THREE.Vector3[], offsetM: number): THREE.Vector3[] {
    return points.map((point, index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const direction = next.clone().sub(previous).setY(0).normalize();
      return point.clone().add(new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(offsetM));
    });
  }

  private async terrainPolygonGeometry(rings: number[][][], heightOffset: number): Promise<THREE.BufferGeometry | null> {
    const validRings = rings
      .filter((ring) => ring.length >= 4)
      .map((ring) => {
        const copy = ring.slice();
        const first = copy[0];
        const last = copy.at(-1);
        if (last && first[0] === last[0] && first[1] === last[1]) copy.pop();
        return copy;
      })
      .filter((ring) => ring.length >= 3);
    if (!validRings.length) return null;

    const projectedRings = validRings.map((ring) => ring.map(([lon, lat]) => this.projectGeo(lat, lon)));
    const contour = projectedRings[0].map((point) => new THREE.Vector2(point.x, -point.z));
    const holes = projectedRings.slice(1).map((ring) => ring.map((point) => new THREE.Vector2(point.x, -point.z)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    if (!faces.length) return null;

    const coordinates = validRings.flat();
    const projected = projectedRings.flat();
    const heights = await Promise.all(coordinates.map(([lon, lat]) => this.surfaceHeight(lat, lon)));
    const positions: number[] = [];
    projected.forEach((point, index) => positions.push(point.x, heights[index] + heightOffset, point.z));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(faces.flat());
    geometry.computeVertexNormals();
    return geometry;
  }

  private addMergedMesh(
    target: THREE.Group,
    geometries: THREE.BufferGeometry[],
    material: THREE.Material,
    name: string,
    castShadow: boolean,
    receiveShadow: boolean
  ): void {
    if (!geometries.length) {
      material.dispose();
      return;
    }
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) {
      material.dispose();
      return;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    target.add(mesh);
  }

  private addInstances(
    target: THREE.Group,
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    positions: THREE.Vector3[],
    yOffset: number,
    randomYaw = false
  ): void {
    if (!positions.length) {
      geometry.dispose();
      material.dispose();
      return;
    }
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    positions.forEach((position, index) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), randomYaw ? seeded(position.x + position.z + index) * Math.PI : 0);
      matrix.compose(position.clone().add(new THREE.Vector3(0, yOffset, 0)), quaternion, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(index, matrix);
    });
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    target.add(mesh);
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

  private async samplePolygon(rings: number[][][], seed: number, count: number, output: THREE.Vector3[]): Promise<void> {
    const ring = rings[0];
    if (!ring || ring.length < 4) return;
    const points = ring.map(([lon, lat]) => this.projectGeo(lat, lon));
    const minLon = Math.min(...ring.map(([lon]) => lon));
    const maxLon = Math.max(...ring.map(([lon]) => lon));
    const minLat = Math.min(...ring.map(([, lat]) => lat));
    const maxLat = Math.max(...ring.map(([, lat]) => lat));
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minZ = Math.min(...points.map((point) => point.z));
    const maxZ = Math.max(...points.map((point) => point.z));
    if ((maxX - minX) * (maxZ - minZ) < 400) return;
    let accepted = 0;
    for (let attempt = 0; attempt < count * 5 && accepted < count; attempt++) {
      const lon = THREE.MathUtils.lerp(minLon, maxLon, seeded(seed * 31 + attempt * 2));
      const lat = THREE.MathUtils.lerp(minLat, maxLat, seeded(seed * 47 + attempt * 2 + 1));
      const point = this.projectGeo(lat, lon);
      if (pointInPolygon(point.x, point.z, points)) {
        point.y = await this.surfaceHeight(lat, lon);
        output.push(point);
        accepted++;
      }
    }
  }

  private async sampleRoadLights(line: number[][], output: THREE.Vector3[]): Promise<void> {
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
        const fraction = distance / length;
        const lon = THREE.MathUtils.lerp(line[i - 1][0], line[i][0], fraction);
        const lat = THREE.MathUtils.lerp(line[i - 1][1], line[i][1], fraction);
        const point = start.clone().add(direction.clone().multiplyScalar(distance)).add(normal.clone().multiplyScalar(4.5));
        point.y = await this.surfaceHeight(lat, lon);
        output.push(point);
      }
      carried = (carried + length) % 55;
    }
  }

  private buildingColor(value: number | string | boolean | undefined): THREE.Color {
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
    return new THREE.Color(0xc6c1b7);
  }

  private buildingIsExcluded(lat: number, lon: number): boolean {
    const lonScale = Math.cos((lat * Math.PI) / 180) * 111_320;
    return this.buildingExclusions.some((zone) => Math.hypot(
      (lat - zone.lat) * 111_320,
      (lon - zone.lon) * lonScale
    ) <= zone.radiusM);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points)) return;
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
