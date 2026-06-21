import './style.css';
import { createRouteCurve, demoRoute, loadRoutePackages, type DemoRoute } from './route';
import { VehicleMiniMap } from './minimap';
import { TransitRouteDiagram } from './route-diagram';
import { TransitWorld } from './world';
import { routeTransportMode, transportModeDefinitions, transportModeLabel, type TransportMode } from './domain/transport';
import {
  initSimulator,
  loadSimulatorWasm,
  resetSimulator,
  setDriverInput,
  setSimulatorPaused,
  stepSimulator,
  type SimulatorState
} from './wasm';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';
type Mode = 'ride' | 'driver';

const TERMINAL_TURNAROUND_MS = 4000;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');
const appEl = app;

const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'Loading VVS GTFS route packages...';
document.body.appendChild(loading);

const hud = document.createElement('div');
hud.className = 'hud';
hud.innerHTML = `
  <div class="hud-header">
    <div><h1>Stuttgart Transit Simulator</h1><div class="label">Free, non-commercial simulator</div></div>
    <button class="menu-toggle" data-action="menu" aria-expanded="true" aria-label="Collapse menu">−</button>
  </div>
  <div class="hud-content">
    <div class="transport-tabs" role="tablist" aria-label="Means of transport">
      ${transportModeDefinitions.map((definition) => `<button role="tab" data-mode-tab="${definition.id}" ${definition.available ? '' : 'disabled'}>${definition.label}</button>`).join('')}
    </div>
    <div class="toolbar">
      <select data-action="route" aria-label="Line"></select>
      <select data-action="station" aria-label="Start station"></select>
      <select data-action="mode" aria-label="Mode">
        <option value="ride">Ride</option>
        <option value="driver">Drive</option>
      </select>
      <select data-action="season" aria-label="Season">
        <option value="spring">Spring</option><option value="summer" selected>Summer</option>
        <option value="autumn">Autumn</option><option value="winter">Winter</option>
      </select>
      <select data-action="time" aria-label="Time of day">
        <option value="auto" selected>Local time (auto)</option>
        <option value="6">06:00 · Dawn</option><option value="9">09:00 · Morning</option>
        <option value="13">13:00 · Day</option><option value="18">18:00 · Evening</option>
        <option value="22">22:00 · Night</option>
      </select>
    </div>
    <div class="meta">
      <div class="card"><div class="label">Line</div><div class="value" data-field="line">-</div></div>
      <div class="card"><div class="label">Speed</div><div class="value" data-field="speed">-</div></div>
      <div class="card"><div class="label">Next station</div><div class="value" data-field="station">-</div></div>
      <div class="card"><div class="label">Doors</div><div class="value" data-field="doors">-</div></div>
      <div class="card driver-stat"><div class="label">Score</div><div class="value" data-field="score">-</div></div>
      <div class="card driver-stat"><div class="label">Schedule</div><div class="value" data-field="schedule">-</div></div>
    </div>
    <div class="controls">
      <button data-action="pause">Pause</button><button data-action="camera">Camera</button><button data-action="reset">Restart</button>
    </div>
    <div class="driver-controls" data-panel="driver">
      <button data-drive="throttle">Throttle</button><button data-drive="brake">Brake</button>
      <div class="hint">W/ArrowUp throttle · S/ArrowDown brake</div>
    </div>
  </div>
`;
document.body.appendChild(hud);

const rightRail = document.createElement('div');
rightRail.className = 'right-rail';
document.body.appendChild(rightRail);

const routeDiagramEl = document.createElement('section');
routeDiagramEl.className = 'route-diagram';
rightRail.appendChild(routeDiagramEl);
const routeDiagram = new TransitRouteDiagram(routeDiagramEl);

const notice = document.createElement('div');
notice.className = 'notice';
document.body.appendChild(notice);

const miniMapEl = document.createElement('div');
miniMapEl.className = 'minimap';
document.body.appendChild(miniMapEl);

let availableRoutes: DemoRoute[] = [demoRoute];
let gtfsAttribution = 'VVS GTFS route package has not loaded yet.';
let selectedRoute = demoRoute;
let selectedTransportMode: TransportMode = 'stadtbahn';
let selectedMode: Mode = 'ride';
let selectedSeason: Season = 'summer';
let selectedTime: 'auto' | number = 'auto';
let selectedStartStation = 0;
let paused = false;
let state: SimulatorState | null = null;
let world: TransitWorld | null = null;
let miniMap: VehicleMiniMap | null = null;
let lastFrame = performance.now();
let lastClockUpdateMs = 0;
let throttleHeld = false;
let brakeHeld = false;
let terminalReachedAt: number | null = null;

