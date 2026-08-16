#!/usr/bin/env node
// Post-processes an enriched route feed so underground stations are actually
// underground.
//
// `enrich-route-terrain.mjs` lowers the alignment inside a tunnel run with a
// ramp measured from both ends of the run: depth = maxDepth * min(fromStart,
// fromEnd) / rampM. That forces depth to 0 at both ends of every run, so a stop
// sitting on or near a boundary is left at terrain height — the station box and
// the bore around it are then built standing on the grass. Sillenbuch is the
// clearest case: on the routes that mark it underground, its control point IS
// the last point of the run, so the tunnel dives 10 m and surfaces exactly at
// the platform.
//
// The profile is also sampled per control point, and GTFS shape points are
// sparse out in the suburbs — a run whose only points are its own two ends can
// never dip at all.
//
// What this does, per underground stop:
//
//   1. Inserts the control points the profile needs (hold boundary and ramp
//      end) rather than stretching a run onto whatever point happens to exist.
//      Everything index-parallel — geoPoints, surface heights, both masks — is
//      spliced with it.
//   2. Holds the alignment level for LEVEL_HOLD_M either side of the stop, so
//      the straight station box built around it meets the bore at both ends,
//      then ramps back to the surface.
//   3. Never lets a run reach a stop that is not itself underground: the hold
//      and ramp are squeezed into the room available, so no surface stop is
//      buried by a neighbour's tunnel.
//
// A stop counts as underground when the feed already places it in a run on
// every route that serves it, or when at least AGREEMENT routes agree. Mask
// boundaries come from per-tile OSM matching and wobble by a control point,
// which is why the same stop is in the tunnel in one direction and on the
// surface in the other. The threshold keeps stops like Gerlingen (underground
// on 1 of 2 routes — a surface terminus by a portal) from being buried.
//
// Bridges are left alone: a point carried above terrain is never re-profiled.
//
// Usage:
//   node tools/fix-tunnel-station-depth.mjs [public/data/routes-stadtbahn.json] [--dry-run]
//
// Run it after enrich-route-terrain.mjs, which rewrites controlPoints from the
// tiles and would undo this.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const inputPath = process.argv[2] ?? 'public/data/routes-stadtbahn.json';
const dryRun = process.argv.includes('--dry-run');

const MAX_DEPTH_M = 10; // matches enrich-route-terrain
const RAMP_M = 140;
// The alignment must stay level either side of an underground stop, not just
// at it: the station box is a straight room built around the stop and the bore
// is cut to meet its ends. Covers the longest box the station kit builds (an
// island one: platform/2 + track taper + margin).
const LEVEL_HOLD_M = 100;
// Routes that must agree before a stop is treated as underground network-wide.
const AGREEMENT = 2;
// Clearance kept between a tunnel run and the nearest surface stop.
const SURFACE_STOP_CLEARANCE_M = 40;
// Don't insert a point when one already sits this close.
const POINT_EPSILON_M = 12;

const feed = JSON.parse(readFileSync(inputPath, 'utf8'));
if (!Array.isArray(feed.routes)) throw new Error(`${inputPath} has no routes array`);

const undergroundStops = agreedUndergroundStops(feed.routes);
console.log(`[tunnel-depth] ${undergroundStops.size} stops treated as underground network-wide`);

let changedRoutes = 0;
let insertedPoints = 0;
const fixed = new Map();

