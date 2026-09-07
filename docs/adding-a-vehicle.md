# Adding and styling a vehicle

Developer reference for putting a new vehicle on the tracks — a new livery for
an existing body shape, a new bus/S-Bahn formation, or a wholly new vehicle
kind. Companion to [adding-a-city.md](adding-a-city.md), which covers section
7 ("Add the vehicle") at a higher level; this doc goes into the vehicle system
itself.

## Three ways to produce a `VehicleInstance`

Every builder — however it's implemented — takes a `ResolvedVehicleBuildContext`
and returns a `VehicleInstance` (`src/vehicles/types.ts`): a root `THREE.Group`,
per-car groups, doors, window bands, `cabShells`/`passengerShells`, and a few
optional callbacks (`setExteriorLightsOn`, `updateInteriorDisplay`, `dispose`).
There are three ways to build one:

| System | Use for | Config | Builder |
| --- | --- | --- | --- |
| Generic blueprint | A new livery/formation of a car built from box sections + a chamfered cab (stadtbahn/tram/s-bahn-shaped bodies) | `VehicleBlueprintConfig` JSON | `buildVehicleFromBlueprint` |
| Bus blueprint | A new bus livery/door/axle layout on the existing Citaro body | `BusBlueprintConfig` JSON | `buildBusVehicle` |
| S-Bahn blueprint | A new BR 430-family livery/car formation | `SBahnBlueprintConfig` JSON | `buildSBahnVehicle` |
| Procedural | A body shape the blueprint geometry can't express (raked nose profiles, funiculars, cable cars, ferries, a city-specific tram) | none — hand-written TypeScript | `ProceduralTransitVehicleFactory` in `procedural.ts` |

Start with a blueprint. Only drop to procedural code when the shape itself —
not just materials or section lengths — needs to differ (the Vancouver
SkyTrain's raked cab face and Odessa's tram nose are procedural for this
reason; see `SKYTRAIN_CAB_FRONT_RAKE`/`ODESSA_CAB_FRONT_RAKE` in
`procedural.ts`).

## Vehicle identity and resolution order

`src/vehicles/VehicleDefinition.ts` is the single description of *which*
vehicle to build — shared by the simulator and live-follow so both resolve to
an equivalent model for the same route (concept: a Stuttgart U12 is the same
vehicle whichever path built it). It carries `vehicleKind`, an optional
`vehicleDesignId`, line/destination/accent color, and computed `formation`
flags. Placement (route distance vs. live along-track position) is
deliberately not part of it.

`VehicleRegistry.resolve()` (`src/vehicles/registry.ts`) turns a definition
into a builder, in this order:

1. Explicit `vehicleDesignId` (from route, then city, then mode config) — an exact builder registered by id.
2. `modeDefinition.vehicleFamily` — also matched against builders registered by id.
3. `modeDefinition.vehicleKind` (default `'stadtbahn'`) — a registered kind builder.
4. A registered **generic** fallback for that kind (used when a dedicated builder is unregistered/broken).
5. The final fallback builder (defaults to `createStadtbahnVehicle`).

All of this is wired up once in `src/vehicles/buildTransitVehicle.ts` — that's
where you register a new blueprint or kind builder.

