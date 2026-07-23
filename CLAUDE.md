# AGENTS.md

Standing brief for AI coding agents. Keep changes small, local, testable, and reviewable.

## Project

Stuttgart Transit Simulator is a free, non-commercial, multi-city browser prototype for public transport simulation.

Current stack:

- React + TypeScript
- Three.js + Leaflet
- Vite
- Go/WASM deterministic simulator
- Go HTTP backend
- DuckDB GTFS schedule index
- GTFS-derived JSON/GeoJSON route data
- TRIAS journey and realtime data
- Server-Sent Events for live vehicle updates
- OpenFreeMap/OpenMapTiles/OSM scenery
- Mapzen Terrarium terrain

The application is multi-city. Do not introduce Stuttgart-only assumptions into shared systems.

No Rust. No payment or commercial features unless explicitly requested.

## Core rules

- Preserve existing behavior unless the task explicitly changes it.
- Prefer the smallest safe change over broad rewrites.
- Do not refactor unrelated code.
- Keep commits and pull requests focused.
- Do not load every city, mode, route, vehicle, or scenery asset at startup.
- Do not edit `dist/` manually.
- Do not manually edit generated API clients, GTFS artifacts, route feeds, or DuckDB files.
- Keep required attribution visible.
- Do not commit credentials, TRIAS tokens, or local environment files.

## Architecture boundaries

### React application

React owns:

- application navigation and UI state
- city, route, mode, station, season, time, and camera selection
- dialogs, panels, HUD, and URL state
- runtime mounting and desired-state reconciliation

Do not store held throttle, brake, look, pointer, or other per-frame input in React state.

### Three.js engine

The browser engine owns:

- scene, renderer, camera, and frame loop
- transient input state
- world sessions and workspaces
- vehicle, camera, environment, lighting, and presentation systems
- terrain, scenery, GLB loading, textures, and browser APIs
- smooth visual interpolation of live vehicles

Imperative Three.js code is expected, but it must have clear ownership and disposal.

Prefer existing systems, layers, camera rigs, registries, resource scopes, and workspace abstractions instead of adding logic back into large coordinator classes.

### Go/WASM simulator

Go/WASM owns deterministic simulation state:

- speed and braking
- route distance
- station stops
- dwell and doors
- scoring and timetable state

Do not move rendering, DOM, Leaflet, HTTP, SSE, GLB loading, tile fetching, or textures into Go/WASM.

### Go backend (not a part of this porject)

The backend follows domain/application/adapter boundaries.

It owns:

- TRIAS access
- GTFS schedule queries
- DuckDB repositories
- journey, location, departure, and live-traffic use cases
- prepared live-vehicle snapshots
- SSE publication and replay
- request budgets, caching, metrics, and readiness

DuckDB schedule artifacts are generated offline and opened read-only at runtime.

Browser requests must not trigger one TRIAS request per user. Reuse cached or prepared results and respect the shared request budget.

## Live traffic

- `runId` is the stable identity of a live vehicle.
- Backend schedule estimates are the positional source of truth.
- Frontend motion is presentation smoothing, not a second independent timetable estimator.
- Prefer along-shape distance and stable route matching over repeated nearest-line guessing.
- Never move a followed vehicle backward for a small correction; slow down or pause instead.
- Reject stale or out-of-order samples.
- Full snapshots may remove missing runs; single-vehicle updates must not affect unrelated runs.
- Keep the followed camera locked to the requested `runId`.
- Temporary missing or invalid positions should freeze the camera rather than select another vehicle.
- SSE, polling, and per-run requests must not race to overwrite newer vehicle samples.

## Rendering and performance

- Keep per-frame paths fast and allocation-light.
- Do not create geometry, materials, textures, vectors, or raycasters repeatedly per frame without a measured reason.
- Use instancing or pooling for repeated objects.
- Dispose replaced worlds, systems, renderers, controls, geometries, materials, textures, and pending async work.
- A scene object must have one clear owner.
- Keep rendering separate from simulation and network rules.
- Preserve procedural vehicles as fallbacks.
- Stations remain route-aware and curve-following unless explicitly redesigned.

## Data and scenery

- Route and GTFS conversion belongs in scripts, tools, or import commands.
- Do not hand-edit generated route packages.
- Custom city scenery must use provider or adapter boundaries with generic fallback coverage.
- Do not load an entire city mesh into memory.
- Prefer tiled, abortable, LOD-aware scenery loading.
- Keep coordinate conversion and distance units explicit.

## Vehicle reuse

- Simulator and live-follow vehicles must use the same vehicle definition resolver, registry, builder, and presentation controller.
- Do not implement live-specific copies of doors, interiors, displays, window visibility, lights, or camera-anchor behavior.
- Only vehicle placement differs between simulator route motion and live along-track motion.
- Far and overview live vehicles may use simplified LOD models, but a followed vehicle must use the complete registered vehicle design.
- A new detailed vehicle feature is incomplete until it works in both simulator and live-follow contexts.
- Do not construct fake `DemoRoute` objects to select vehicle models.

## Repository hints

Common frontend paths:

```txt
src/app/
src/engine/
src/features/
src/simulator/
src/vehicles/
src/world/
public/data/
tools/
scripts/
```

## Commands
```shell
npm install
npm run dev
npm test
npm run build
```
### Regenerate the frontend API client after backend contract changes:
```shell
npm run gen:api
```

### After changing Go/WASM simulator code, rebuild and commit:
```shell
public/sim.wasm
public/wasm_exec.js
```

## Comments
Use brief intent comments only for:

- non-obvious lifecycle behavior
- performance-sensitive decisions
- state-machine transitions
- physical or geographic constants
- GTFS assumptions
- concurrency, caching, or ordering rules

Do not narrate straightforward code.