import { VehicleMiniMap } from '../minimap';
import { TransitRouteDiagram } from '../route-diagram';
import {
  createRouteCurve,
  demoRoute,
  loadRouteManifest,
  loadRoutesForMode,
  routeMode,
  type DemoRoute,
  type RouteFeedManifest
} from '../route';
import { transportModeLabel, type TransportMode } from '../domain/transport';
import { TransitWorld } from '../world';
import { createInitialAppState, type AppState } from './AppState';
import { SimulatorLoop } from './SimulatorLoop';
import { HudView } from '../ui/HudView';
import { SimulatorClient } from '../simulator/SimulatorClient';
import type { SimulatorConfig, SimulatorState } from '../simulator/simulator-types';

const TERMINAL_TURNAROUND_MS = 4000;
const DEFAULT_LINE_BY_MODE: Partial<Record<TransportMode, string>> = {
  stadtbahn: 'U12',
  bus: '43',
  's-bahn': 'S1'
};

export class AppController {
  private readonly hud = new HudView(document.body);
  private readonly simulator = new SimulatorClient();
  private readonly rightRail = document.createElement('div');
  private readonly routeDiagramEl = document.createElement('section');
  private readonly miniMapEl = document.createElement('div');
  private readonly routeDiagram: TransitRouteDiagram;
  private readonly miniMap: VehicleMiniMap;
  private readonly state: AppState = createInitialAppState(demoRoute);
  private readonly routesByMode = new Map<TransportMode, DemoRoute[]>();
  private world: TransitWorld | null = null;
  private manifest: RouteFeedManifest | null = null;
  private gtfsAttribution = 'VVS GTFS route package has not loaded yet.';
  private readonly loop = new SimulatorLoop({
    turnaroundMs: TERMINAL_TURNAROUND_MS,
    getPaused: () => this.state.paused,
    getSelectedTime: () => this.state.selectedTime,
    getCurrentLocalHour: () => this.currentLocalHour(),
    step: (dt) => this.simulator.step(dt),
    onAutoTimeHour: (hour) => this.world?.setTimeOfDay(hour),
    onState: (simState, dt) => this.onSimulatorState(simState, dt),
    onTerminalTurnaround: () => this.startOppositeRide()
  });

  constructor(private readonly appEl: HTMLDivElement) {
    this.rightRail.className = 'right-rail';
    document.body.appendChild(this.rightRail);
    this.routeDiagramEl.className = 'route-diagram';
    this.rightRail.appendChild(this.routeDiagramEl);
    this.routeDiagram = new TransitRouteDiagram(this.routeDiagramEl);
    this.miniMapEl.className = 'minimap';
    document.body.appendChild(this.miniMapEl);
    this.miniMap = new VehicleMiniMap(this.miniMapEl);
    this.bindHud();
    this.bindKeyboard();
  }

  async start(): Promise<void> {
    this.hud.showLoading('Loading VVS route manifest...');
    this.manifest = await loadRouteManifest();
    this.gtfsAttribution = this.manifest.attribution;
    await this.selectTransportMode('stadtbahn', false);
    this.hud.showLoading('Loading Go/WASM simulator...');
    await this.simulator.load();
    this.startSelectedRide();
    this.loop.start();
  }

  private bindHud(): void {
    this.hud.onTransportModeChange(async (mode) => this.selectTransportMode(mode));
    this.hud.onRouteChange((routeId) => {
      this.state.selectedRoute = this.availableRoutes().find((route) => route.id === routeId) ?? this.availableRoutes()[0] ?? demoRoute;
      this.state.selectedStartStation = 0;
      this.syncRouteSelectors();
      this.startSelectedRide();
    });
    this.hud.onStationChange((stationIndex) => {
      this.state.selectedStartStation = stationIndex;
      this.startSelectedRide();
    });
    this.hud.onModeChange((mode) => {
      this.state.selectedMode = mode;
      this.startSelectedRide();
    });
    this.hud.onSeasonChange((season) => {
      this.state.selectedSeason = season;
      this.world?.setSeason(season);
    });
    this.hud.onTimeChange((time) => {
      this.state.selectedTime = time;
      this.world?.setTimeOfDay(time === 'auto' ? this.currentLocalHour() : time);
    });
    this.hud.onPause(() => {
      this.state.paused = !this.state.paused;
      this.hud.setPause(this.state.paused);
      this.updateFromState(this.simulator.setPaused(this.state.paused));
    });
    this.hud.onCamera(() => {
      this.world?.cycleCamera();
      const state = this.loop.currentState();
      if (state && this.world) {
        this.world.updateTrain(state.distanceM, state.doorsOpen, 1 / 60, state.nextStation);
        this.world.render();
      }
    });
    this.hud.onReset(() => this.startSelectedRide());
    this.hud.onDriveInput((kind, held) => {
      if (kind === 'throttle') this.state.throttleHeld = held;
      if (kind === 'brake') this.state.brakeHeld = held;
      this.setDriveInput();
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (event.key === 'w' || event.key === 'ArrowUp') this.state.throttleHeld = true;
      if (event.key === 's' || event.key === 'ArrowDown') this.state.brakeHeld = true;
      this.setDriveInput();
    });

    window.addEventListener('keyup', (event) => {
      if (event.key === 'w' || event.key === 'ArrowUp') this.state.throttleHeld = false;
      if (event.key === 's' || event.key === 'ArrowDown') this.state.brakeHeld = false;
      this.setDriveInput();
    });
  }

