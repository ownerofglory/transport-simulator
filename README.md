# Stuttgart Stadtbahn Simulator — Product Slice

Browser prototype for a Stuttgart Stadtbahn ride simulator.

This first slice uses:

- **TypeScript + Three.js** for browser rendering
- **Leaflet** for the live minimap
- **Go + WebAssembly** for simulator state, station stops, dwell time, speed and braking logic
- **Vite** as the local dev server and bundler

No Rust is used.

## What is included

- 36 generated directional Stuttgart Stadtbahn route packages from the VVS GTFS feed, covering U1-U9, U11-U16 and U19
- Passenger ride mode with automatic driving
- Driver tariff training mode with manual throttle/brake, station stop scoring and timetable delta
- Local ride entitlement mock: three free rides, EUR 0.20 ride credits and EUR 8 membership toggle
- Leaflet minimap showing route geometry, vehicle position and direction
- Live SSB-style stop schematic with auto-scrolling vehicle position and pulsing approaching-station marker
- Clean untextured terrain relief without streamed photographic/raster map tiles
- Streamed OpenFreeMap/OpenMapTiles buildings using source footprints, heights and colours without generated façade or roof decoration
- Streamed OSM lakes, river surfaces, canals, streams and drainage waterways
- Streamed terrain-following OSM roads, bridges, railway corridors, platforms, footways, cycleways and steps
- Rich OSM land cover and land use including vineyards, orchards, allotments, wetlands, institutional grounds and sports areas
- Instanced trees and shrubs plus streamed transit signs, parking signs, bicycle racks, bins, bollards, fountains and local POI markers
- Route-proximity landmark silhouettes for Neues Schloss, Altes Schloss, Stiftskirche, Johanneskirche, Bonatzbau, Weißenhofsiedlung, Fernsehturm and Grabkapelle
- Stuttgart terrain relief from Terrarium DEM tiles, applied to ground, track, buildings and surface objects
- OSM-classified Stadtbahn tunnel sections with eased underground profiles, portals, lining and tunnel lighting
- Double-track Stadtbahn corridor: one track per direction, with the active vehicle offset onto its running track
- Dimensionally matched Stadler Tango / SSB DT8-inspired articulated vehicle whose cars independently follow the rail centerline
- 80 m coupled double formations on U1, U6, U7, U11, U12 and U19
- Automatic terminal turnaround into the matching opposite-direction service
- Rails, sleepers and curve-following platforms with tactile safety edges
- Route-aware SSB-inspired stations: glass-and-blue-steel surface canopies plus enclosed underground halls with columns, lighting and wayfinding
- Station furniture including benches, ticket machines, timetable cases, bins and repeated platform name signs
- Shared-corridor overlays for adjacent Stadtbahn lines and simulated opposing services
- Elevated chase camera as the default, plus passenger and cab views
- Selectable GTFS start station for every route
- Spring, summer, autumn and winter visual modes
- Go/WASM simulation bridge exposed as `window.ssim`

## Requirements

- Go 1.23+ with WebAssembly support
- Node.js 20+
- npm

## Run the built app without npm

The repository includes a refreshed `dist/` build. If dependencies are hard to install behind a proxy, serve the built app with Go:

```bash
go run ./tools/serve
```

Then open:

```text
http://127.0.0.1:5174
```

## Run locally

```bash
npm install
npm run dev
```

Then open the Vite URL printed in the terminal.

`npm run dev` starts Vite. Use `npm run build` to rebuild both Go/WASM and the production bundle.

## Build production bundle

```bash
npm run build
npm run preview
```

## Deploy to Vercel

The repository includes the generated Go WebAssembly runtime in `public/`, so Vercel only needs Node.js for its build:

```bash
npm run build:vercel
```

Import the repository into Vercel or run `vercel`. The checked-in `vercel.json` selects the Vite preset, runs the cloud-safe build command, publishes `dist/`, and serves `sim.wasm` with the WebAssembly MIME type. After changing the Go simulator, run `npm run wasm:build` and commit the refreshed `public/sim.wasm` and `public/wasm_exec.js` artifacts before deploying.

## Refresh VVS GTFS route packages

The app reads compact generated route packages from `public/data/vvs-stadtbahn-routes.json`.

```bash
mkdir -p data/raw
curl -L https://download.vvs.de/gtfs_realtime.zip -o data/raw/vvs-gtfs.zip
node tools/import-vvs-gtfs.mjs data/raw/vvs-gtfs.zip public/data/vvs-stadtbahn-routes.json
node tools/enrich-route-terrain.mjs
npm run build
```

The raw ZIP is intentionally ignored because it is large. The generated JSON includes attribution metadata. Current generated feed source: VVS GTFS `20260618`, valid from `20260618` to `20260918`.

## Project structure

```text
.
├── public/
│   ├── data/demo-route.json
│   ├── sim.wasm              # generated
│   └── wasm_exec.js          # copied from Go toolchain
├── scripts/build-wasm.sh
├── src/
│   ├── main.ts               # app bootstrap and HUD
│   ├── minimap.ts            # Leaflet map and vehicle marker
│   ├── osm-scene.ts          # streamed OSM buildings and surface objects
│   ├── route.ts              # route packages and geometry
│   ├── terrain.ts            # Terrarium DEM decoding and ground deformation
│   ├── wasm.ts               # Go/WASM loader and typed bridge
│   ├── world.ts              # Three.js world, train, stations
│   └── style.css
├── tools/import-vvs-gtfs.mjs # GTFS-to-route-package importer
├── tools/enrich-route-terrain.mjs # DEM profile and OSM tunnel enrichment
├── tools/serve/main.go       # no-npm static server for dist/
└── wasm/sim/main.go          # Go simulation core
```

## Next development milestones

1. Expand the GTFS importer to include every Stadtbahn route variant and service-calendar selection.
2. Add live delay support from TRIAS/EFA where available.
3. Add Baden-Württemberg LoD2 roof forms and higher-resolution local terrain data.
4. Add vehicle interior and audio/announcement system.
5. Replace the local entitlement mock with real payments and account-backed access.
6. Expand driver training with signals, door release, platform stopping rules and route exams.

## Design note

The prototype keeps the simulation deterministic and compact: JavaScript requests one Go/WASM tick per animation frame, then renders the train at the returned `distanceM`. This separation lets us later replace the hand-authored routes with real GTFS/shape geometry without rewriting the simulation core.

The WASM build script writes Go's build cache to `.cache/go-build`, keeping builds self-contained in restricted workspaces.

Real-world scenery uses OpenFreeMap's public OpenMapTiles-compatible vector tiles. Attribution: OpenFreeMap, © OpenMapTiles, data from © OpenStreetMap contributors.

Relief uses the open Mapzen Terrain Tiles dataset hosted through AWS Open Data. Route packages store a smoothed railway profile, while streamed raster ground tiles decode the Terrarium DEM at runtime. Tunnel classification comes from the OpenMapTiles `transportation` layer's `brunnel=tunnel` geometry near each GTFS shape.
