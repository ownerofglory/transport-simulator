import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PNG } from 'pngjs';
import { PbfReader } from 'pbf';

const inputPath = process.argv[2] ?? 'public/data/vvs-stadtbahn-routes.json';
const terrainZoom = 13;
const vectorZoom = 14;
const terrainUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const vectorMetadataUrl = 'https://tiles.openfreemap.org/planet';
const fetchRetries = 4;
const earthMPerDegLat = 111_320;
const terrainTiles = new Map();
const transitTiles = new Map();
const generatedMirrorPath = join('data/generated', basename(inputPath));

const feed = JSON.parse(readFileSync(inputPath, 'utf8'));
if (!Array.isArray(feed.routes)) {
  throw new Error(`Route feed ${inputPath} does not contain a routes array.`);
}
const vectorMetadata = await fetchJsonWithRetry(vectorMetadataUrl).then((response) => {
  if (!response.ok) throw new Error(`OpenFreeMap metadata request failed: ${response.status}`);
  return response.json();
});
const vectorTemplate = vectorMetadata.tiles?.[0];
if (!vectorTemplate) throw new Error('OpenFreeMap metadata did not include a tile template.');

for (const route of feed.routes) {
  const geoPoints = route.geoPoints.map(([lat, lon]) => ({ lat, lon }));
  const routeDistances = cumulativeDistances(geoPoints);
  const surfaceAbsolute = await Promise.all(geoPoints.map(sampleTerrain));
  const surfaceSmoothed = smoothProfile(surfaceAbsolute, 2);
  const transitFeaturesByTile = new Map();

  for (const point of geoPoints) {
    const tile = geoToTile(point, vectorZoom);
    // Load the 3x3 neighbourhood so features just outside a geoPoint's tile are found.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${tile.x + dx}/${tile.y + dy}`;
        if (!transitFeaturesByTile.has(key)) {
          transitFeaturesByTile.set(key, await loadTransitTile(tile.x + dx, tile.y + dy));
        }
      }
    }
  }

  // Include all guided rail and metro modes so tunnel/bridge detection and
  // depth profiling run for metro, tram, and regional rail routes too.
  const followsRails = ['stadtbahn', 's-bahn', 'metro', 'rail', 'tram'].includes(route.transportMode ?? '');
  const tunnelMask = geoPoints.map((point) => followsRails && nearestTransitKind(point, transitFeaturesByTile) === 'tunnel');
  const bridgeMask = geoPoints.map((point) => followsRails && nearestTransitKind(point, transitFeaturesByTile) === 'bridge');
  closeMaskGaps(tunnelMask, 3);
  removeShortRuns(tunnelMask, 2);
  removeShortDistanceRuns(tunnelMask, routeDistances, 100);
  closeMaskGaps(bridgeMask, 2);
  removeShortRuns(bridgeMask, 2);

  const tunnelDepths = depthProfile(tunnelMask, routeDistances, 10, 140);
  const trackAbsolute = surfaceSmoothed.map((height, index) => height - tunnelDepths[index]);
  flattenBridgeRanges(trackAbsolute, surfaceSmoothed, bridgeMask);
  const datum = trackAbsolute[0];

  route.elevationDatumM = round(datum);
  route.surfaceHeightsM = surfaceSmoothed.map((height) => round(height - datum));
  route.tunnelMask = tunnelMask;
  route.bridgeMask = bridgeMask;
  route.controlPoints = route.controlPoints.map((point, index) => [point[0], round(trackAbsolute[index] - datum), point[2]]);
  route.tunnelRanges = maskRanges(tunnelMask, routeDistances).map(([startM, endM]) => ({
    startM: round(startM),
    endM: round(endM)
  }));

  console.log(`${route.line} ${route.destination}: ${route.tunnelRanges.length} tunnel range(s), elevation ${Math.round(Math.min(...surfaceAbsolute))}-${Math.round(Math.max(...surfaceAbsolute))} m`);
}

feed.terrain = {
  source: 'AWS Open Data Mapzen Terrain Tiles',
  format: 'Terrarium',
  zoom: terrainZoom,
  generatedAt: new Date().toISOString()
};
writeFileSync(inputPath, `${JSON.stringify(feed)}\n`);
writeFileSync(generatedMirrorPath, `${JSON.stringify(feed, null, 2)}\n`);

async function sampleTerrain(point) {
  const tilePosition = geoToTileFloat(point, terrainZoom);
  const tileX = Math.floor(tilePosition.x);
  const tileY = Math.floor(tilePosition.y);
  const png = await loadTerrainTile(tileX, tileY);
  const pixelX = Math.max(0, Math.min(png.width - 1, Math.floor((tilePosition.x - tileX) * png.width)));
  const pixelY = Math.max(0, Math.min(png.height - 1, Math.floor((tilePosition.y - tileY) * png.height)));
  const offset = (pixelY * png.width + pixelX) * 4;
  return (png.data[offset] * 256 + png.data[offset + 1] + png.data[offset + 2] / 256) - 32768;
}

function loadTerrainTile(x, y) {
  const key = `${terrainZoom}/${x}/${y}`;
  if (!terrainTiles.has(key)) {
    const url = terrainUrl.replace('{z}', terrainZoom).replace('{x}', x).replace('{y}', y);
    terrainTiles.set(key, fetchWithRetry(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Terrain tile ${key} failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => PNG.sync.read(Buffer.from(buffer))));
  }
  return terrainTiles.get(key);
}