for (const route of feed.routes) {
  if (!route.tunnelMask?.length || !route.surfaceHeightsM?.length || !route.controlPoints?.length) continue;
  if (route.tunnelMask.length !== route.controlPoints.length) continue;
  if (route.surfaceHeightsM.length !== route.controlPoints.length) continue;

  const stops = route.stations ?? [];
  const deep = stops.filter((stop) => undergroundStops.has(stop.name));
  const surfaceStops = stops.filter((stop) => !undergroundStops.has(stop.name));
  if (deep.length === 0) continue;

  const before = new Set(
    deep.filter((stop) => inRanges(route.tunnelRanges ?? [], stop.distanceM)).map((stop) => stop.name)
  );

  // Room each stop has before it would reach a surface stop, so a tunnel never
  // swallows a station that belongs above ground.
  const zones = deep.map((stop) => {
    const room = Math.max(
      POINT_EPSILON_M,
      nearestSurfaceStopGapM(stop.distanceM, surfaceStops) - SURFACE_STOP_CLEARANCE_M
    );
    const holdM = Math.min(LEVEL_HOLD_M, room * 0.45);
    return { stop, holdM, reachM: Math.min(holdM + RAMP_M, room) };
  });

  for (const zone of zones) {
    // 0 included: without a point at the platform itself the profile has
    // nothing to pin full depth to, and the stop can sit on an interpolated slope.
    for (const offset of [-zone.reachM, -zone.holdM, 0, zone.holdM, zone.reachM]) {
      insertedPoints += ensureControlPoint(route, zone.stop.distanceM + offset) ? 1 : 0;
    }
  }

  const distances = controlPointDistances(route.controlPoints, route.routeLengthM);
  const mask = route.tunnelMask.slice();
  for (const zone of zones) {
    for (let i = 0; i < distances.length; i++) {
      if (Math.abs(distances[i] - zone.stop.distanceM) <= zone.reachM) mask[i] = true;
    }
  }
  // A run must never cover a stop that stays on the surface.
  for (const stop of surfaceStops) {
    for (let i = 0; i < distances.length; i++) {
      if (Math.abs(distances[i] - stop.distanceM) < POINT_EPSILON_M) mask[i] = false;
    }
  }

  const depths = depthProfile(indexRanges(mask), distances, zones);
  for (let i = 0; i < route.controlPoints.length; i++) {
    // A bridge deck sits above terrain; re-profiling it would drop it into the
    // valley it crosses. Inside a tunnel run the tunnel wins: a point flagged
    // both ways (the Weinsteige ramp) cannot be a viaduct and a bore at once.
    if (!mask[i] && route.controlPoints[i][1] > route.surfaceHeightsM[i] + 0.01) continue;
    route.controlPoints[i][1] = round(route.surfaceHeightsM[i] - depths[i]);
  }

  route.tunnelMask = mask;
  route.tunnelRanges = maskRanges(mask, distances, route.routeLengthM);
  changedRoutes += 1;

  for (const stop of deep) {
    if (before.has(stop.name)) continue;
    fixed.set(stop.name, (fixed.get(stop.name) ?? 0) + 1);
  }
}

