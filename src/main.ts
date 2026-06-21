import './style.css';
import { createRouteCurve, demoRoute, loadRoutePackages, type DemoRoute } from './route';
import { VehicleMiniMap } from './minimap';
import { SsbRouteDiagram } from './route-diagram';
import { StadtbahnWorld } from './world';
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

const FREE_RIDES = 3;
const ENTITLEMENT_KEY = 'ssim.entitlement.v3';
const TERMINAL_TURNAROUND_MS = 4000;

type Entitlement = {
  usedFreeRides: number;
  rideCredits: number;
  member: boolean;
};

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
  <h1>Stuttgart Stadtbahn Simulator</h1>
  <div class="label">Route packages · ticket mock · driver tariff</div>
  <div class="toolbar">
    <select data-action="route" aria-label="Line">
    </select>
    <select data-action="station" aria-label="Start station">
    </select>
    <select data-action="mode" aria-label="Mode">
      <option value="ride">Ride</option>
      <option value="driver">Driver tariff</option>
    </select>
    <select data-action="season" aria-label="Season">
      <option value="spring">Spring</option>
      <option value="summer" selected>Summer</option>
      <option value="autumn">Autumn</option>
      <option value="winter">Winter</option>
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
    <button data-action="pause">Pause</button>
    <button data-action="camera">Camera</button>
    <button data-action="reset">Restart</button>
  </div>
  <div class="driver-controls" data-panel="driver">
    <button data-drive="throttle">Throttle</button>
    <button data-drive="brake">Brake</button>
    <div class="hint">W/ArrowUp throttle · S/ArrowDown brake</div>
  </div>
`;
document.body.appendChild(hud);

const rightRail = document.createElement('div');
rightRail.className = 'right-rail';
document.body.appendChild(rightRail);

const ticketPanel = document.createElement('div');
ticketPanel.className = 'ticket-panel';
ticketPanel.innerHTML = `
  <div>
    <div class="label">Ride access</div>
    <div class="ticket-copy" data-field="ticket">-</div>
  </div>
  <div class="ticket-actions">
    <button data-action="buy-ride">+ EUR 0.20 ride</button>
    <button data-action="membership">EUR 8 month</button>
  </div>
`;
rightRail.appendChild(ticketPanel);

const routeDiagramEl = document.createElement('section');
routeDiagramEl.className = 'route-diagram';
rightRail.appendChild(routeDiagramEl);
const routeDiagram = new SsbRouteDiagram(routeDiagramEl);

const notice = document.createElement('div');
notice.className = 'notice';
document.body.appendChild(notice);

const miniMapEl = document.createElement('div');
miniMapEl.className = 'minimap';
document.body.appendChild(miniMapEl);

let availableRoutes: DemoRoute[] = [demoRoute];
let gtfsAttribution = 'VVS GTFS route package has not loaded yet.';
let selectedRoute = demoRoute;
let selectedMode: Mode = 'ride';
let selectedSeason: Season = 'summer';
let selectedStartStation = 0;
let paused = false;
let state: SimulatorState | null = null;
let world: StadtbahnWorld | null = null;
let miniMap: VehicleMiniMap | null = null;
let lastFrame = performance.now();
let throttleHeld = false;
let brakeHeld = false;
let entitlement = loadEntitlement();
let rideAccessConsumedForSession = false;
let terminalReachedAt: number | null = null;

function loadEntitlement(): Entitlement {
  const fallback: Entitlement = { usedFreeRides: 0, rideCredits: 0, member: false };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(ENTITLEMENT_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

function saveEntitlement(): void {
  localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(entitlement));
}

function canStartRide(): boolean {
  return entitlement.member || entitlement.rideCredits > 0 || entitlement.usedFreeRides < FREE_RIDES || selectedMode === 'driver';
}

function consumeRideIfNeeded(): void {
  if (selectedMode === 'driver' || entitlement.member || rideAccessConsumedForSession) return;
  if (entitlement.rideCredits > 0) {
    entitlement.rideCredits--;
  } else if (entitlement.usedFreeRides < FREE_RIDES) {
    entitlement.usedFreeRides++;
  }
  rideAccessConsumedForSession = true;
  saveEntitlement();
}

function updateTicketPanel(): void {
  const freeLeft = Math.max(0, FREE_RIDES - entitlement.usedFreeRides);
  const access = entitlement.member
    ? 'Membership active. Unlimited simulator rides this month.'
    : `${freeLeft} free rides left · ${entitlement.rideCredits} paid ride credits`;
  ticketPanel.querySelector('[data-field="ticket"]')!.textContent =
    selectedMode === 'driver' ? 'Driver tariff preview: training mode is open in this prototype.' : access;
}

function updateRouteOptions(): void {
  const select = hud.querySelector<HTMLSelectElement>('[data-action="route"]')!;
  select.innerHTML = availableRoutes
    .map((route) => {
      const label = `${route.line} to ${route.destination}`;
      return `<option value="${route.id}">${label}</option>`;
    })
    .join('');
  select.value = selectedRoute.id;
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
  const candidates = availableRoutes.filter((candidate) => candidate.line === route.line && candidate.id !== route.id);
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
  world = new StadtbahnWorld(createRouteCurve(route), route, availableRoutes);
  world.mount(appEl);
  world.setSeason(selectedSeason);

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
  notice.textContent = `${selectedRoute.description} Source: ${selectedRoute.source ?? 'demo route'}. ${gtfsAttribution} Vector 3D scenery: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Untextured relief: Mapzen Terrain Tiles on AWS Open Data.`;
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

  if (!canStartRide()) {
    paused = true;
    state = setSimulatorPaused(true);
    world?.updateTrain(state.distanceM, state.doorsOpen, 1 / 60, state.nextStation);
    miniMap?.update(state.distanceM);
    world?.render();
    updateHud(state);
    notice.textContent = 'Free rides used. Add a EUR 0.20 ride credit or enable the EUR 8 monthly membership mock to continue ride mode.';
    updateTicketPanel();
    return;
  }

  consumeRideIfNeeded();
  paused = false;
  updateTicketPanel();
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

ticketPanel.querySelector<HTMLButtonElement>('[data-action="buy-ride"]')?.addEventListener('click', () => {
  entitlement.rideCredits++;
  saveEntitlement();
  loading.classList.add('hidden');
  updateTicketPanel();
  if (selectedMode === 'ride') startSelectedRide();
});

ticketPanel.querySelector<HTMLButtonElement>('[data-action="membership"]')?.addEventListener('click', () => {
  entitlement.member = !entitlement.member;
  saveEntitlement();
  loading.classList.add('hidden');
  updateTicketPanel();
  if (selectedMode === 'ride' && entitlement.member) startSelectedRide();
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
  selectedRoute = availableRoutes[0];
  updateRouteOptions();
  updateStationOptions();

  loading.textContent = 'Loading Go/WASM simulator...';
  await loadSimulatorWasm();
  updateTicketPanel();
  startSelectedRide();
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (state && world) {
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
