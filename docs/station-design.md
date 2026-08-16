# Station design

How a stop gets its appearance, and how island platforms work.

## Where a station comes from

A mode names a style (`stationStyleId` in its `TransportModeDefinition`); the
style resolves each route stop into a **visual definition** and builds it from
shared components.

```
route stop ──▶ provider.resolve() ──▶ StationVisualDefinition ──▶ provider.build()
                     ▲                                                  │
                catalog entry                                    component kit
```

| Style | Catalog | Used by |
|---|---|---|
| `vvs-stadtbahn` | `styles/vvs/configs/vvs-stadtbahn-stations.json` | Stuttgart Stadtbahn, and as the fallback for every other `stadtbahn` city |
| `db-sbahn` | `styles/db/configs/db-sbahn-stations.json` | Stuttgart S-Bahn |

Both run the **same component kit** under `styles/vvs/components/`. A style is
an id, a boarding height, and whether the stops carry SSB street furniture
(`VvsStationStyleOptions`); everything else is data. Catalogs are registered in
`stations/catalogs.ts`, which is also what `hallExtent` and `trackLayout` read,
so a style cannot describe a station one way and have the world build the
ground around it another.

Catalogs are keyed by the **exact stop name in the route feed**. A key that does
not match is silently inert, so check after editing:

```bash
node -e "const f=require('./public/data/routes-stadtbahn.json'),c=require('./src/world/stations/styles/vvs/configs/vvs-stadtbahn-stations.json');const n=new Set(f.routes.flatMap(r=>r.stations.map(s=>s.name)));console.log(Object.keys(c.stations).filter(k=>!n.has(k)))"
```

A stop with no catalog entry still builds: the archetype supplies defaults and
`variation.ts` fills appearance-only counts from a seed derived from the stop
name, so it is stable across sessions. **Seeding never touches topology** —
layout, dimensions, height and accessibility are authored or not present.

## What a catalog entry can say

```jsonc
"Sillenbuch": {
  "archetype": "underground-island",     // drives structure: terminus buffers,
                                          // cutting walls, interchange canopies
  "platform": {
    "layout": "island",                  // side | island | mixed
    "lengthM": 80, "widthM": 9.5,
    "heightM": 0.8,                      // 0.8 Stadtbahn, 0.96 S-Bahn, 0.22 tram kerb
    "staggerM": 12,                      // side platforms offset along the route
    "surfaceFinish": "block-paving"
  },
  "architecture": {
    "hall":    { "widthM": 20, "heightM": 4.6,
                 "ceiling": "flat-slab | coffered | ribbed-metal
                           | trussed-vault | metal-vault" },
    "walls":   { "finish": "concrete | enamel-panel | tile",
                 "color": "#c8102e",     // identity colour of the cladding field
                 "plinthColor": "…",
                 "bandColor": "…",     // band the repeated name sits in
                 "mural": "film-strip" },// artwork, independent of the finish
    "columns": { "style": "none | square | round", "color": "…", "spacingM": 18 },
    "lighting":{ "style": "strip-segments | strip-continuous | recessed-rows" },
    "canopy":  { "style": "flat-slab | butterfly | curved-shell",
                 "fasciaColor": "…", "postColor": "…", "nameOnFascia": true },
    "roof": "none | short-canopy | full-canopy | hall",
    "accentColor": "#…"
  },
  "access":   [{ "type": "escalator|stairs|lift|ramp|crossing",
                 "side": "left|right|center", "offsetM": 24, "direction": "…" }],
  "signage":  { "exits": […], "platformNumber": "1", "nameBandRepeatM": 34,
                "totem": false, "lines": ["U6"] },
  "furniture":{ "benches": 2, "bins": 2, "ticketMachines": 2,
                "dfiDisplays": 3, "adVitrines": 4, "lampColumns": 2,
                "infoKiosk": true },
  "environment": { "retainingWall": "both", "edgeParapet": "wall",
                   "plaza": true, "vegetation": "urban" }
}
```

`access` is topology, not decoration: where you can leave a station is authored,
never seeded. Underground runs rise into a **capped shaft**, so the opening
never shows the void above the box.

## Islands

Most stops are two side platforms outside the tracks. An island is one deck
*between* them — which means the tracks themselves have to move, and station
code does not own track geometry.

```
        side layout                     island layout
   ▓▓▓▓▓  ══   ══  ▓▓▓▓▓            ══      ▓▓▓▓▓▓▓      ══
   deck  track track deck          track      deck      track
         ±2.1 m                    ±(w/2 + car half-width)
```

`world/trackSpread.ts` holds a **lateral profile** along the route: zones where
the tracks ease apart and back together. `stations/trackLayout.ts` builds those
zones from the same catalog the station builder reads:

```
spread = platformWidth/2 + vehicleHalfWidth − trackOffset
```

Per guideway, because an S-Bahn car is wider and takes the transition faster:

| | car half-width | track offset | taper |
|---|---|---|---|
| Stadtbahn | 1.30 m | 2.10 m | 30 m (≈1:9) |
| S-Bahn | 1.55 m | 2.35 m | 45 m |

**Everything that follows a track must read the profile** or it drifts out of
the tunnel: ballast, rails, sleepers, the player vehicle, oncoming services and
the chase-camera anchor. `trackPose` also tilts the cars by the lateral rate, or
they keep pointing down the alignment and crab into the platform.

Islands only apply to a mode that **names its style**, so a stop name shared
with another city can never re-lay that city's tracks.

Marking a stop as an island is one field:

```jsonc
"platform": { "layout": "island", "widthM": 9 }
```

Keep an archetype that drives structure (`terminus`, `cutting`,
`surface-interchange`) — buffer stops move onto the spread tracks, trough walls
follow the deck. `mixed` is not an island: it draws the ~1.4 m walkway that
actually fits between two normal tracks.

### Underground islands

The box must contain the taper, or the bore would start where the tracks are
still swinging together. `stations/hallExtent.ts` is the **single source of
truth** for box length, read by both the station builder and `GuidewayLayer`'s
bore cut:

```
half length = max(minimum, platform/2 + margin, platform/2 + clearance + taper + margin)
```

If those two ever disagree you get daylight at the bore mouth, or slabs across
the inside of the bore.

## Route data

Undergroundness comes from the route feed (`tunnelRanges`), never from the
archetype: a stop marked `cutting` still renders underground if the route says
so. Depth comes from `controlPoints[i].y` against `surfaceHeightsM[i]`, and is
repaired by `tools/fix-tunnel-station-depth.mjs` — run it after
`enrich-route-terrain.mjs`, which rewrites control points from the tiles and
would undo it. See `docs/` history or the tool's own header for what it fixes.

## Adding a station

1. Find the stop's **exact feed name**.
2. Add or edit its catalog entry; start from a neighbour with a similar form.
3. `npm test` — the catalog is covered by `stations/stationStyle.test.ts`.
4. Reload the page. The catalog is a static JSON import, so **HMR will not
   rebuild existing station meshes** — a full reload is required.

Photographs are the reference for colours, ceiling type, column form and
lighting. Where a station's defining feature is not yet in the kit, add it to
the kit rather than approximating — Killesberg's Kodak filmstrip became
`walls.mural` (three instanced runs, so a long wall stays three draw calls),
and the airport station's clad soffit became the `metal-vault` ceiling.

Two stops can share a name across networks: `Flughafen/Messe` is a surface
Stadtbahn terminus and an underground S-Bahn vault. They stay distinct because
each style reads its own catalog — never add one network's stop to the other's
file.
