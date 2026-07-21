# Live Mode — Concept

Free-flight live traffic view for the Transit Simulator. The user flies freely over the 3D city and watches real public transit vehicles move on the network in (near) real time, powered by the `live-traffic` endpoints of the transit-simulator-backend.

Status: concept / not implemented. Related backend spec: `api/openapi.yaml` (`/api/v1/live/*`).

---

## 1. Goals and non-goals

**Goals**

- A third way to use the app next to riding and driving: observe the real network live, in the existing Three.js world.
- Entry point sits next to Journey search in the Realtime tab; one click in, one click out.
- Free camera: pan, rotate, zoom from city overview down to street level.
- Real vehicle positions from `GET /api/v1/live/vehicles`, smoothly animated between updates.
- Network traffic scales with what the user actually looks at: viewport-bounded requests, zoom-dependent mode filtering, zoom-dependent update cadence, client-side interpolation so the poll rate can stay low.

**Scope: VVS (Stuttgart) only**

For now Live mode exists exclusively for the Stuttgart city module. The backend is TRIAS/VVS-backed and covers the VVS network only, so the feature is double-gated: the client shows Live only when the selected city is Stuttgart, and the backend's `/live/status` must report `enabled: true`. Every other city (Ulm, Odessa, …) never shows the Live entry point at all — not even disabled — so no live-traffic code or requests load for non-VVS cities.

**Non-goals (first release)**
- No historic playback UI (the `at` replay parameter stays a debugging tool).
- No boarding a live vehicle into ride/driver simulation (candidate follow-up, see §10).
- No backend changes required for the MVP; the SSE stream is an optimization step (§6.5).

---

## 2. User experience

### 2.1 Entry and exit

The Realtime tab toolbar gains a fourth action:

```
[ Journey search ] [ Stop search ] [ Departures ] [ ● Live ]
```

- **City gate (VVS only):** the Live button is rendered only when `state.selectedCityId === 'stuttgart'`. For every other city the toolbar keeps its current three actions and the live feature module is never imported (code-split via dynamic import, in line with the "don't load all cities/modes at startup" rule). Switching away from Stuttgart while in Live mode exits Live first.
- The Live button first calls `GET /api/v1/live/status`. If `enabled: false`, the button renders disabled with a tooltip ("Live traffic unavailable"). Status is cached for the session and re-checked on failure.
- Clicking Live switches the app into the Live workspace: the current route simulation world is replaced by the live city view, the HUD collapses to a slim Live HUD (see 2.4), and the URL updates (`?view=live&cam=…`) so a Live view is shareable/restorable.
- An always-visible "Exit Live" control returns to the previous route/tab selection, which is preserved untouched in app state.

### 2.2 Free-flight camera

A new orbit/fly camera rig (`FreeCameraRig`) alongside the existing chase/cab/passenger rigs:

- **Desktop:** drag = pan, right-drag / Ctrl-drag = rotate/tilt, wheel = zoom, WASD/arrow keys = pan, Q/E = rotate. Double-click a point = fly-to.
- **Mobile:** one finger = pan, two-finger pinch = zoom, two-finger twist = rotate, two-finger drag = tilt. Reuses `InputController`'s pointer plumbing with a new semantic event set (`pan`, `orbit`, `zoom`, `flyTo`).
- Altitude clamped between ~80 m above ground and ~12 km; pitch clamped so the camera never goes underground. The camera's ground footprint defines the data viewport (§5).
- Start position: overview of the whole Stuttgart network (roughly the S-Bahn bounding box), or the shared URL camera if present.

### 2.3 Vehicles

Every vehicle from the snapshot renders on the network, mode-colored (Stadtbahn cyan/SSB yellow, S-Bahn green, bus red — reuse the existing mode palette from `domain/transport.ts`). Representation depends on camera altitude (§4). Vehicles carry a floating line badge ("U6", "S1", "42") that fades in below the mid altitude band.

Delay is visualized on the badge: on time = neutral, 2–5 min = amber, > 5 min = red. Vehicles with `source: schedule` (pure timetable extrapolation) render slightly desaturated with a "planned" hint in the info card, so users can tell measured reality from inference.

### 2.4 Selection, info card, follow

Clicking/tapping a vehicle opens a compact info card (replaces the route diagram rail in Live mode):

```
U6 → Gerlingen                      ● live (high)
+3 min · in transit
Prev: Pragsattel   Next: Löwentor
[ Follow ]  [ Departures at next stop ]
```