console.log(`[tunnel-depth] rewrote ${changedRoutes}/${feed.routes.length} routes, inserted ${insertedPoints} control points`);
for (const [name, count] of [...fixed].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}: newly underground on ${count} route(s)`);
}

if (dryRun) {
  console.log('[tunnel-depth] dry run, nothing written');
} else {
  writeFileSync(inputPath, `${JSON.stringify(feed)}\n`);
  const mirror = join('data/generated', relative('public/data', inputPath));
  if (existsSync(mirror)) writeFileSync(mirror, `${JSON.stringify(feed, null, 2)}\n`);
  console.log(`[tunnel-depth] wrote ${inputPath}`);
}

/**
 * Stops the network places underground: unanimous across the routes serving
 * them, or agreed by at least AGREEMENT routes.
 */
function agreedUndergroundStops(routes) {
  const inside = new Map();
  const served = new Map();
  for (const route of routes) {
    for (const stop of route.stations ?? []) {
      served.set(stop.name, (served.get(stop.name) ?? 0) + 1);
      if (inRanges(route.tunnelRanges ?? [], stop.distanceM)) {
        inside.set(stop.name, (inside.get(stop.name) ?? 0) + 1);
      }
    }
  }
  const result = new Set();
  for (const [name, count] of inside) {
    if (count >= AGREEMENT || count === served.get(name)) result.add(name);
  }
  return result;
}

/** Distance to the nearest stop that stays on the surface. */
function nearestSurfaceStopGapM(distanceM, surfaceStops) {
  let gap = Infinity;
  for (const stop of surfaceStops) gap = Math.min(gap, Math.abs(stop.distanceM - distanceM));
  return gap;
}

/**
 * Splices a control point in at a route distance, keeping every index-parallel
 * array aligned. Returns false when a point is already close enough.
 */
function ensureControlPoint(route, distanceM) {
  const points = route.controlPoints;
  const distances = controlPointDistances(points, route.routeLengthM);
  if (distanceM <= distances[0] || distanceM >= distances[distances.length - 1]) return false;

  let index = 1;
  while (index < distances.length && distances[index] < distanceM) index += 1;
  if (Math.abs(distances[index] - distanceM) < POINT_EPSILON_M) return false;
  if (Math.abs(distances[index - 1] - distanceM) < POINT_EPSILON_M) return false;

  const span = distances[index] - distances[index - 1];
  const fraction = span > 0 ? (distanceM - distances[index - 1]) / span : 0.5;
  const lerp = (a, b) => a + (b - a) * fraction;

  const [ax, ay, az] = points[index - 1];
  const [bx, by, bz] = points[index];
  points.splice(index, 0, [round(lerp(ax, bx)), round(lerp(ay, by)), round(lerp(az, bz))]);
  route.surfaceHeightsM.splice(index, 0, round(lerp(route.surfaceHeightsM[index - 1], route.surfaceHeightsM[index])));
  route.tunnelMask.splice(index, 0, route.tunnelMask[index - 1] && route.tunnelMask[index]);
  if (route.bridgeMask) route.bridgeMask.splice(index, 0, route.bridgeMask[index - 1] && route.bridgeMask[index]);
  if (route.geoPoints) {
    const [alat, alon] = route.geoPoints[index - 1];
    const [blat, blon] = route.geoPoints[index];
    route.geoPoints.splice(index, 0, [lerp(alat, blat), lerp(alon, blon)]);
  }
  return true;
}

/** Cumulative distance per control point, scaled onto the route's own length. */
function controlPointDistances(points, routeLengthM) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay, az] = points[i - 1];
    const [bx, by, bz] = points[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(bx - ax, by - ay, bz - az));
  }
  const total = cumulative[cumulative.length - 1] || 1;
  const scale = (routeLengthM ?? total) / total;
  return cumulative.map((distance) => distance * scale);
}

/**
 * Depth per control point: ramp in from each run end, then hold full depth
 * across every underground stop's level zone. Short runs use a shorter ramp so
 * they still reach depth in the middle instead of staying at grade.
 */
function depthProfile(runs, distances, zones) {
  const depths = new Array(distances.length).fill(0);
  const lastIndex = distances.length - 1;
  for (const [start, end] of runs) {
    const runLengthM = distances[end] - distances[start];
    const rampM = Math.max(1, Math.min(RAMP_M, runLengthM / 2));
    // A run that stops because the ROUTE stops is not a portal: the tunnel
    // carries on past the end of the modelled alignment, so the ramp to the
    // surface belongs only at a real boundary. Schwabstraße is the case that
    // matters — several routes terminate there, inside the Stammstrecke.
    const rampAtStart = start > 0;
    const rampAtEnd = end < lastIndex;
    for (let i = start; i <= end; i++) {
      const fromStart = rampAtStart ? distances[i] - distances[start] : Infinity;
      const fromEnd = rampAtEnd ? distances[end] - distances[i] : Infinity;
      const reach = Math.min(fromStart, fromEnd);
      depths[i] = MAX_DEPTH_M * (Number.isFinite(reach) ? clamp(reach / rampM, 0, 1) : 1);
    }
    for (const zone of zones) {
      if (zone.stop.distanceM < distances[start] || zone.stop.distanceM > distances[end]) continue;
      for (let i = start; i <= end; i++) {
        if (Math.abs(distances[i] - zone.stop.distanceM) <= zone.holdM) depths[i] = MAX_DEPTH_M;
      }
    }
  }
  return depths;
}

function inRanges(ranges, distanceM) {
  return ranges.some((range) => distanceM >= range.startM && distanceM <= range.endM);
}

function indexRanges(mask) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    if (mask[i] && start < 0) start = i;
    if (!mask[i] && start >= 0) {
      ranges.push([start, i - 1]);
      start = -1;
    }
  }
  return ranges;
}

/**
 * Ranges in route distance. Bounds are widened rather than rounded to nearest:
 * a stop sitting exactly on a range end — a terminus inside the tunnel, like
 * Schwabstraße — must test as inside it, and `stationIsUnderground` compares
 * inclusively against these numbers.
 */
function maskRanges(mask, distances, routeLengthM) {
  const lastIndex = distances.length - 1;
  return indexRanges(mask).map(([start, end]) => ({
    startM: start === 0 ? 0 : floor(distances[start]),
    endM: end === lastIndex ? Math.max(ceil(distances[end]), routeLengthM ?? 0) : ceil(distances[end])
  }));
}

function floor(value) {
  return Math.floor(value * 100) / 100;
}

function ceil(value) {
  return Math.ceil(value * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
