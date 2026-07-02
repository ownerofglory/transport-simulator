import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';

const inputPath = process.argv[2];
const outDir = process.argv[3];

if (!inputPath || !outDir) {
  console.error('Usage: node tools/import-wuppertal-schwebebahn.mjs <stations-geojson> <outDir>');
  process.exit(1);
}

const orderedStationNames = [
  'Vohwinkel Schwebebahn',
  'Bruch',
  'Hammerstein',
  'Sonnborner Straße',
  'Zoo/Stadion',
  'Varresbecker Straße',
  'Westende',
  'Pestalozzistraße',
  'Robert-Daum-Platz',
  'Ohligsmühle',
  'Hauptbahnhof',
  'Kluse/Schauspielhaus',
  'Landgericht',
  'Völklinger Straße',
  'Loher Brücke',
  'Adlerbrücke',
  'Alter Markt',
  'Werther Brücke',
  'Wupperfeld',
  'Oberbarmen Bf'
];

const stationIndex = new Map();
for (const [index, name] of orderedStationNames.entries()) stationIndex.set(name, index);

const geojson = JSON.parse(readFileSync(inputPath, 'utf8'));
const features = Array.isArray(geojson.features) ? geojson.features : [];
const stationPoints = features
  .map((feature) => {
    const name = String(feature?.properties?.NAME ?? '').trim();
    const coordinates = feature?.geometry?.coordinates;
    if (!name || !Array.isArray(coordinates) || coordinates.length < 2) return null;
    const [lon, lat] = coordinates;
    return { name, lat: Number(lat), lon: Number(lon), order: stationIndex.get(name) ?? Number.POSITIVE_INFINITY };
  })
  .filter(Boolean)
  .sort((a, b) => a.order - b.order);

if (stationPoints.length !== orderedStationNames.length) {
  throw new Error(`Expected ${orderedStationNames.length} Schwebebahn stations, got ${stationPoints.length}.`);
}

const origin = stationPoints[0];
const lonScale = Math.cos((origin.lat * Math.PI) / 180) * 111_320;
const vectors = stationPoints.map((point) => new THREE.Vector3(
  -((point.lon - origin.lon) * lonScale),
  0,
  (point.lat - origin.lat) * 111_320
));
const localCurve = new THREE.CatmullRomCurve3(vectors, false, 'centripetal', 0.32);
const sampledVectors = localCurve.getSpacedPoints(260);
const geoPoints = sampledVectors.map((vector) => [
  round(origin.lat + vector.z / 111_320, 10),
  round(origin.lon - vector.x / lonScale, 10)
]);
const routeDistances = cumulativeDistances(sampledVectors);
const routeLengthM = routeDistances.at(-1) ?? 0;

const forwardStations = stationPoints.map((station) => {
  const nearest = nearestCurveDistance(station, geoPoints, routeDistances);
  return {
    name: station.name,
    distanceM: round(nearest.distanceM, 3),
    scheduledS: 0,
    lat: station.lat,
    lon: station.lon
  };
});
assignSchedule(forwardStations);

const reverseSampled = [...sampledVectors].reverse();
const reverseGeoPoints = [...geoPoints].reverse();
const reverseDistances = cumulativeDistances(reverseSampled);
const reverseStations = [...stationPoints].reverse().map((station) => {
  const nearest = nearestCurveDistance(station, reverseGeoPoints, reverseDistances);
  return {
    name: station.name,
    distanceM: round(nearest.distanceM, 3),
    scheduledS: 0,
    lat: station.lat,
    lon: station.lon
  };
});
assignSchedule(reverseStations);

const routes = [
  buildRoute({
    id: 'wuppertal-schwebebahn-60-eastbound',
    destination: 'Oberbarmen Bf',
    description: 'W-Vohwinkel Schwebebahn - W-Oberbarmen Bf',
    stations: forwardStations,
    controlPoints: sampledVectors,
    geoPoints
  }),
  buildRoute({
    id: 'wuppertal-schwebebahn-60-westbound',
    destination: 'Vohwinkel Schwebebahn',
    description: 'W-Oberbarmen Bf - W-Vohwinkel Schwebebahn',
    stations: reverseStations,
    controlPoints: reverseSampled,
    geoPoints: reverseGeoPoints
  })
];