- Fields map 1:1 to `LiveVehicle`: `line`, `direction`, `delaySeconds`, `status`, `previousStop`, `nextStop`, plus a confidence/source badge (`confidence` × `source`).
- **Follow** attaches the camera to the vehicle (reusing chase-rig framing) and switches that one vehicle to per-run refresh via `GET /api/v1/live/vehicles/{runId}` every 5 s, independent of the viewport snapshot cadence.
- **Departures at next stop** opens the existing `DeparturesModal` (stop resolved by name/coords through the existing locations API) — Live mode composes with the tools that already exist.
- Clicking a station marker (visible at near zoom) opens the same departures modal.

### 2.5 Live HUD

A slim overlay instead of the simulation HUD:

- Mode filter chips (Stadtbahn / S-Bahn / Bus / Rail) — user filters are ANDed with the automatic zoom-tier filter (§5.2); chips for tiers where a mode is auto-hidden show a small "zoom in" hint.
- Data freshness indicator: "live · updated 4 s ago", turning amber when `snapshotAgeSeconds` exceeds ~30 s and red with a "degraded" note when the snapshot reports `degraded: true`.
- Vehicle count in view.
- Clock (the world's lighting keeps following real local time, as today).

---

## 3. Architecture fit

The codebase already has the seams this needs; Live mode adds a third workspace rather than a new app.

```
src/features/live/
  LiveModePanel.tsx        // HUD overlay, filter chips, freshness, exit
  LiveVehicleCard.tsx      // selection info card
  useLiveVehicles.ts       // polling/streaming state machine (§6)
  liveApi.ts               // typed wrappers for /live/* (extends features/realtime/api.ts style)
  liveTypes.ts             // renamed wire types (mirrors realtime/types.ts convention)
  interpolation.ts         // dead-reckoning between snapshots (§7)
  viewport.ts              // camera → bbox, tier classification, hysteresis (§5)

src/engine/workspace/LiveWorkspace.ts   // sibling of SimulationWorkspace / PhotoWorkspace
src/engine/systems/LiveTrafficSystem.ts // owns vehicle entities, LOD swaps, per-frame animation
src/engine/cameras/FreeCameraRig.ts     // free-flight rig
```

- **Workspace:** `LiveWorkspace` joins `SimulationWorkspace`/`PhotoWorkspace` under `WorkspaceManager`; entering Live is a workspace switch, so input routing, camera ownership, and disposal follow the established pattern.
- **World reuse:** the existing OSM scenery/terrain streaming (osm-scene, terrain, water, roads) is reused as the backdrop. The scenery streamer follows the free camera instead of the route corridor; its own tile LOD rules (§4.2) keep that affordable.
- **API layer:** `liveApi.ts` follows `features/realtime/api.ts` conventions (same error envelope handling, same Vite proxy / `VITE_REALTIME_API_BASE` base). Wire types come from the same generated `api-types.ts` (`LiveVehicle`, `VehicleSnapshot`, `LiveTrafficStatus` are already in the spec — regenerate with `npm run gen:api`).
- **State:** `AppState` gains `view: 'simulator' | 'live'` (or extends `hudTab`), plus persisted Live camera + mode filters for URL sync via `AppUrlState`. City eligibility lives in the city definition (`liveTraffic?: { network: 'vvs' }` on `cities/stuttgart.ts`) rather than being hard-coded in the UI, so enabling another city later is a data change. Restoring a URL with `?view=live` for a non-Stuttgart city falls back to the simulator view.
- **Boundary rule respected:** all of this is TypeScript/browser; Go/WASM stays untouched — Live mode has no deterministic simulation, positions come from the server.

---

## 4. Rendering: level of detail

Camera altitude drives three LOD tiers. Altitude bands are tuning constants; starting points below.

### 4.1 Vehicle LOD

| Tier | Camera altitude | Vehicle representation |
|------|----------------|------------------------|
| **T0 City** | > 4 000 m | Instanced quads/sprites, mode-colored, ~size-exaggerated so they read at distance. One draw call per mode via `InstancedMesh`. No labels. |
| **T1 District** | 800 – 4 000 m | Simplified extruded-box vehicles (single low-poly mesh per mode, instanced), oriented by `bearing`. Line badges appear (SDF text sprites, pooled). |
| **T2 Street** | < 800 m | Full procedural vehicles from the existing registry (DT8/Tango, Citaro bus, BR 423 S-Bahn) for vehicles within ~1.5 km of the camera focus; T1 boxes beyond that radius. Built lazily, pooled and reused per mode — never constructed per frame (AGENTS.md rendering rules). |

Cap: at most ~50 full T2 vehicle models alive at once; the pool evicts the farthest. Geometry/materials are created once per mode and shared.

### 4.2 Scenery LOD

The 3D backdrop is the main GPU/network cost of free flight, so it degrades faster than vehicles:

- **T0:** terrain relief + water + rail/road ribbon geometry only. No OSM buildings, no street furniture, no trees. The network itself (route corridors from the existing GTFS packages) is drawn as glowing ribbons so the city stays legible.
- **T1:** + building footprint extrusions from OpenFreeMap tiles at low tile zoom, coarse land cover. No POI/furniture instancing.
- **T2:** the full existing streaming stack (buildings, roads, water, land cover, furniture) around the camera focus, same as today's route view but keyed to camera position with a fixed tile budget and LRU eviction.

Tile budget: hard cap on concurrently loaded scenery tiles (e.g. 60); flying away evicts. Fast continuous flight suppresses tile fetches until the camera slows (velocity gate), so sweeping across the city doesn't download the whole map.

---

## 5. Data fetching: viewport + zoom optimization

This is the core of the "don't burn traffic" requirement. Three levers: **what area** we ask for, **which modes**, and **how often**.

### 5.1 Viewport → bbox, with hysteresis

- The data viewport is the camera's ground-intersection footprint, expanded by a **25 % margin** on each side so small pans are already covered.
- The bbox is **quantized to a 0.01° grid** (~1 km). Identical consecutive requests are thus byte-identical URLs — friendly to any HTTP cache along the way and easy to dedupe client-side.
- **Hysteresis:** a new snapshot is requested only when (a) the poll timer fires, or (b) the current camera footprint escapes the previously fetched (margined) bbox, or (c) the zoom tier changes. Panning inside the margin never triggers a request.
- In-flight requests are aborted (`AbortSignal`) when superseded by a tier change or a viewport escape.

### 5.2 Zoom tier → modes and cadence

`GET /api/v1/live/vehicles?latMin&lonMin&latMax&lonMax&modes=…` with:

| Tier | `modes` requested | Poll interval | Rationale |
|------|-------------------|---------------|-----------|
| **T0 City** | `s-bahn,rail,light-rail,tram` | 30 s | Overview: rail skeleton only. Buses (the bulk of the fleet) are invisible at this height anyway — requesting them is pure waste. |
| **T1 District** | `s-bahn,rail,light-rail,tram` (+ `bus` when the bbox is < ~6 × 6 km) | 15 s | Buses appear once the area is small enough that their count is bounded. |
| **T2 Street** | all modes (∩ user filter chips) | 8 s (5 s for a followed vehicle via `/live/vehicles/{runId}`) | Small bbox ⇒ few vehicles ⇒ frequent cheap updates. |

User filter chips only ever *narrow* the automatic set. The `modes` parameter is required by the API, so the client always sends an explicit list.

### 5.3 Rough traffic budget

Assuming ~350 bytes per `LiveVehicle` JSON, gzip ≈ ×0.25 on arrays:

| Tier | Typical vehicles in bbox | Payload (gzipped) | Cadence | Sustained rate |
|------|--------------------------|-------------------|---------|----------------|
| T0 (whole city, rail only) | ~120 | ~11 KB | 30 s | **~22 KB/min** |
| T1 (district, +bus) | ~80 | ~7 KB | 15 s | **~28 KB/min** |
| T2 (street, all modes) | ~15 | ~1.5 KB | 8 s | **~11 KB/min** |

Order of magnitude: **20–30 KB/min ≈ 1.5 MB/h** — mobile-friendly. The naive alternative (whole city, all modes, 5 s) would be ~25× that. Scenery tiles dominate total traffic regardless; the §4.2 budget and velocity gate keep that bounded too.

### 5.4 Lifecycle throttling

- `document.visibilitychange` → hidden: stop polling entirely; on return, fetch immediately once.
- No user input for > 3 min at T0/T1: drop to a 60 s "ambient" cadence until the next interaction (the scene keeps animating via interpolation, §7).
- Network errors: exponential backoff (2 s → 4 s → … → 60 s cap) with the freshness indicator going amber/red; a successful fetch resets it.
- `enabled: false` from `/live/status` at runtime (e.g. upstream outage): show a non-blocking banner, keep the last snapshot rendered as frozen "planned" state for 2 min, then offer exit.

---

## 6. Update mechanics

### 6.1 Snapshot merge

Each `VehicleSnapshot` is merged into a client-side vehicle store keyed by `runId`:

- New `runId` → spawn (fade in).
- Present in store, absent from snapshot for 2 consecutive polls (or `status: completed`) → despawn (fade out). One missed snapshot is tolerated because bbox edges flicker.
- Present in both → becomes the new interpolation target (§7).

`generatedAt`/`snapshotAgeSeconds` feed the freshness UI; `degraded: true` sets the degraded badge but data still renders.

### 6.2 Followed vehicle

While following, the single vehicle refreshes via `GET /live/vehicles/{runId}` at 5 s and is patched into the same store (per-run data wins over snapshot data by `estimatedAt`). A 404 (run ended) exits follow gracefully with a toast.

### 6.5 SSE stream — later optimization, not MVP

`GET /api/v1/live/vehicles/stream` currently has **no viewport/mode parameters** — it pushes the full feed. For the zoomed-out tiers, polling a filtered bbox is strictly cheaper than an unfiltered stream, so:

- **MVP: polling only** (above). Simple, cache-friendly, traffic-proportional to viewport.
- **Phase 2 proposal (backend change):** accept `latMin/lonMin/latMax/lonMax/modes` as query params on the stream (re-subscribing on viewport change), or a lightweight delta protocol (`upsert`/`remove` events with `Last-Event-ID` resume). With that in place, T2 switches from 8 s polling to the stream for sub-second delay/status updates; T0/T1 stay on polling.

---

## 7. Smooth motion between updates (interpolation)

Poll intervals of 8–30 s only work visually if vehicles keep moving between snapshots.

- **Along-track dead reckoning:** the app already has route geometry for the whole VVS network (GTFS route packages). Vehicles are matched to a polyline via `routeId`/`line` + `direction` (with `shapeId` kept as the future exact key); position is projected onto the polyline, and between snapshots the vehicle advances along it at the implied speed (distance between the last two server positions ÷ time between `estimatedAt`s, clamped to plausible per-mode speeds).
- **Snap correction:** when a new snapshot arrives, the rendered position eases to the new target over ~1.5 s rather than teleporting; error above ~300 m snaps immediately.
- **Status-aware:** `at_stop` → hold position (doors-open idle), `not_started` → hidden, `in_transit` → dead-reckon, `completed` → despawn.
- **Unmatched vehicles** (no local geometry, e.g. regional rail): straight-line interpolation using `bearing`, T0/T1 representation only.
- Dead reckoning is presentation-only easing of server truth — it lives in `features/live/interpolation.ts` + `LiveTrafficSystem`, not in Go/WASM (which stays the owner of *simulated* physics only).

This is what lets T0 run at a 30 s cadence while still looking alive.

---

## 8. Edge cases and honesty of display

- **Confidence/source is always visible** on the info card; `schedule`-sourced vehicles are visually distinguished (desaturated) so the view never over-promises "live" for extrapolated data.
- **Cancelled/ghost runs:** a vehicle that disappears mid-run fades out; no error surfaced unless it was being followed.
- **Clock skew:** freshness is computed from `snapshotAgeSeconds` (server-relative), not client clock vs `generatedAt`.
- **Tunnel sections:** vehicles dead-reckoning through classified tunnel segments render as a subdued glow on the surface alignment (the existing tunnel classification data locates these) — they don't vanish.
- **Empty viewport:** "No vehicles in view — zoom out or check filters" hint instead of a blank sky.

---

## 9. Implementation phases

1. **M1 — Foundations:** `/live/status` gate + Live button; `LiveWorkspace` + `FreeCameraRig` over the existing scenery with T0/T1 scenery rules; regenerated API types + `liveApi.ts`.
2. **M2 — Vehicles:** snapshot polling with bbox/tier/hysteresis logic (§5); instanced T0/T1 vehicle rendering; merge/spawn/despawn; freshness HUD.
3. **M3 — Motion & detail:** route-matched dead reckoning (§7); T2 full vehicle models with pooling; line badges; delay coloring.
4. **M4 — Interaction:** vehicle picking, info card, follow mode with per-run polling, departures modal integration, mode filter chips, URL state.
5. **M5 — Hardening:** visibility/idle throttling, backoff, degraded handling, mobile input polish, traffic measurement against the §5.3 budget.
6. **M6 (optional, backend co-change):** viewport-scoped SSE stream for T2.

Each milestone is shippable behind the `/live/status` gate.

---

## 10. Open questions

1. **Boarding from Live:** "Follow" could later offer "Ride this vehicle" — spawning a ride-mode session on the matched route at the live position. Worth speccing separately; touches the Go/WASM session model.
2. **`shapeId` resolution:** is there (or should there be) an endpoint to fetch shape geometry by `shapeId`, so matching doesn't rely on line/direction heuristics?
3. **Vehicle count ceilings:** should the backend enforce a max-vehicles-per-response (with a `truncated` flag) as a guardrail against huge bboxes, or is client discipline enough?
4. **Multi-city:** when other backend cities exist, `/live/status` could report coverage areas so the Live button works per city.
5. **Night/weekend low service:** at T0 with 5 vehicles on the network, should cadence drop further (e.g. 60 s) based on observed vehicle counts?