function updateRouteOptions(): void {
  const select = hud.querySelector<HTMLSelectElement>('[data-action="route"]')!;
  const visibleRoutes = availableRoutes.filter((route) => routeTransportMode(route.transportMode) === selectedTransportMode);
  select.innerHTML = visibleRoutes
    .map((route) => {
      const label = `${route.line} to ${route.destination}`;
      return `<option value="${route.id}">${label}</option>`;
    })
    .join('');
  select.value = selectedRoute.id;
  for (const button of hud.querySelectorAll<HTMLButtonElement>('[data-mode-tab]')) {
    const selected = button.dataset.modeTab === selectedTransportMode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
}

function updateStationOptions(): void {
  const select = hud.querySelector<HTMLSelectElement>('[data-action="station"]')!;
  const usableStations = selectedRoute.stations.slice(0, Math.max(1, selectedRoute.stations.length - 1));
  select.innerHTML = usableStations
    .map((station, index) => `<option value="${index}">${station.name}</option>`)
    .join('');
  selectedStartStation = Math.min(selectedStartStation, usableStations.length - 1);
  select.value = String(selectedStartStation);
}

function routeConfig(route: DemoRoute) {
  return {
    line: route.line,
    destination: route.destination,
    speedLimitMps: route.speedLimitMps,
    routeLengthM: route.routeLengthM,
    stations: route.stations,
    mode: selectedMode,
    startStationIndex: selectedStartStation
  };
}

function findOppositeRoute(route: DemoRoute): DemoRoute | undefined {
  const origin = route.stations[0]?.name;
  const terminal = route.stations.at(-1)?.name;
  const candidates = availableRoutes.filter((candidate) =>
    candidate.line === route.line &&
    routeTransportMode(candidate.transportMode) === routeTransportMode(route.transportMode) &&
    candidate.id !== route.id
  );
  const bestMatch = candidates
    .map((candidate) => {
      const candidateOrigin = candidate.stations[0]?.name;
      const candidateTerminal = candidate.stations.at(-1)?.name;
      let score = 0;
      if (candidateOrigin === terminal) score += 8;
      if (candidateTerminal === origin) score += 8;
      if (candidate.destination === origin) score += 4;
      score -= Math.abs(candidate.stations.length - route.stations.length) * 0.05;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score)[0];
  return bestMatch && bestMatch.score >= 16 ? bestMatch.candidate : undefined;
}

function startOppositeRide(): void {
  const opposite = findOppositeRoute(selectedRoute);
  if (!opposite) {
    terminalReachedAt = Number.POSITIVE_INFINITY;
    return;
  }
  selectedRoute = opposite;
  selectedStartStation = 0;
  updateRouteOptions();
  updateStationOptions();
  startSelectedRide();
}

function rebuildWorld(route: DemoRoute): void {
  world?.dispose();
  appEl.replaceChildren();
  world = new TransitWorld(createRouteCurve(route), route, availableRoutes);
  world.mount(appEl);
  world.setSeason(selectedSeason);
  world.setTimeOfDay(selectedTime === 'auto' ? currentLocalHour() : selectedTime);

  if (!miniMap) {
    miniMap = new VehicleMiniMap(miniMapEl);
  }
  miniMap.setRoute(route);
  routeDiagram.setRoute(route);
  window.setTimeout(() => miniMap?.invalidateSize(), 0);
}

function updateHud(s: SimulatorState): void {
  hud.querySelector('[data-field="line"]')!.textContent = `${s.line} -> ${s.destination}`;
  hud.querySelector('[data-field="speed"]')!.textContent = `${Math.round(s.speedMps * 3.6)} km/h`;
  hud.querySelector('[data-field="station"]')!.textContent = s.tripComplete ? 'Trip complete' : s.nextStation;
  hud.querySelector('[data-field="doors"]')!.textContent = s.doorsOpen ? `Open ${s.dwellRemainingS.toFixed(0)}s` : 'Closed';
  hud.querySelector('[data-field="score"]')!.textContent = s.mode === 'driver' ? String(s.driverScore) : '-';
  hud.querySelector('[data-field="schedule"]')!.textContent =
    s.mode === 'driver' ? `${s.timetableDeltaS >= 0 ? '+' : ''}${s.timetableDeltaS.toFixed(0)}s` : '-';
  hud.classList.toggle('driver-mode', s.mode === 'driver');
  routeDiagram.update(s);
}

function updateNotice(): void {
  notice.textContent = `${transportModeLabel(routeTransportMode(selectedRoute.transportMode))} · ${selectedRoute.agency ?? 'SSB'} · ${selectedRoute.description} Free non-commercial simulator. Source: ${selectedRoute.source ?? 'demo route'}. ${gtfsAttribution} Vector 3D scenery: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Relief: Mapzen Terrain Tiles on AWS Open Data.`;
}

function currentLocalHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

function setDriveInput(): void {
  if (selectedMode !== 'driver') return;
  state = setDriverInput(throttleHeld ? 1 : 0, brakeHeld ? 1 : 0);
  updateHud(state);
}

function startSelectedRide(): void {
  terminalReachedAt = null;
  rebuildWorld(selectedRoute);
  state = initSimulator(routeConfig(selectedRoute));
  updateHud(state);
  updateNotice();
  loading.classList.add('hidden');
  paused = false;
}

function selectTransportMode(mode: TransportMode): void {
  const routes = availableRoutes.filter((route) => routeTransportMode(route.transportMode) === mode);
  if (routes.length === 0) return;
  selectedTransportMode = mode;
  selectedRoute = routes[0];
  selectedStartStation = 0;
  updateRouteOptions();
  updateStationOptions();
  startSelectedRide();
}

hud.querySelector<HTMLButtonElement>('[data-action="menu"]')?.addEventListener('click', (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const collapsed = hud.classList.toggle('collapsed');
  button.textContent = collapsed ? '+' : '−';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? 'Expand menu' : 'Collapse menu');
});

for (const button of hud.querySelectorAll<HTMLButtonElement>('[data-mode-tab]')) {
  button.addEventListener('click', () => selectTransportMode(button.dataset.modeTab as TransportMode));
}

hud.querySelector<HTMLButtonElement>('[data-action="pause"]')?.addEventListener('click', () => {
  paused = !paused;
  state = setSimulatorPaused(paused);
  hud.querySelector<HTMLButtonElement>('[data-action="pause"]')!.textContent = paused ? 'Resume' : 'Pause';
  updateHud(state);
});

hud.querySelector<HTMLButtonElement>('[data-action="camera"]')?.addEventListener('click', () => {
  world?.cycleCamera();
  if (state && world) {
    world.updateTrain(state.distanceM, state.doorsOpen, 1 / 60, state.nextStation);
    world.render();
  }
});

hud.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('click', startSelectedRide);

hud.querySelector<HTMLSelectElement>('[data-action="route"]')?.addEventListener('change', (event) => {
  const id = (event.target as HTMLSelectElement).value;
  selectedRoute = availableRoutes.find((route) => route.id === id) ?? availableRoutes[0];
  selectedStartStation = 0;
  updateStationOptions();
  startSelectedRide();
});

hud.querySelector<HTMLSelectElement>('[data-action="station"]')?.addEventListener('change', (event) => {
  selectedStartStation = Number((event.target as HTMLSelectElement).value);
  startSelectedRide();
});

hud.querySelector<HTMLSelectElement>('[data-action="mode"]')?.addEventListener('change', (event) => {
  selectedMode = (event.target as HTMLSelectElement).value as Mode;
  startSelectedRide();
});

hud.querySelector<HTMLSelectElement>('[data-action="season"]')?.addEventListener('change', (event) => {
  selectedSeason = (event.target as HTMLSelectElement).value as Season;
  world?.setSeason(selectedSeason);
});
hud.querySelector<HTMLSelectElement>('[data-action="time"]')?.addEventListener('change', (event) => {
  const value = (event.target as HTMLSelectElement).value;
  selectedTime = value === 'auto' ? 'auto' : Number(value);
  world?.setTimeOfDay(selectedTime === 'auto' ? currentLocalHour() : selectedTime);
});

for (const button of hud.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
  const kind = button.dataset.drive;
  const setHeld = (held: boolean) => {
    if (kind === 'throttle') throttleHeld = held;
    if (kind === 'brake') brakeHeld = held;
    setDriveInput();
  };
  button.addEventListener('pointerdown', () => setHeld(true));
  button.addEventListener('pointerup', () => setHeld(false));
  button.addEventListener('pointerleave', () => setHeld(false));
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.key === 'w' || event.key === 'ArrowUp') throttleHeld = true;
  if (event.key === 's' || event.key === 'ArrowDown') brakeHeld = true;
  setDriveInput();
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'w' || event.key === 'ArrowUp') throttleHeld = false;
  if (event.key === 's' || event.key === 'ArrowDown') brakeHeld = false;
  setDriveInput();
});

