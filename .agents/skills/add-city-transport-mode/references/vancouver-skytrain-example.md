# Adding a city and a transport mode

End-to-end recipe for putting a new city into the simulator, using the Vancouver
SkyTrain import as the worked example. Every step below is reproducible from a
clean checkout; nothing here was hand-edited into the generated feeds.

## Tools used

| Tool | Purpose |
| --- | --- |
| `curl` | Fetch the operator's static GTFS zip. |
| `tools/import-city-gtfs.mjs` | GTFS zip → route packages + route manifest. |
| `tools/enrich-route-terrain.mjs` | Adds DEM elevation, tunnel/bridge masks and a 3D track profile. |
| Mapzen Terrain Tiles (Terrarium, AWS Open Data) | Elevation source, sampled at zoom 13. |
| OpenFreeMap / OpenMapTiles vector tiles | `transportation` layer at zoom 14, used to classify tunnel vs. bridge. |

Both scripts are plain Node ESM and take no config beyond their arguments; the
per-city knobs live in the `presets` table inside `import-city-gtfs.mjs`.

## 1. Fetch the GTFS feed

Raw feeds are not committed (`data/raw/` is gitignored); download to a scratch
path.

```bash
curl -sSL -o /tmp/translink-gtfs.zip https://gtfs-static.translink.ca/gtfs/google_transit.zip
```

Inspect `routes.txt` to find the `route_type` values and route ids you want.
TransLink publishes the three SkyTrain lines as `route_type=1` (subway) with an
empty `route_short_name` and the line name only in `route_long_name`.

## 2. Add an importer preset

Add an entry to `presets` in `tools/import-city-gtfs.mjs` keyed by city id. Each
mode entry needs a `matchRoute` predicate plus the simulator-facing knobs:

```js
vancouver: {
  sourceUrl: 'https://gtfs-static.translink.ca/gtfs/google_transit.zip',
  license: '…',
  attribution: '…',
  modes: [{
    mode: 'skytrain',
    file: 'routes-skytrain.json',
    speedLimitMps: 22.0,   // 80 km/h line speed
    maxPoints: 240,        // shape decimation budget per route
    defaultAgency: 'TransLink',
    defaultColor: '#0033a0',
    matchRoute: (route) => route.route_type === '1'
  }]
}
```

Three optional hooks clean up operator-specific naming. They were added for this
import and are available to every preset:

- `lineLabel(route)` — line badge when `route_short_name` is unusable.
  SkyTrain: `route_long_name` minus the trailing `Line` → `Expo`, `Millennium`, `Canada`.
- `destinationLabel(headsign, route)` — headsign cleanup.
  SkyTrain: `"Expo Line To Waterfront"` → `Waterfront`.
- `stationLabel(name)` — stop-name cleanup.
  SkyTrain: `"Edmonds Station @ Platform 1"` → `Edmonds`.

The importer picks, per line and direction, the trip with the most stops, so
each route package is the longest published pattern rather than a short-turn.

## 3. Run the import

```bash
node tools/import-city-gtfs.mjs vancouver /tmp/translink-gtfs.zip public/data/vancouver
```

Writes `public/data/vancouver/routes-skytrain.json` and
`public/data/vancouver/route-manifest.json`. Existing modes in a manifest are
preserved, so modes can be imported one at a time. Result: 14 routes, 3 lines.

## 4. Enrich with terrain and elevation

```bash
node tools/enrich-route-terrain.mjs public/data/vancouver/routes-skytrain.json
```

For every `geoPoints` sample the enricher:

1. Samples the Terrarium DEM (zoom 13) and smooths the profile.
2. Loads the OpenMapTiles `transportation` layer (zoom 14, 3×3 tile neighbourhood)
   and classifies each point as `tunnel`, `bridge` or at grade from the nearest
   rail/subway/light-rail feature within 60 m.
3. Despeckles both masks (gap closing, short-run removal, a 100 m minimum tunnel
   length) so single stray samples do not punch holes in the profile.
4. Sinks tunnel sections up to 10 m below the surface with a 140 m ramp, and
   lifts bridge sections onto a flat deck.
5. Rewrites `controlPoints[i][1]` to the resulting track height and stores
   `elevationDatumM`, `surfaceHeightsM`, `tunnelMask`, `bridgeMask` and
   `tunnelRanges`.

The output feed is written back in place, and a pretty-printed mirror goes to
`data/generated/<city>/<file>` for review.

Two changes were needed for SkyTrain, both mode-gated:

- `skytrain` added to the `followsRails` list, so tunnel/bridge detection runs at
  all (Canada Line's Cambie bore and the Expo Line's downtown tunnel).
- `bridgeClearanceM` is 7.5 m for `skytrain` instead of the 1.5 m rail-bridge
  deck, because SkyTrain runs on a viaduct wherever it is not underground. On
  Expo Line → Waterfront, 214 of 240 samples classify as elevated.

Resulting elevation spread: 0–140 m, matching the climb from the Fraser
lowland to Production Way-University.

## 5. Register the transport mode

`src/domain/transport.ts`:

- add the mode id to `KNOWN_TRANSPORT_MODES` so URL state accepts it;
- add a `VehicleKind` only if the mode needs its own vehicle renderer.

Reuse an existing `GuidewayKind` unless the track geometry genuinely differs —
SkyTrain uses `s-bahn` (standard gauge, wide track spacing).

## 6. Add the city module

`src/cities/vancouver.ts` exports a `CityDefinition`: catalog metadata,
`transportModes`, a `routeManifestFallback` mirroring the generated manifest (so
the app still runs if the fetch fails), and `defaultLineByMode`.

Then register it in three places:

- `src/cities/index.ts` — the `registry` map, the `fallbackCatalog` list, and the re-export.
- `public/data/cities.json` — the catalog the app actually fetches.
- `data/generated/cities.json` — the reviewable mirror.

## 7. Add the vehicle

`vehicleKind` resolves through `VehicleRegistry` in this order: explicit
`vehicleDesignId` → `vehicleFamily` → registered kind builder → generic kind
fallback → final fallback. For SkyTrain:

- `buildTransitVehicle.ts` registers `skytrain` as a procedural kind builder;
- `procedural.ts` dispatches it to `createSkyTrainVehicle()`;
- a generic kind fallback maps `skytrain` to the S-Bahn blueprint, so the city
  still renders sane rolling stock if the SkyTrain builder is ever unregistered.

## 8. Verify

```bash
npm test
npm run dev
```

Then open the city with explicit URL state and step through all three camera
modes:

```
/?city=vancouver&transport=skytrain&route=15267013&station=9&view=ride&camera=chase
```

Check that opaque bodywork is registered in `passengerShells` (hidden in
passenger *and* cab views) and that only glazing sits in `cabShells`, otherwise
the interior views look into the inside of the vehicle's own nose.
