import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const cityId = process.argv[2];
const zipPath = process.argv[3];
const outDir = process.argv[4];

if (!cityId || !zipPath || !outDir) {
  console.error('Usage: node tools/import-city-gtfs.mjs <cityId> <zipPath> <outDir>');
  process.exit(1);
}

const earthMPerDegLat = 111_320;
const defaultTextColor = '#ffffff';

const presets = {
  ulm: {
    generatedAt: new Date().toISOString(),
    sourceUrl: 'https://www.nvbw.de/fileadmin/user_upload/service/open_data/fahrplandaten_mit_liniennetz/ding.zip',
    license: 'Derived from the official DING GTFS feed for simulator use.',
    attribution: 'Contains DING/SWU route data derived from the official DING GTFS feed.',
    modes: [
      {
        mode: 'tram',
        file: 'routes-tram.json',
        speedLimitMps: 14.5,
        maxPoints: 220,
        defaultAgency: 'SWU',
        defaultColor: '#7ac143',
        matchRoute: (route) => route.route_type === '0' && ['1', '2', 'E'].includes(route.route_short_name || '')
      },
      {
        mode: 'bus',
        file: 'routes-bus.json',
        speedLimitMps: 12.5,
        maxPoints: 140,
        defaultAgency: 'SWU',
        defaultColor: '#1e6ad6',
        matchRoute: (route) => route.route_type === '3' && route.agency_id === 'din-66'
      }
    ]
  },
  odessa: {
    generatedAt: new Date().toISOString(),
    sourceUrl: 'https://gw.x24.digital/api/od-all/gtfs/v1/download/static',
    license: 'CC BY via official Odesa GTFS od-all feed.',
    attribution: 'Contains Odesa bus and trolleybus route data derived from the official Odessa od-all GTFS feed.',
    modes: [
      {
        mode: 'trolleybus',
        file: 'routes-trolleybus.json',
        speedLimitMps: 12.0,
        maxPoints: 180,
        defaultAgency: 'Odesmiskelektrotrans KP',
        defaultColor: '#1976d2',
        matchRoute: (route) => route.route_type === '11' || (route.route_type === '3' && /тр/i.test(route.route_short_name || ''))
      },
      {
        mode: 'bus',
        file: 'routes-bus.json',
        speedLimitMps: 12.5,
        maxPoints: 150,
        defaultAgency: 'Odesa bus',
        defaultColor: '#43a047',
        matchRoute: (route) => route.route_type === '3' && !/тр/i.test(route.route_short_name || '')
      }
    ]
  }
};

const preset = presets[cityId];
if (!preset) {
  console.error(`Unsupported city "${cityId}".`);
  process.exit(1);
}

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
  const [h, m, s] = String(value || '00:00:00').split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function distanceM(a, b) {
  const lonScale = Math.cos((a.lat * Math.PI) / 180) * earthMPerDegLat;
  const dx = (b.lon - a.lon) * lonScale;
  const dz = (b.lat - a.lat) * earthMPerDegLat;
  return Math.hypot(dx, dz);
}

function cumulativeDistances(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + distanceM(points[i - 1], points[i]));
  }
  return distances;
}

function projectToLocal(points) {
  const origin = points[0];
  return points.map((point) => {
    const lonScale = Math.cos((origin.lat * Math.PI) / 180) * earthMPerDegLat;
    return [
      -((point.lon - origin.lon) * lonScale),
      0,
      (point.lat - origin.lat) * earthMPerDegLat
    ];
  });
}

