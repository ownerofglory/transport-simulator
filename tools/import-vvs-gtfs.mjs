import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const zipPath = process.argv[2] ?? 'data/raw/vvs-gtfs.zip';
const outPath = process.argv[3] ?? 'public/data/vvs-stadtbahn-routes.json';
const requestedLimit = process.argv[4] ? Number(process.argv[4]) : Number.POSITIVE_INFINITY;
const maxRoutes = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : Number.POSITIVE_INFINITY;

const routeSelections = [
  { routeType: '402', line: /^U\d+$/, transportMode: 'stadtbahn', agency: 'SSB', speedLimitMps: 18 },
  { routeType: '3', line: /.+/, transportMode: 'bus', agency: 'VVS Bus', speedLimitMps: 13.9 },
  { routeType: '109', line: /^S(?:[1-6]|60|62)$/, transportMode: 's-bahn', agency: 'DB Regio', speedLimitMps: 38.9 },
  { routeType: '1400', line: /^10$/, transportMode: 'zacke', agency: 'SSB', speedLimitMps: 8.3 },
  { routeType: '1400', line: /^20$/, transportMode: 'seilbahn', agency: 'SSB', speedLimitMps: 2.4 }
];
const earthMPerDegLat = 111_320;
const stuttgartLat = 48.7758;
const earthMPerDegLon = Math.cos((stuttgartLat * Math.PI) / 180) * earthMPerDegLat;

function parseCsvLine(line) {
  if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function row(headers, values) {
  const item = {};
  for (let i = 0; i < headers.length; i++) item[headers[i]] = values[i] ?? '';
  return item;
}

async function readZipCsv(fileName, onRow) {
  const unzip = spawn('unzip', ['-p', zipPath, fileName], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  let headers = null;
  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    if (!line) continue;
    onRow(row(headers, parseCsvLine(line)));
  }
  const code = await new Promise((resolve) => unzip.on('close', resolve));
  if (code !== 0) throw new Error(`unzip ${fileName} failed with code ${code}`);
}

function secondsSinceMidnight(value) {
  const [h, m, s] = value.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function distanceM(a, b) {
  const dx = (b.lon - a.lon) * earthMPerDegLon;
  const dz = (b.lat - a.lat) * earthMPerDegLat;
  return Math.hypot(dx, dz);
}

function projectToLocal(points) {
  const origin = points[0];
  return points.map((p) => [
    -(p.lon - origin.lon) * earthMPerDegLon,
    0,
    (p.lat - origin.lat) * earthMPerDegLat
  ]);
}

function cumulativeDistances(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + distanceM(points[i - 1], points[i]));
  }
  return distances;
}

function nearestShapeDistance(stop, shape, cumulative) {
  let best = { score: Number.POSITIVE_INFINITY, distance: 0 };
  for (let i = 1; i < shape.length; i++) {
    const a = shape[i - 1];
    const b = shape[i];
    const ax = a.lon * earthMPerDegLon;
    const az = a.lat * earthMPerDegLat;
    const bx = b.lon * earthMPerDegLon;
    const bz = b.lat * earthMPerDegLat;
    const px = stop.lon * earthMPerDegLon;
    const pz = stop.lat * earthMPerDegLat;
    const vx = bx - ax;
    const vz = bz - az;
    const wx = px - ax;
    const wz = pz - az;
    const len2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2));
    const cx = ax + vx * t;
    const cz = az + vz * t;
    const score = Math.hypot(px - cx, pz - cz);
    if (score < best.score) {
      best = { score, distance: cumulative[i - 1] + Math.hypot(vx, vz) * t };
    }
  }
  return best.distance;
}

function decimate(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const result = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) result.push(points[Math.round(i * step)]);
  return result;
}

console.log(`Reading ${zipPath}`);

const routes = new Map();
await readZipCsv('routes.txt', (r) => {
  const selection = routeSelections.find((candidate) =>
    candidate.routeType === r.route_type && candidate.line.test(r.route_short_name)
  );
  if (!selection) return;
  routes.set(r.route_id, {
    routeId: r.route_id,
    line: r.route_short_name,
    description: r.route_long_name,
    color: `#${r.route_color || 'ffd900'}`,
    textColor: `#${r.route_text_color || '000000'}`,
    transportMode: selection.transportMode,
    agency: selection.agency,
    speedLimitMps: selection.speedLimitMps
  });
});

const tripCandidates = new Map();
await readZipCsv('trips.txt', (t) => {
  const route = routes.get(t.route_id);
  if (!route) return;
  tripCandidates.set(t.trip_id, {
    ...route,
    tripId: t.trip_id,
    shapeId: t.shape_id,
    destination: t.trip_headsign,
    directionId: t.direction_id || '0',
    stopCount: 0
  });
});

await readZipCsv('stop_times.txt', (st) => {
  const trip = tripCandidates.get(st.trip_id);
  if (trip) trip.stopCount++;
});

const bestTrips = new Map();
for (const trip of tripCandidates.values()) {
  const key = `${trip.routeId}:${trip.directionId}`;
  const current = bestTrips.get(key);
  if (!current || trip.stopCount > current.stopCount) bestTrips.set(key, trip);
}

const sortedTrips = Array.from(bestTrips.values())
  .sort((a, b) => a.line.localeCompare(b.line, 'de', { numeric: true }) || a.directionId.localeCompare(b.directionId));
