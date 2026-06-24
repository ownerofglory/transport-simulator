# AGENTS.md

Standing brief for AI coding agents. Keep changes small, local, and reviewable.

## Project

Stuttgart Transit Simulator is a free, non-commercial browser prototype for public transport simulation.

Stack:

* TypeScript + Three.js + Leaflet
* Go + WebAssembly simulator
* Vite
* GTFS-derived JSON/GeoJSON data
* OpenFreeMap/OpenMapTiles/OSM scenery
* Mapzen Terrarium terrain

No Rust. No React. No backend/database/payment system unless explicitly requested.

The app is multi-city, not Stuttgart-only. Current cities include Stuttgart, Ulm, and Odessa.

## Core rules

* Preserve existing behavior unless the task says otherwise.
* Prefer the smallest safe change.
* Do not rewrite large systems in one step.
* Do not load all cities, modes, routes, or assets at startup.
* Do not edit `dist/` manually.
* Do not manually edit generated data unless the task is about generated data.
* Keep attribution visible for map/route data.

## Boundaries

TypeScript/browser owns:

* rendering
* DOM/HUD
* Leaflet minimap
* route/city loading
* terrain and OSM scenery
* camera and vehicle visuals

Go/WASM owns deterministic simulation state:

* speed/braking
* distance along route
* station stops
* dwell/doors
* scoring/timetable state

Do not move rendering, DOM, Leaflet, GLB loading, tile fetching, textures, or browser APIs into Go/WASM.

## Repo hints

Main code is usually in:

```txt
src/
wasm/sim/
public/data/
tools/
scripts/
```

If newer split folders such as `src/app`, `src/ui`, or `src/simulator` exist, prefer them over older paths.

## Commands

```bash
npm install
npm run dev
npm run build
go test ./...
```

After changing Go simulator code, rebuild and commit:

```txt
public/sim.wasm
public/wasm_exec.js
```

## Rendering/performance

* Keep per-frame paths fast.
* Avoid allocating geometry, materials, or textures per frame.
* Dispose worlds, renderers, geometries, materials, and textures when replacing scenes.
* Keep rendering separate from simulation rules.

## Vehicles/stations

* Procedural vehicles are valid fallbacks; do not remove them during asset work.
* Vehicle models must not own route positioning, terrain sampling, camera movement, rendering, OSM streaming, or station building.
* Stations are route-aware and often curve-following; do not replace full stations with fixed GLB files unless asked.

## Comments

Use brief intent comments only for non-obvious logic, lifecycle, performance, physical constants, or GTFS/city assumptions.