  private async selectTransportMode(mode: TransportMode, restart = true): Promise<void> {
    if (!this.manifest) return;
    await this.ensureModeLoaded(mode);
    const routes = this.availableRoutes(mode);
    if (routes.length === 0) return;
    this.state.selectedTransportMode = mode;
    const defaultLine = DEFAULT_LINE_BY_MODE[mode];
    this.state.selectedRoute = routes.find((route) => route.line === defaultLine) ?? routes[0];
    this.state.selectedStartStation = 0;
    this.syncRouteSelectors();
    if (restart) this.startSelectedRide();
  }

  private async ensureModeLoaded(mode: TransportMode): Promise<void> {
    if (!this.manifest || this.routesByMode.has(mode)) return;
    this.hud.showLoading(`Loading ${transportModeLabel(mode)} routes...`);
    const loaded = await loadRoutesForMode(mode, this.manifest);
    this.gtfsAttribution = loaded.attribution;
    this.routesByMode.set(mode, loaded.routes);
    this.hud.hideLoading();
  }

  private availableRoutes(mode = this.state.selectedTransportMode): DemoRoute[] {
    return this.routesByMode.get(mode) ?? [];
  }

  private syncRouteSelectors(): void {
    this.hud.setTransportMode(this.state.selectedTransportMode);
    this.hud.setRoutes(this.availableRoutes(), this.state.selectedRoute.id);
    this.hud.setStations(this.state.selectedRoute, this.state.selectedStartStation);
    this.hud.setMode(this.state.selectedMode);
    this.hud.setSeason(this.state.selectedSeason);
    this.hud.setTime(this.state.selectedTime);
    this.hud.setPause(this.state.paused);
  }

  private routeConfig(route: DemoRoute): SimulatorConfig {
    return {
      line: route.line,
      destination: route.destination,
      speedLimitMps: route.speedLimitMps,
      routeLengthM: route.routeLengthM,
      stations: route.stations,
      mode: this.state.selectedMode,
      startStationIndex: this.state.selectedStartStation
    };
  }

  private rebuildWorld(route: DemoRoute): void {
    this.world?.dispose();
    this.appEl.replaceChildren();
    this.world = new TransitWorld(createRouteCurve(route), route, this.availableRoutes());
    this.world.mount(this.appEl);
    this.world.setSeason(this.state.selectedSeason);
    this.world.setTimeOfDay(this.state.selectedTime === 'auto' ? this.currentLocalHour() : this.state.selectedTime);
    this.miniMap.setRoute(route);
    this.routeDiagram.setRoute(route);
    window.setTimeout(() => this.miniMap.invalidateSize(), 0);
  }

  private startSelectedRide(): void {
    this.rebuildWorld(this.state.selectedRoute);
    this.state.paused = false;
    this.hud.setPause(false);
    this.updateFromState(this.simulator.init(this.routeConfig(this.state.selectedRoute)));
    this.updateNotice();
    this.hud.hideLoading();
  }

  private updateFromState(simState: SimulatorState): void {
    this.loop.setState(simState);
    this.hud.updateSimulatorState(simState);
    this.routeDiagram.update(simState);
  }

  private onSimulatorState(simState: SimulatorState, dt: number): void {
    if (!this.world) return;
    this.world.updateTrain(simState.distanceM, simState.doorsOpen, dt, simState.nextStation);
    this.world.render();
    this.miniMap.update(simState.distanceM);
    this.hud.updateSimulatorState(simState);
    this.routeDiagram.update(simState);
  }

  private updateNotice(): void {
    const route = this.state.selectedRoute;
    this.hud.updateNotice(
      `${transportModeLabel(routeMode(route))} · ${route.agency ?? 'SSB'} · ${route.description} Free non-commercial simulator. Source: ${route.source ?? 'demo route'}. ${this.gtfsAttribution} Vector 3D scenery: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Relief: Mapzen Terrain Tiles on AWS Open Data.`
    );
  }

  private setDriveInput(): void {
    if (this.state.selectedMode !== 'driver') return;
    this.updateFromState(this.simulator.setDriverInput(this.state.throttleHeld ? 1 : 0, this.state.brakeHeld ? 1 : 0));
  }

  private findOppositeRoute(route: DemoRoute): DemoRoute | undefined {
    const origin = route.stations[0]?.name;
    const terminal = route.stations.at(-1)?.name;
    const candidates = this.availableRoutes().filter((candidate) => candidate.line === route.line && candidate.id !== route.id);
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

  private startOppositeRide(): void {
    const opposite = this.findOppositeRoute(this.state.selectedRoute);
    if (!opposite) return;
    this.state.selectedRoute = opposite;
    this.state.selectedStartStation = 0;
    this.syncRouteSelectors();
    this.startSelectedRide();
  }

  private currentLocalHour(): number {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }
}