const selectedTrips = Number.isFinite(maxRoutes) ? sortedTrips.slice(0, maxRoutes) : sortedTrips;

const selectedTripIds = new Set(selectedTrips.map((t) => t.tripId));
const selectedShapeIds = new Set(selectedTrips.map((t) => t.shapeId));
const stopIds = new Set();
const tripStops = new Map(selectedTrips.map((t) => [t.tripId, []]));

await readZipCsv('stop_times.txt', (st) => {
  if (!selectedTripIds.has(st.trip_id)) return;
  stopIds.add(st.stop_id);
  tripStops.get(st.trip_id).push({
    stopId: st.stop_id,
    sequence: Number(st.stop_sequence),
    arrival: st.arrival_time,
    departure: st.departure_time
  });
});

const stops = new Map();
await readZipCsv('stops.txt', (s) => {
  if (!stopIds.has(s.stop_id)) return;
  stops.set(s.stop_id, {
    name: s.stop_name,
    lat: Number(s.stop_lat),
    lon: Number(s.stop_lon)
  });
});

const shapes = new Map(selectedTrips.map((t) => [t.shapeId, []]));
await readZipCsv('shapes.txt', (s) => {
  if (!selectedShapeIds.has(s.shape_id)) return;
  shapes.get(s.shape_id).push({
    lat: Number(s.shape_pt_lat),
    lon: Number(s.shape_pt_lon),
    sequence: Number(s.shape_pt_sequence)
  });
});

const packages = [];
for (const trip of selectedTrips) {
  const shape = (shapes.get(trip.shapeId) ?? []).sort((a, b) => a.sequence - b.sequence);
  const rawStops = (tripStops.get(trip.tripId) ?? []).sort((a, b) => a.sequence - b.sequence);
  if (shape.length < 2 || rawStops.length < 2) continue;

  const cumulative = cumulativeDistances(shape);
  const firstTime = secondsSinceMidnight(rawStops[0].departure || rawStops[0].arrival);
  const stationList = rawStops
    .map((st) => {
      const stop = stops.get(st.stopId);
      if (!stop) return null;
      return {
        name: stop.name,
        distanceM: nearestShapeDistance(stop, shape, cumulative),
        scheduledS: secondsSinceMidnight(st.arrival || st.departure) - firstTime,
        lat: stop.lat,
        lon: stop.lon
      };
    })
    .filter(Boolean)
    .filter((station, index, arr) => index === 0 || station.name !== arr[index - 1].name);

  const sampledShape = decimate(
    shape,
    trip.transportMode === 'bus' ? 120 : trip.transportMode === 's-bahn' ? 260 : 220
  );
  const controlPoints = projectToLocal(sampledShape);
  const geoPoints = sampledShape.map((p) => [p.lat, p.lon]);
  const routeLengthM = cumulative[cumulative.length - 1];
  packages.push({
    id: `${trip.line.toLowerCase()}-${trip.directionId}-${trip.tripId.replace(/[^a-z0-9]+/gi, '-').slice(-16)}`,
    source: 'VVS GTFS 20260618',
    routeId: trip.routeId,
    tripId: trip.tripId,
    shapeId: trip.shapeId,
    line: trip.line,
    transportMode: trip.transportMode,
    agency: trip.agency,
    destination: trip.destination,
    description: trip.description,
    freeRideLabel: `${trip.line} GTFS ride`,
    color: trip.color,
    textColor: trip.textColor,
    speedLimitMps: trip.speedLimitMps,
    routeLengthM,
    stations: stationList,
    controlPoints,
    geoPoints
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceUrl: 'https://download.vvs.de/gtfs_realtime.zip',
  license: 'CC BY 4.0',
  attribution: 'Contains VVS schedule data from MobiData BW / opendata-oepnv.de, licensed CC BY 4.0.',
  routes: packages
};

const outDir = dirname(outPath);
mkdirSync(outDir, { recursive: true });
mkdirSync('data/generated', { recursive: true });
writeFileSync(outPath, `${JSON.stringify(output)}\n`);
writeFileSync('data/generated/vvs-stadtbahn-routes.json', `${JSON.stringify(output, null, 2)}\n`);

const modes = ['stadtbahn', 'bus', 's-bahn', 'zacke', 'seilbahn'];
const manifest = {
  generatedAt: output.generatedAt,
  sourceUrl: output.sourceUrl,
  license: output.license,
  attribution: output.attribution,
  modes: []
};

for (const mode of modes) {
  const modeRoutes = packages.filter((route) => route.transportMode === mode);
  if (modeRoutes.length === 0) continue;
  const modeFeed = {
    generatedAt: output.generatedAt,
    sourceUrl: output.sourceUrl,
    license: output.license,
    attribution: output.attribution,
    routes: modeRoutes
  };
  const fileName = `routes-${mode}.json`;
  writeFileSync(join(outDir, fileName), `${JSON.stringify(modeFeed)}\n`);
  writeFileSync(join('data/generated', fileName), `${JSON.stringify(modeFeed, null, 2)}\n`);
  manifest.modes.push({
    mode,
    file: `/data/${fileName}`,
    routeCount: modeRoutes.length,
    lines: [...new Set(modeRoutes.map((route) => route.line))].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
  });
}

writeFileSync(join(outDir, 'route-manifest.json'), `${JSON.stringify(manifest)}\n`);
writeFileSync(join('data/generated', 'route-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${packages.length} route packages to ${outPath} and ${manifest.modes.length} mode feeds.`);
