---
name: add-city-transport-mode
description: Add a new city or transport mode to the Transit Simulator from a static GTFS feed. Use when importing GTFS routes, creating importer presets, enriching routes with terrain/tunnel/bridge data, registering transport modes, adding city definitions, wiring vehicle renderers, or validating a newly imported city. Also use when asked to reproduce the Vancouver SkyTrain import workflow for another operator or city.
---

# Add a city or transport mode

Use this workflow when adding a new city, operator, route family, or transport
mode to the Transit Simulator.

The goal is to produce the integration from source GTFS data and existing
generation tools. Do not hand-edit generated route feeds to make the result
look correct.

For the complete Vancouver SkyTrain worked example, read:

- [references/vancouver-skytrain-example.md](references/vancouver-skytrain-example.md)

## Principles

- Treat GTFS as the source of truth for routes, trips, stops, shapes and names.
- Prefer extending generic importer/enrichment behavior over adding one-off
  generated-data patches.
- Keep operator-specific behavior inside the city importer preset or explicit
  mode-specific configuration.
- Do not commit raw GTFS archives unless the repository explicitly requires it.
- Preserve existing modes when regenerating a city's route manifest.
- Reuse existing guideway and vehicle abstractions where appropriate.
- Add a new renderer/domain kind only when the existing abstractions cannot
  represent the mode correctly.
- Never manually edit generated route JSON as the implementation strategy.

## 1. Inspect the repository first

Before modifying anything, locate and inspect:

- `tools/import-city-gtfs.mjs`
- the `presets` table used by the importer
- `tools/enrich-route-terrain.mjs`
- `src/domain/transport.ts`
- `src/cities/index.ts`
- one or two existing city definitions
- `public/data/cities.json`
- `data/generated/cities.json`
- the vehicle registry/builders
- tests related to city registration, GTFS imports and vehicle construction

Do not assume file contents solely from this skill if the repository has
evolved.

Use existing project conventions when they differ from the worked example.

## 2. Acquire and inspect GTFS

Obtain the static GTFS feed from the operator-provided source.

Prefer a temporary location such as:

```bash
curl -sSL -o /tmp/<city>-gtfs.zip <gtfs-url>
```

Inspect at least:

- `agency.txt`
- `routes.txt`
- `trips.txt`
- `stops.txt`
- `stop_times.txt`
- `shapes.txt`

Determine:

- relevant `route_type` values;
- route IDs/names;
- whether `route_short_name` is usable;
- headsign conventions;
- stop/platform naming conventions;
- agencies represented;
- which modes should be imported.

Do not guess operator-specific values when the GTFS feed can answer them.

## 3. Add or update the importer preset

Add the city to the `presets` table in `tools/import-city-gtfs.mjs`.

Each imported mode should define the existing required preset fields, normally
including:

- simulator mode id;
- generated route filename;
- speed limit;
- shape point budget;
- default agency;
- default color;
- `matchRoute` predicate.

Use optional naming hooks when the source GTFS needs cleanup:

- `lineLabel(route)`
- `destinationLabel(headsign, route)`
- `stationLabel(name)`

Keep operator-specific naming rules inside the preset rather than embedding
them in shared application code.

The importer should continue selecting representative route patterns according
to the repository's existing policy.

## 4. Generate route packages

Run the importer using the repository's actual command form:

```bash
node tools/import-city-gtfs.mjs <city-id> <gtfs.zip> public/data/<city-id>
```

Verify:

- expected route package files exist;
- `route-manifest.json` exists;
- existing modes were preserved;
- route count is plausible;
- line labels and destinations are meaningful;
- stop names are clean;
- route geometry is present.

Do not fix generation errors by manually modifying generated JSON.

## 5. Enrich terrain and infrastructure

Run:

```bash
node tools/enrich-route-terrain.mjs public/data/<city-id>/<routes-file>.json
```

Inspect how the current enricher handles:

- Terrarium/Mapzen elevation;
- OpenMapTiles `transportation` features;
- tunnel masks;
- bridge masks;
- track height profiles;
- tunnel ramps;
- bridge clearances;
- mode gating.

If the new mode requires terrain behavior not currently enabled, extend the
shared enricher using an explicit mode-specific rule.

Do not globally change bridge/tunnel behavior to accommodate one network unless
the new behavior is genuinely universal.

Verify elevation profiles and infrastructure masks against known geography or
obvious source-data features.

## 6. Register the transport mode

Update `src/domain/transport.ts` according to the current domain model.

Normally:

- add the mode id to the accepted/known transport modes;
- add a `VehicleKind` only when a dedicated renderer is required;
- reuse an existing `GuidewayKind` unless track/guideway geometry truly differs.

Do not create nearly identical domain kinds solely because the operator uses a
different marketing name.

## 7. Add the city definition

Create or update:

```text
src/cities/<city-id>.ts
```

Define the city's current `CityDefinition`, including as applicable:

- catalog metadata;
- transport modes;
- route manifest fallback;
- default line by mode;
- live traffic configuration if supported.

Register the city everywhere required by the current repository.

At minimum inspect whether registration is required in:

```text
src/cities/index.ts
public/data/cities.json
data/generated/cities.json
```

Do not assume this list remains exhaustive: search for existing city IDs and
follow the current registration pattern.

Keep `routeManifestFallback` synchronized with the generated manifest.

## 8. Add or map the vehicle

Inspect `VehicleRegistry` and the current vehicle construction path.

Prefer, in order:

1. an explicit existing vehicle design when appropriate;
2. an existing vehicle family;
3. a dedicated registered builder when visually required;
4. an existing generic fallback.

If adding a procedural vehicle:

- register the vehicle kind;
- connect it to the procedural dispatch;
- provide a sensible generic fallback where the architecture supports one.

Do not make the entire city fail to render because its specialized vehicle
builder is unavailable.

## 9. Verify camera/interior behavior

Test every supported camera mode for the new vehicle.

At minimum verify:

- chase view;
- passenger view;
- cab view.

Pay particular attention to camera shell registration.

Opaque vehicle bodywork that blocks interior cameras should use the existing
passenger-shell mechanism. Only geometry intended to be hidden specifically
from the cab camera should use the cab-shell mechanism.

Watch for:

- looking through the vehicle nose;
- opaque shells surrounding the camera;
- reversed signage;
- camera clipping;
- seats/poles blocking the default camera;
- incorrect vehicle orientation.

## 10. Run validation

Run the repository's current validation commands.

At minimum, when still applicable:

```bash
npm test
npm run build
```

Run more focused importer/unit tests when available.

Start the application and open the new city with explicit URL state rather
than relying only on defaults.

Test:

- every imported mode;
- multiple directions/routes;
- representative stations;
- chase/passenger/cab cameras;
- terrain transitions;
- tunnels;
- bridges/elevated sections;
- terminal behavior.

## 11. Final report

When finished, report:

- files changed;
- GTFS source used;
- modes and GTFS route types imported;
- number of generated routes;
- naming transformations added;
- terrain/enrichment changes;
- transport/guideway mappings;
- vehicle implementation/fallback;
- city registration changes;
- validation commands and results;
- remaining data-quality or visual issues.

Call out any generated files that changed.

## Guardrails

Do not:

- hand-edit generated feeds as the final solution;
- invent GTFS IDs, route types or stop names;
- silently overwrite existing city modes;
- make operator-specific naming logic global;
- add a new guideway kind without a geometric reason;
- add a new vehicle kind when an existing abstraction is sufficient;
- commit downloaded raw GTFS unless project policy says to;
- claim successful visual verification if the application was not actually run.

When source data and this skill disagree, prefer the current repository and
actual GTFS data.