function nearestShapeDistance(stop, shape, cumulative) {
  let best = { score: Number.POSITIVE_INFINITY, distance: 0 };
  for (let i = 1; i < shape.length; i++) {
    const a = shape[i - 1];
    const b = shape[i];
    const lonScale = Math.cos((stop.lat * Math.PI) / 180) * earthMPerDegLat;
    const ax = a.lon * lonScale;
    const az = a.lat * earthMPerDegLat;
    const bx = b.lon * lonScale;
    const bz = b.lat * earthMPerDegLat;
    const px = stop.lon * lonScale;
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

function safeHex(value, fallback) {
  const hex = String(value || '').replace(/^#/, '').trim();
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : fallback;
}

const agencies = new Map();
await readZipCsv('agency.txt', (agency) => {
  agencies.set(agency.agency_id, agency.agency_name || agency.agency_id);
});

const routesByMode = new Map(preset.modes.map((mode) => [mode.mode, new Map()]));

await readZipCsv('routes.txt', (route) => {
  for (const modeConfig of preset.modes) {
    if (!modeConfig.matchRoute(route)) continue;
    routesByMode.get(modeConfig.mode).set(route.route_id, {
      routeId: route.route_id,
      routeShortName: route.route_short_name || route.route_long_name || route.route_id,
      routeLongName: route.route_long_name || route.route_short_name || route.route_id,
      routeColor: safeHex(route.route_color, modeConfig.defaultColor),
      routeTextColor: safeHex(route.route_text_color, defaultTextColor),
      transportMode: modeConfig.mode,
      speedLimitMps: modeConfig.speedLimitMps,
      maxPoints: modeConfig.maxPoints,
      agency: agencies.get(route.agency_id) ?? modeConfig.defaultAgency
    });
  }
});

const tripCandidates = [];
await readZipCsv('trips.txt', (trip) => {
  for (const [mode, routes] of routesByMode.entries()) {
    const route = routes.get(trip.route_id);
    if (!route) continue;
    tripCandidates.push({
      ...route,
      mode,
      tripId: trip.trip_id,
      shapeId: trip.shape_id,
      directionId: trip.direction_id || '0',
      destination: trip.trip_headsign || route.routeLongName,
      stopCount: 0
    });
  }
});

const tripCandidateMap = new Map(tripCandidates.map((trip) => [trip.tripId, trip]));
await readZipCsv('stop_times.txt', (stopTime) => {
  const trip = tripCandidateMap.get(stopTime.trip_id);
  if (trip) trip.stopCount++;
});

const bestTrips = new Map();
for (const trip of tripCandidates) {
  const key = `${trip.mode}:${trip.routeShortName}:${trip.directionId}:${trip.destination}`;
  const current = bestTrips.get(key);
  if (!current || trip.stopCount > current.stopCount) bestTrips.set(key, trip);
}

const selectedTrips = Array.from(bestTrips.values()).sort((a, b) =>
  a.mode.localeCompare(b.mode)
  || a.routeShortName.localeCompare(b.routeShortName, 'de', { numeric: true })
  || a.destination.localeCompare(b.destination, 'de')
);

const selectedTripIds = new Set(selectedTrips.map((trip) => trip.tripId));
const selectedShapeIds = new Set(selectedTrips.map((trip) => trip.shapeId));
const stopIds = new Set();
const tripStops = new Map(selectedTrips.map((trip) => [trip.tripId, []]));

await readZipCsv('stop_times.txt', (stopTime) => {
  if (!selectedTripIds.has(stopTime.trip_id)) return;
  stopIds.add(stopTime.stop_id);
  tripStops.get(stopTime.trip_id).push({
    stopId: stopTime.stop_id,
    sequence: Number(stopTime.stop_sequence),
    arrival: stopTime.arrival_time,
    departure: stopTime.departure_time
  });
});

const stops = new Map();
await readZipCsv('stops.txt', (stop) => {
  if (!stopIds.has(stop.stop_id)) return;
  stops.set(stop.stop_id, {
    name: stop.stop_name,
    lat: Number(stop.stop_lat),
    lon: Number(stop.stop_lon)
  });
});

const shapes = new Map(selectedTrips.map((trip) => [trip.shapeId, []]));
await readZipCsv('shapes.txt', (shapePoint) => {
  if (!selectedShapeIds.has(shapePoint.shape_id)) return;
  shapes.get(shapePoint.shape_id).push({
    lat: Number(shapePoint.shape_pt_lat),
    lon: Number(shapePoint.shape_pt_lon),
    sequence: Number(shapePoint.shape_pt_sequence)
  });
});

const routePackagesByMode = new Map(preset.modes.map((mode) => [mode.mode, []]));

for (const trip of selectedTrips) {
  const shape = (shapes.get(trip.shapeId) ?? []).sort((a, b) => a.sequence - b.sequence);
  const rawStops = (tripStops.get(trip.tripId) ?? []).sort((a, b) => a.sequence - b.sequence);
  if (shape.length < 2 || rawStops.length < 2) continue;

  const cumulative = cumulativeDistances(shape);
  const firstTime = secondsSinceMidnight(rawStops[0].departure || rawStops[0].arrival);
  const stations = rawStops
    .map((stopTime) => {
      const stop = stops.get(stopTime.stopId);
      if (!stop) return null;
      return {
        name: stop.name,
        distanceM: nearestShapeDistance(stop, shape, cumulative),
        scheduledS: secondsSinceMidnight(stopTime.arrival || stopTime.departure) - firstTime,
        lat: stop.lat,
        lon: stop.lon
      };
    })
    .filter(Boolean)
    .filter((station, index, array) => index === 0 || station.name !== array[index - 1].name);

  if (stations.length < 2) continue;

  const sampledShape = decimate(shape, trip.maxPoints);
  routePackagesByMode.get(trip.mode).push({
    id: trip.tripId,
    source: `Official ${cityId} GTFS feed ${new Date().toISOString().slice(0, 10)}`,
    routeId: trip.routeId,
    tripId: trip.tripId,
    shapeId: trip.shapeId,
    line: trip.routeShortName,
    transportMode: trip.mode,
    agency: trip.agency,
    destination: trip.destination,
    description: trip.routeLongName,
    freeRideLabel: `${trip.routeShortName} ride`,
    color: trip.routeColor,
    textColor: trip.routeTextColor,
    speedLimitMps: trip.speedLimitMps,
    routeLengthM: cumulative[cumulative.length - 1],
    stations,
    controlPoints: projectToLocal(sampledShape).map(([x, y, z]) => [round(x), round(y), round(z)]),
    geoPoints: sampledShape.map((point) => [point.lat, point.lon])
  });
}

mkdirSync(outDir, { recursive: true });
for (const modeConfig of preset.modes) {
  const routes = routePackagesByMode.get(modeConfig.mode) ?? [];
  const feed = {
    generatedAt: preset.generatedAt,
    sourceUrl: preset.sourceUrl,
    license: preset.license,
    attribution: preset.attribution,
    routes
  };
  const outPath = join(outDir, modeConfig.file);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(feed)}\n`);
  console.log(`${cityId}:${modeConfig.mode} -> ${routes.length} routes, ${new Set(routes.map((route) => route.line)).size} lines`);
}

const existingManifestPath = join(outDir, 'route-manifest.json');
const existingManifest = existsSync(existingManifestPath)
  ? JSON.parse(readFileSync(existingManifestPath, 'utf8'))
  : null;
const generatedModes = preset.modes.map((modeConfig) => {
  const routes = routePackagesByMode.get(modeConfig.mode) ?? [];
  return {
    mode: modeConfig.mode,
    file: `/data/${cityId}/${modeConfig.file}`,
    routeCount: routes.length,
    lines: Array.from(new Set(routes.map((route) => route.line))).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
  };
}).filter((mode) => mode.routeCount > 0);
const preservedModes = Array.isArray(existingManifest?.modes)
  ? existingManifest.modes.filter((mode) => !generatedModes.some((generated) => generated.mode === mode.mode))
  : [];

const manifest = {
  generatedAt: preset.generatedAt,
  sourceUrl: preset.sourceUrl,
  license: preset.license,
  attribution: preset.attribution,
  modes: [...preservedModes, ...generatedModes]
};

writeFileSync(join(outDir, 'route-manifest.json'), `${JSON.stringify(manifest)}\n`);

function round(value) {
  return Math.round(value * 1000) / 1000;
}