const feed = {
  generatedAt: new Date().toISOString(),
  sourceUrl: 'https://daten.wuppertal.de/Transport_Verkehr/Schwebebahnhoefe_EPSG4326_JSON.json',
  license: 'CC BY 4.0',
  attribution: 'Contains official Wuppertal Schwebebahn station data under CC BY 4.0.',
  routes
};

const manifest = {
  generatedAt: feed.generatedAt,
  sourceUrl: feed.sourceUrl,
  license: feed.license,
  attribution: feed.attribution,
  modes: [
    {
      mode: 'schwebebahn',
      file: '/data/wuppertal/routes-schwebebahn.json',
      routeCount: routes.length,
      lines: ['60']
    }
  ]
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'routes-schwebebahn.json'), `${JSON.stringify(feed)}\n`);
writeFileSync(join(outDir, 'route-manifest.json'), `${JSON.stringify(manifest)}\n`);
mkdirSync(dirname(join('data/generated', 'routes-schwebebahn.json')), { recursive: true });
writeFileSync(join('data/generated', 'routes-schwebebahn.json'), `${JSON.stringify(feed, null, 2)}\n`);

function buildRoute({ id, destination, description, stations, controlPoints, geoPoints }) {
  return {
    id,
    source: `Official Wuppertal station GeoJSON ${new Date().toISOString().slice(0, 10)}`,
    routeId: '60',
    tripId: id,
    shapeId: id,
    line: '60',
    transportMode: 'schwebebahn',
    agency: 'WSW mobil GmbH',
    destination,
    description,
    freeRideLabel: 'Schwebebahn ride',
    color: '#61c7d9',
    textColor: '#ffffff',
    speedLimitMps: 16.7,
    routeLengthM: round(routeLengthM, 3),
    stations,
    controlPoints: controlPoints.map((vector) => [round(vector.x, 3), 0, round(vector.z, 3)]),
    geoPoints
  };
}

function assignSchedule(stations) {
  stations[0].scheduledS = 0;
  for (let index = 1; index < stations.length; index++) {
    const segmentDistance = Math.max(1, stations[index].distanceM - stations[index - 1].distanceM);
    // Approximate commercial speed of the Schwebebahn including approach/brake time.
    const segmentTravelS = Math.round(segmentDistance / 11.2 + 14);
    stations[index].scheduledS = stations[index - 1].scheduledS + segmentTravelS;
  }
}

function nearestCurveDistance(station, geoPoints, distances) {
  const lonScale = Math.cos((station.lat * Math.PI) / 180) * 111_320;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestRouteDistance = 0;
  for (let index = 1; index < geoPoints.length; index++) {
    const [aLat, aLon] = geoPoints[index - 1];
    const [bLat, bLon] = geoPoints[index];
    const ax = (aLon - station.lon) * lonScale;
    const az = (aLat - station.lat) * 111_320;
    const bx = (bLon - station.lon) * lonScale;
    const bz = (bLat - station.lat) * 111_320;
    const vx = bx - ax;
    const vz = bz - az;
    const fraction = THREE.MathUtils.clamp(-(ax * vx + az * vz) / (vx * vx + vz * vz || 1), 0, 1);
    const distance = Math.hypot(ax + vx * fraction, az + vz * fraction);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRouteDistance = THREE.MathUtils.lerp(distances[index - 1] ?? 0, distances[index] ?? 0, fraction);
    }
  }
  return { distanceM: bestRouteDistance };
}

function cumulativeDistances(points) {
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    distances.push(distances[index - 1] + points[index].distanceTo(points[index - 1]));
  }
  return distances;
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