**Always build through `VehicleVisualFactory.create(definition, compat)`**
(`src/vehicles/VehicleVisualFactory.ts`), not `buildTransitVehicle` directly.
It also creates the shared `VehicleInteriorDisplay` and wraps everything in a
`VehicleVisualController`, and it's the one factory both the simulator and the
live-follow view use — see [Vehicle reuse](#vehicle-reuse-and-live-follow-parity)
below. **Never construct a fake `DemoRoute`** to coax a builder into a shape;
if you only have a `VehicleDefinition`, pass it as `definition` and leave
`route`/`city`/`modeDefinition` out — `resolveBuildContext` synthesizes
minimal stand-ins for the legacy builders that still read them.

## Styling an existing body: the generic blueprint

Use this for a new stadtbahn/tram/s-bahn-shaped livery — this is how the
Stuttgart DT8/Tango (`src/vehicles/configs/stuttgart-dt8-tango.json`) and the
generic modern tram fallback are built. The schema lives in
`src/vehicles/blueprint/VehicleBlueprintConfig.ts`.

```json
{
  "id": "stuttgart-dt8-tango",
  "kind": "stadtbahn",
  "displayName": "SSB DT8 / Stadler Tango (blueprint approximation)",
  "dimensions": { "lengthM": 17.75, "widthM": 2.65, "heightM": 3.34, "floorHeightM": 1.0 },
  "materials": {
    "body": { "color": "#ffdf00", "roughness": 0.52, "metalness": 0.05 },
    "glass": { "color": "#91c7dd", "opacity": 0.58, "transparent": true, "roughness": 0.08 }
  },
  "sections": [
    { "center": -9.95, "length": 17.75, "cab": "front" },
    { "center": 9.95, "length": 17.75, "cab": "rear" }
  ],
  "doors": [{ "side": "both", "section": 0, "z": -5.55 }],
  "formation": {
    "doubleFormationLines": ["U1", "U6", "U7", "U11", "U12", "U19"],
    "duplicateSetOffsetM": 39.8
  },
  "cameraAnchors": { "passenger": { "section": 0, "position": [0.15, 2.25, 3.5], "lookAt": [0, 2.2, -8] } }
}
```

Notes on the fields:

- **`sections`** — one entry per articulated car, each local to its own
  `center` (z=0 at the section midpoint; the runtime repositions each car
  every frame using `centerOffsetM`, so section geometry must not assume a
  fixed world position). A section with `cab: 'front' | 'rear'` gets a
  chamfered nose (`makeCabNose` in `blueprint/sections.ts`) and, unless an
  explicit `destinationDisplays` entry targets it, an auto-generated
  destination board.
- **`doors`/`windows`** reference a `section` index by position; windows left
  unspecified for a section are auto-placed evenly (`autoPlaceWindows`).
- **`materials`** are named `MeshStandardMaterial` configs; every
  `*Material` field elsewhere in the config (`bodyMaterial`, `glassMaterial`,
  `door.material`, …) references one of these names and falls back to a
  built-in neutral grey if the name is missing (`resolveMaterial`).
- **`formation.doubleFormationLines`** + `duplicateSetOffsetM` — lines in this
  list get two coupled sets offset by `±duplicateSetOffsetM / 2` (used for
  Stadtbahn double-traction; see [Formation flags](#formation-flags) below).
- **`gangways`/`bogies`/`pantographs`/`roofEquipment`** — simple root-level
  fixtures, positioned in world-local space relative to train center.
- **`couplers`** is defined in the schema but **not currently consumed** by
  the builder — don't expect it to do anything yet.
- **`cameraAnchors`** is likewise defined in the schema but **not currently
  read by any camera rig** — see [Interior camera anchoring](#interior-camera-anchoring)
  for the mechanism that actually controls camera placement today.

Register a new config in `buildTransitVehicle.ts`:

```ts
import myLivery from './configs/my-livery.json';

for (const rawConfig of [genericModernTram, genericBus, stuttgartDt8Tango, myLivery]) {
  const result = vehicleRegistry.registerBlueprintFromJson(rawConfig);
  if (!result.ok) console.error(`Built-in vehicle blueprint "${rawConfig.id}" failed validation:`, result.errors);
}
```

`registerBlueprintFromJson` runs `validateVehicleBlueprint` first — required
fields, valid hex colors, section/material cross-references, and clamps on
runaway dimensions (`MAX_LENGTH_M = 120`, `MAX_WIDTH_M = 6`, `MAX_HEIGHT_M = 8`).
It never throws, so a bad config degrades to a console error rather than a
crash — check the console after adding one.

Then point something at it: set `vehicleDesignId: 'my-livery'` on the city,
the mode definition, or the route, per the resolution order above.

## Styling a bus: `BusBlueprintConfig`

Buses have their own declarative system
(`src/vehicles/blueprint/bus/`) because the Citaro body (windows, wheel
arches, mirrors, driver cab, bellows) is fixed, hand-written geometry in
`buildBusFromBlueprint.ts`; the config only decides livery, door/axle
positions, and the articulation rule. The built-in config is
`src/vehicles/configs/vvs-citaro-bus.json`, registered as
`defaultBusBlueprint` under the `'bus'` kind.

```json
{
  "id": "vvs-citaro-bus",
  "kind": "bus",
  "rigid": { "section": { "centerOffsetM": 0, "lengthM": 12.1, "cab": "front", "rear": "tail", "doorZs": [3.4, -0.2, -3.9], "axleZs": [3.7, -3.7], "name": "…" }, "halfLengthM": 6.25 },
  "articulated": {
    "lines": ["40", "42", "43", "44", "45", "52", "56", "57", "79", "91", "92"],
    "linePrefixes": ["X"],
    "cityIds": ["stuttgart"],
    "applyWhenCityUnknown": true,
    "sections": [
      { "centerOffsetM": 5.3, "lengthM": 10.4, "cab": "front", "rear": "joint", "doorZs": [3.15, -1.7], "axleZs": [3.85, -3.15], "name": "Front section" },
      { "centerOffsetM": -3.7, "lengthM": 6.8, "cab": "joint", "rear": "tail", "doorZs": [1.6, -1.95], "axleZs": [-2.4], "name": "Rear section" }
    ],
    "halfLengthM": 8.8
  }
}
```

`articulated.lines`/`linePrefixes` + `cityIds`/`applyWhenCityUnknown` is the
rule `isBusLineArticulated()` evaluates against a route's line label and
city id — exported specifically so the live-follow renderer picks the same
formation as the ride/explore view from just a GTFS line label. A `section`
needs `cab: 'front' | 'joint'` and `rear: 'tail' | 'joint'`; two adjacent
`joint` ends get a rubber bellows + turntable added automatically
(`addBusBellows`).

There is currently only one bus builder wired into the registry
(`vehicleRegistry.registerBuilder(defaultBusBlueprint.id, …)` in
`buildTransitVehicle.ts`, plus the `'bus'` kind builder falling through to
`buildProceduralTransitVehicle`, which for `vehicleKind === 'bus'` calls
`createBusVehicle()` — itself a thin wrapper that also renders the same
Citaro blueprint). To add a second bus livery (a different operator/city),
parse your own config with `parseBusBlueprint` and register it explicitly:

```ts
vehicleRegistry.registerBuilder('my-city-bus', (context) => buildBusVehicle(myBusConfig, context));
```

then point a route/city/mode's `vehicleDesignId` at `'my-city-bus'`.

## Styling an S-Bahn: `SBahnBlueprintConfig`

Same pattern as the bus, for the BR 430-family body
(`src/vehicles/blueprint/sbahn/`, built-in config
`src/vehicles/configs/db-br430-sbahn.json`). The formation is a flat list of
car centers rather than a rigid/articulated split:

```json
"formation": {
  "carCenters": [-25.2, -8.4, 8.4, 25.2],
  "halfLengthM": 34.2,
  "sectionNamePrefix": "Articulated car DB 430 section"
}
```

The first and last `carCenters` entries get cab ends; `layout` (door/window/
seat/pole/bogie z-positions) is shared across all cars. Register a variant the
same way as the bus: `parseSBahnBlueprint` → `registerBuilder(id, (context) =>
buildSBahnVehicle(myConfig, context))`.

## Adding a wholly new vehicle kind (procedural)

Use this when the body shape itself is new — see the Vancouver SkyTrain
(`createSkyTrainVehicle`, `procedural.ts:2085`) for a recent worked example: a
raked cab nose and metro-style body that don't fit the box-section blueprint.

1. If it's also a new transport mode, add the id to `KNOWN_TRANSPORT_MODES`
   and the new literal to `VehicleKind` in `src/domain/transport.ts` (skip
   this if you're adding a variant of an existing kind for one city, like a
   tram body specific to Odessa).
2. Add a branch to `ProceduralTransitVehicleFactory.build()`
   (`procedural.ts:60`). Two dispatch styles exist side by side:
   - keyed on `cityId` + `modeId`, for a city-specific variant of an existing
     kind (`cityId === 'odessa' && modeId === 'tram'`);
   - keyed on `vehicleKind`, for a kind-wide default (`vehicleKind === 'skytrain'`).
3. Write a private `createXVehicle()` method that pushes into the factory's
   shared fields — `this.root`, `this.cars`, `this.doors`, `this.windowBands`,
   `this.cabShells`, `this.passengerShells`, `this.cabDisplays`,
   `this.headLampMaterials`/`this.tailLampMaterials`/… — then let `build()`
   finish with `this.createVehicleInstance()`. Reuse the shared helpers in
   `src/vehicles/parts.ts` (`addSlidingVehicleDoor`, `addOpaqueTransitInterior`,
   `addPantograph`, `addExteriorLightThrow`, `addCabinLight`,
   `makeSetExteriorLightsOn`) instead of hand-rolling doors/lights/interior
   walls — this is what keeps day/night switching and interior shells
   consistent across every vehicle.
4. Export a `createXVehicle(context)` wrapper (`new
   ProceduralTransitVehicleFactory(context).createXVehicle()`) so the kind can
   also be targeted directly by id, and register it:
   ```ts
   vehicleRegistry.registerKindBuilder('skytrain', buildProceduralTransitVehicle); // generic kind dispatch
   vehicleRegistry.registerGenericKindBuilder('skytrain', (context) => buildSBahnVehicle(defaultSBahnBlueprint, context)); // fallback if unregistered
   ```
   Every kind in the `for (const kind of [...])` loop at the top of
   `buildTransitVehicle.ts` already dispatches through
   `buildProceduralTransitVehicle` — add your new kind literal to that array
   and step 2's `build()` branch takes it from there. Register a generic
   fallback (an existing blueprint/kind that's visually close) so the app
   still renders sane rolling stock if your builder is ever unregistered.

## Formation flags

`resolveFormation()` in `VehicleDefinition.ts` computes formation once, the
same way regardless of which system built the vehicle, so a definition is
self-describing:

- `stadtbahn` → `{ doubleFormation: isStadtbahnDoubleFormation(line) }`, checked
  against `DOUBLE_FORMATION_LINES` in `procedural.ts` (currently `U1, U6, U7,
  U11, U12, U19`).
- `bus` → `{ articulated: isBusLineArticulated(config, line, cityId) }`, per the
  `articulated` rule in the bus blueprint (see above).

Both predicates are exported specifically so the live-follow renderer (which
only has a line label and optional city id, not a full route) reaches the same
formation decision as the simulator/explore view. If you add formation logic
for a new kind, follow the same shape: a pure function of `(line, cityId)`
exported from the builder module, wired into `resolveFormation`.

## `passengerShells` vs `cabShells`

`VehicleVisualController.setPresentation()` toggles two mesh lists per camera
mode (`src/vehicles/VehicleVisualController.ts:97-100`):

- `passengerShells.visible = !interiorView` — general opaque body panels
  (skirt, body, roof), hidden in **both** passenger and cab views so daylight
  shows through the glass from inside.
- `cabShells.visible = !cabView` — cab-specific opaque parts (nose/mask,
  dashboard, partitions), hidden **only** in cab view so the driver's forward
  line of sight isn't blocked; still visible from the passenger and exterior
  cameras, where riders should see the cab ahead of them.

Every opaque body panel a builder creates must land in exactly one of these
two lists (`cabDisplays` — next-stop/destination boards — follows the same
`!cabView` rule as `cabShells`). Only glazing (windscreens, door glass) should
be left out of both — otherwise interior views look into the inside of the
vehicle's own nose, or the driver's view gets blocked by their own dashboard.

## Interior camera anchoring

`interiorCameraProfile` (`'rail' | 'bus' | 's-bahn' | 'tram'`, set on the
transport mode definition or `VehicleDefinition`) decides how
`PassengerCameraRig` (`src/engine/cameras/PassengerCameraRig.ts`) places the
passenger camera:

- `'rail'` — no mesh anchor; a generic seated-eye-height fallback position
  relative to route tangent (used by the default Stadtbahn profile).
- `'bus' | 's-bahn' | 'tram'` — anchored to a specific car (`trainCars[0]` for
  bus, the middle car for s-bahn/tram) using
  `car.userData.passengerCameraLocal` / `passengerLookAtLocal`, so the camera
  turns correctly with an articulated car. These `userData` fields are set
  explicitly by procedural builders (e.g. `procedural.ts:843-844`,
  `:969-970`) — **not** by the blueprint builders, and **not** by the
  blueprint schema's `cameraAnchors` field (currently unread — see above). A
  blueprint-only vehicle with an anchored profile still works, just with the
  generic default local offset baked into `PassengerCameraRig`; set
  `car.userData.passengerCameraLocal`/`passengerLookAtLocal` yourself in a
  procedural builder if you need a tuned anchor.

Cab and chase cameras (`CabCameraRig`, `ChaseCameraRig`) need no per-vehicle
config beyond `trainHalfLengthM`, which every builder already returns
(computed from `sections`/`carCenters` in the blueprint builders, or tracked
manually in the procedural factory).

## Vehicle reuse and live-follow parity

Per `AGENTS.md`: simulator and live-follow vehicles **must** use the same
resolver/registry/builder/presentation controller — only placement differs.
A vehicle feature (a new part, a new door, a tuned camera anchor) is not done
until it works from both entry points:

- simulator: any `view=ride` URL with the relevant mode/route.
- live-follow: live mode, following a run whose GTFS line resolves to the
  kind/formation you changed.

Both go through `VehicleVisualFactory.create`, so if you built via that
factory there's usually nothing extra to wire up — but verify visually in
both places anyway, since the failure mode (a live-only or simulator-only
divergence) is exactly what this rule exists to prevent.

## Verify

```bash
npm test
npm run dev
```

Force a specific design while testing in the browser:

```
/?city=stuttgart&transport=stadtbahn&route=<id>&view=ride&camera=chase
```

(temporarily set `vehicleDesignId` on the relevant city/mode/route, or add a
one-off `PARITY_TARGETS` entry — see below — to exercise it without touching
routing).

If you're refactoring an existing builder and want proof the visual output
didn't change, use the dev-only parity harness
(`src/vehicles/parityCheck.ts`) from the Vite dev server's browser console:

```js
const m = await import('/src/vehicles/parityCheck.ts');
m.captureBaseline();      // before the refactor
// ...make your change, reload...
m.compareWithBaseline();  // [] per variant means mesh-for-mesh identical
```

It fingerprints the full scene graph (geometry params + vertex hash,
materials, lights, door/shell counts) for the targets in `PARITY_TARGETS` —
add your own `{ line, vehicleKind, modeId }` entry there to cover a new
vehicle.
