import * as THREE from 'three';

type GeoPoint = { lat: number; lon: number };
type GeoBounds = { north: number; south: number; west: number; east: number };

const TERRAIN_ZOOM = 13;
const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export class TerrainSampler {
  private readonly tiles = new Map<string, Promise<ImageData>>();

  constructor(private readonly datumM: number) {}

  async sample(lat: number, lon: number): Promise<number> {
    const tilePosition = geoToTileFloat({ lat, lon }, TERRAIN_ZOOM);
    const tileX = Math.floor(tilePosition.x);
    const tileY = Math.floor(tilePosition.y);
    const image = await this.loadTile(tileX, tileY);
    const pixelX = THREE.MathUtils.clamp(Math.floor((tilePosition.x - tileX) * image.width), 0, image.width - 1);
    const pixelY = THREE.MathUtils.clamp(Math.floor((tilePosition.y - tileY) * image.height), 0, image.height - 1);
    const offset = (pixelY * image.width + pixelX) * 4;
    const elevation = (image.data[offset] * 256 + image.data[offset + 1] + image.data[offset + 2] / 256) - 32768;
    return elevation - this.datumM;
  }

  async deformPlane(geometry: THREE.PlaneGeometry, bounds: GeoBounds): Promise<void> {
    const position = geometry.attributes.position;
    const samples: Promise<number>[] = [];
    for (let index = 0; index < position.count; index++) {
      const u = position.getX(index) / geometry.parameters.width + 0.5;
      const v = position.getY(index) / geometry.parameters.height + 0.5;
      const lon = THREE.MathUtils.lerp(bounds.east, bounds.west, u);
      const lat = THREE.MathUtils.lerp(bounds.south, bounds.north, v);
      samples.push(this.sample(lat, lon));
    }
    const elevations = await Promise.all(samples);
    elevations.forEach((elevation, index) => position.setZ(index, -elevation));
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  private loadTile(x: number, y: number): Promise<ImageData> {
    const key = `${TERRAIN_ZOOM}/${x}/${y}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      const url = TERRAIN_URL.replace('{z}', String(TERRAIN_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
      tile = fetch(url)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Terrain tile ${key} failed: ${response.status}`);
          return createImageBitmap(await response.blob());
        })
        .then((bitmap) => {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Could not create terrain decoding canvas.');
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return context.getImageData(0, 0, canvas.width, canvas.height);
        });
      this.tiles.set(key, tile);
    }
    return tile;
  }
}

function geoToTileFloat(point: GeoPoint, zoom: number): { x: number; y: number } {
  const latRad = (point.lat * Math.PI) / 180;
  const n = 2 ** zoom;
  return {
    x: ((point.lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  };
}