async function start(): Promise<void> {
  const loaded = await loadRoutePackages();
  availableRoutes = loaded.routes;
  gtfsAttribution = loaded.attribution;
  selectedRoute = availableRoutes.find((route) => routeTransportMode(route.transportMode) === 'stadtbahn') ?? availableRoutes[0];
  selectedTransportMode = routeTransportMode(selectedRoute.transportMode);
  updateRouteOptions();
  updateStationOptions();

  loading.textContent = 'Loading Go/WASM simulator...';
  await loadSimulatorWasm();
  startSelectedRide();
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (state && world) {
    if (selectedTime === 'auto' && now - lastClockUpdateMs > 60_000) {
      world.setTimeOfDay(currentLocalHour());
      lastClockUpdateMs = now;
    }
    if (!paused) {
      state = stepSimulator(dt);
    }
    world.updateTrain(state.distanceM, state.doorsOpen, dt, state.nextStation);
    miniMap?.update(state.distanceM);
    updateHud(state);
    world.render();

    if (state.tripComplete) {
      terminalReachedAt ??= now;
      if (now - terminalReachedAt >= TERMINAL_TURNAROUND_MS) {
        startOppositeRide();
      }
    } else {
      terminalReachedAt = null;
    }
  }
  requestAnimationFrame(frame);
}

start().catch((error: unknown) => {
  loading.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