function loadTransitTile(x, y) {
  const key = `${vectorZoom}/${x}/${y}`;
  if (!transitTiles.has(key)) {
    const url = vectorTemplate.replace('{z}', vectorZoom).replace('{x}', x).replace('{y}', y);
    transitTiles.set(key, fetchWithRetry(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Vector tile ${key} failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const tile = new VectorTile(new PbfReader(new Uint8Array(buffer)));
        const layer = tile.layers.transportation;
        const features = [];
        if (!layer) return features;
        for (let index = 0; index < layer.length; index++) {
          const feature = layer.feature(index);
          const subclass = String(feature.properties.subclass ?? '');
          const brunnel = String(feature.properties.brunnel ?? '');
          if (!['light_rail', 'tram', 'subway', 'rail'].includes(subclass) || !['tunnel', 'bridge'].includes(brunnel)) continue;
          const geometry = feature.toGeoJSON(x, y, vectorZoom).geometry;
          const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
          for (const line of lines) features.push({ kind: brunnel, line });
        }
        return features;
      }));
  }
  return transitTiles.get(key);
}

function nearestTransitKind(point, tileMap) {
  const tile = geoToTile(point, vectorZoom);
  let nearest = { distance: Number.POSITIVE_INFINITY, kind: null };
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const features = tileMap.get(`${tile.x + dx}/${tile.y + dy}`) ?? [];
      for (const feature of features) {
        for (let i = 1; i < feature.line.length; i++) {
          const distance = pointSegmentDistance(point, feature.line[i - 1], feature.line[i]);
          if (distance < nearest.distance) nearest = { distance, kind: feature.kind };
        }
      }
    }
  }
  return nearest.distance <= 60 ? nearest.kind : null;
}

function pointSegmentDistance(point, a, b) {
  const lonScale = Math.cos((point.lat * Math.PI) / 180) * earthMPerDegLat;
  const ax = (a[0] - point.lon) * lonScale;
  const az = (a[1] - point.lat) * earthMPerDegLat;
  const bx = (b[0] - point.lon) * lonScale;
  const bz = (b[1] - point.lat) * earthMPerDegLat;
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, -(ax * vx + az * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(ax + vx * t, az + vz * t);
}

async function fetchJsonWithRetry(url) {
  return fetchWithRetry(url, { headers: { accept: 'application/json' } });
}

async function fetchWithRetry(url, init) {
  let lastError;
  for (let attempt = 0; attempt <= fetchRetries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt >= fetchRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

function smoothProfile(values, radius) {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1));
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function depthProfile(mask, distances, maximumDepth, rampM) {
  const result = new Array(mask.length).fill(0);
  for (const [start, end] of indexRanges(mask)) {
    for (let i = start; i <= end; i++) {
      const fromStart = distances[i] - distances[start];
      const fromEnd = distances[end] - distances[i];
      result[i] = maximumDepth * Math.min(1, Math.max(0, Math.min(fromStart, fromEnd) / rampM));
    }
  }
  return result;
}

function flattenBridgeRanges(track, surface, mask) {
  for (const [start, end] of indexRanges(mask)) {
    const before = Math.max(0, start - 1);
    const after = Math.min(track.length - 1, end + 1);
    for (let i = start; i <= end; i++) {
      const t = (i - before) / Math.max(1, after - before);
      track[i] = surface[before] + (surface[after] - surface[before]) * t + 1.5;
    }
  }
}

function closeMaskGaps(mask, maxGap) {
  for (let i = 0; i < mask.length;) {
    if (mask[i]) { i++; continue; }
    const start = i;
    while (i < mask.length && !mask[i]) i++;
    if (start > 0 && i < mask.length && i - start <= maxGap) mask.fill(true, start, i);
  }
}

function removeShortRuns(mask, minimumLength) {
  for (const [start, end] of indexRanges(mask)) {
    if (end - start + 1 < minimumLength) mask.fill(false, start, end + 1);
  }
}

function removeShortDistanceRuns(mask, distances, minimumDistanceM) {
  for (const [start, end] of indexRanges(mask)) {
    if (distances[end] - distances[start] < minimumDistanceM) mask.fill(false, start, end + 1);
  }
}

function indexRanges(mask) {
  const ranges = [];
  for (let i = 0; i < mask.length;) {
    if (!mask[i]) { i++; continue; }
    const start = i;
    while (i + 1 < mask.length && mask[i + 1]) i++;
    ranges.push([start, i]);
    i++;
  }
  return ranges;
}

function maskRanges(mask, distances) {
  return indexRanges(mask).map(([start, end]) => [distances[start], distances[end]]);
}

function cumulativeDistances(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const lonScale = Math.cos((points[i].lat * Math.PI) / 180) * earthMPerDegLat;
    const dx = (points[i].lon - points[i - 1].lon) * lonScale;
    const dz = (points[i].lat - points[i - 1].lat) * earthMPerDegLat;
    distances.push(distances[i - 1] + Math.hypot(dx, dz));
  }
  return distances;
}

function geoToTile(point, zoom) {
  const tile = geoToTileFloat(point, zoom);
  return { x: Math.floor(tile.x), y: Math.floor(tile.y) };
}

function geoToTileFloat(point, zoom) {
  const latRad = (point.lat * Math.PI) / 180;
  const n = 2 ** zoom;
  return {
    x: ((point.lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
