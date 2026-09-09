---
name: add-style-vehicle
description: Add, restyle, or refactor a transit vehicle in the Transit Simulator. Use when creating a new vehicle design, livery, bus/S-Bahn formation, procedural vehicle kind, camera/interior behavior, vehicle registry wiring, or when ensuring simulator and live-follow vehicle parity.
---

# Add or style a vehicle

Use this skill when adding a new vehicle, changing an existing vehicle's visual design, introducing a new livery/formation, or modifying vehicle construction behavior in the Transit Simulator.

For the detailed vehicle-system reference, read:

- [references/adding-and-styling-a-vehicle.md](references/adding-and-styling-a-vehicle.md)

## Core rules

- Inspect the current repository before changing anything; file names and APIs may have evolved.
- Build vehicles through `VehicleVisualFactory.create(definition, compat)` unless the current architecture explicitly says otherwise.
- Preserve simulator/live-follow parity: both entry points must resolve through the same definition, registry, builder, and presentation controller.
- Prefer declarative blueprints over procedural TypeScript when the existing geometry can express the vehicle.
- Use procedural construction only when the body shape itself cannot be represented by the blueprint systems.
- Do not invent a fake route just to satisfy a builder; use the current build-context resolution path.
- Reuse shared parts/helpers for doors, interiors, pantographs, lights, displays, shells, and formation logic.

## 1. Inspect the vehicle architecture

Before implementing, locate and read the current versions of:

- `src/vehicles/VehicleDefinition.ts`
- `src/vehicles/VehicleVisualFactory.ts`
- `src/vehicles/VehicleVisualController.ts`
- `src/vehicles/registry.ts`
- `src/vehicles/buildTransitVehicle.ts`
- `src/vehicles/types.ts`
- generic vehicle blueprint schema/builder
- bus blueprint schema/builder
- S-Bahn blueprint schema/builder
- procedural vehicle factory
- shared vehicle parts/helpers
- camera rigs
- tests/parity harness related to vehicles

Also inspect one existing vehicle of the same general type.

Do not rely on stale line numbers from this skill; follow the current code.

## 2. Choose the correct construction system

Use the simplest system that can represent the requested vehicle.

### Generic vehicle blueprint

Use for a livery or formation based on the existing box-section/chamfered-cab geometry, such as many Stadtbahn, tram, or S-Bahn-shaped vehicles.

Typical configuration concerns:

- dimensions
- materials
- articulated sections
- doors/windows
- gangways/bogies/pantographs/roof equipment
- formation flags
- destination displays

Validate through the repository's current blueprint validator and registration path.

### Bus blueprint

Use for a new livery, axle layout, door layout, or rigid/articulated rule on the existing bus body.

Keep articulation decisions reproducible from route/city information so live-follow and simulator resolve the same formation.

### S-Bahn blueprint

Use for a new livery or car formation on the existing S-Bahn family body.

Keep car centers, shared layout, formation length, and cab-end behavior consistent with the current schema.

### Procedural vehicle

Use only when geometry itself differs materially from the blueprint systems, for example:

- strongly raked or custom nose profiles;
- funiculars/cable cars;
- ferries;
- city-specific tram bodies that cannot be represented by existing sections.

When adding procedural geometry, reuse shared helpers rather than duplicating doors, lights, shell behavior, or interiors.

## 3. Preserve vehicle identity and resolution

Follow the current registry resolution order. Conceptually, prefer:

1. explicit `vehicleDesignId`;
2. vehicle family/design registration;
3. registered vehicle-kind builder;
4. generic kind fallback;
5. final safe fallback.

Register new builders/configs in the central vehicle wiring rather than adding ad hoc construction in feature code.

A route, simulator view, and live-follow view that refer to the same vehicle definition should resolve to an equivalent model.

## 4. Formation logic

Formation decisions must be deterministic and reusable from the information available to both simulator and live-follow.

Examples include:

- double formations;
- articulated buses;
- multi-car formations.

Prefer pure helpers based on stable inputs such as `(line, cityId)` and wire those helpers into vehicle-definition resolution.

Do not duplicate formation logic separately in live mode and simulator mode.

## 5. Interior shell rules

Maintain the distinction between general passenger shells and cab-only shells.

- General opaque body panels belong in `passengerShells` and should be hidden in passenger and cab interior views.
- Cab-specific opaque parts belong in `cabShells` and should be hidden only in cab view.
- Glazing should normally remain outside both shell lists.
- Cab displays should follow the existing cab-view visibility policy.

Every opaque panel should be intentionally classified. Incorrect shell registration causes interior cameras to see the inside of the vehicle body or become blocked by their own cab geometry.

## 6. Camera anchoring

Inspect the current camera-rig implementation before assuming blueprint camera fields are active.

Verify how passenger anchors are actually obtained for the selected mode/vehicle. If the current implementation uses per-car `userData` anchors, set them on the correct car in procedural builders when custom placement is needed.

Verify at minimum:

- chase view;
- passenger view;
- cab view.

Watch for:

- camera clipping;
- seats, poles, dashboards, or noses blocking the camera;
- looking through exterior shells;
- reversed signage/displays;
- incorrect orientation on articulated cars;
- bad half-length or chase-camera spacing.

## 7. Live-follow parity

A vehicle change is not complete until it works in both:

- normal simulator/ride rendering;
- live-follow rendering.

Both should go through the same visual factory/registry path. Do not add live-only or simulator-only vehicle builders unless the architecture explicitly requires a placement-only distinction.

Changes that require parity checks include:

- new parts;
- door layouts;
- formations;
- camera anchors;
- shells;
- destination displays;
- lights;
- vehicle proportions.

## 8. Validation

Run the repository's current validation commands. At minimum, when applicable:

```bash
npm test
npm run build
```

Start the dev server and visually test the target design using explicit URL state when possible.

Verify:

- intended design/vehicle resolves;
- formation is correct;
- doors/windows are placed correctly;
- body and glazing visibility is correct;
- destination/next-stop displays are readable;
- day/night/exterior lights still work;
- chase/passenger/cab cameras work;
- simulator and live-follow produce equivalent rolling stock.

If the repository has a visual/parity harness, use it for refactors and add the new vehicle to its target set where appropriate.

## 9. Final report

When finished, report:

- construction approach chosen and why;
- files changed;
- registry/config wiring;
- formation logic;
- shell/camera handling;
- simulator/live-follow parity result;
- tests/build commands and results;
- visual verification performed;
- any remaining limitations or fallback behavior.

## Guardrails

Do not:

- bypass `VehicleVisualFactory` with feature-specific construction;
- duplicate vehicle-resolution logic in live mode;
- add procedural geometry for a change that is only materials/formation;
- add a new vehicle kind when a registered design id is sufficient;
- invent fake route objects merely to satisfy legacy builders;
- leave opaque body panels unclassified for interior presentation;
- assume schema fields are consumed without confirming the current runtime;
- claim parity or camera correctness without testing both simulator and live-follow when available.

When this skill conflicts with the current repository, prefer the current repository architecture and tests.
