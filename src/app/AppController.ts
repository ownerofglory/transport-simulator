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
import { loadCityCatalog, resolveCities, stuttgartCity, type CityDefinition } from '../cities';
import { resolveTransportModeDefinition, transportModeLabel, type TransportMode } from '../domain/transport';
import { TransitWorld } from '../world';
import { createInitialAppState, type AppState } from './AppState';
import { SimulatorLoop } from './SimulatorLoop';
import { HudView } from '../ui/HudView';
import { SimulatorClient } from '../simulator/SimulatorClient';
import type { SimulatorConfig, SimulatorState } from '../simulator/simulator-types';

const TERMINAL_TURNAROUND_MS = 4000;

export class AppController {
  private readonly hud = new HudView(document.body);
  private readonly simulator = new SimulatorClient();
  private readonly rightRail = document.createElement('div');
  private readonly routeDiagramEl = document.createElement('section');
  private readonly miniMapEl = document.createElement('div');
  private readonly routeDiagram: TransitRouteDiagram;
  private readonly miniMap: VehicleMiniMap;
  private readonly state: AppState = createInitialAppState(demoRoute);
  private readonly routesByCityMode = new Map<string, DemoRoute[]>();
  private world: TransitWorld | null = null;
  private cityCatalog: CityDefinition[] = [stuttgartCity];
  private currentCity: CityDefinition = stuttgartCity;
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
    this.hud.showLoading('Loading city catalog...');
    const catalog = await loadCityCatalog();
    this.cityCatalog = resolveCities(catalog);
    this.currentCity = this.cityCatalog.find((city) => city.id === this.state.selectedCityId) ?? this.cityCatalog[0] ?? stuttgartCity;
    this.state.selectedCityId = this.currentCity.id;
    this.hud.setCities(this.cityCatalog, this.currentCity.id);
    this.hud.setCity(this.currentCity);
    await this.loadManifestForCity(this.currentCity);
    await this.selectTransportMode(this.currentCity.defaultTransportMode, false);
    this.hud.showLoading('Loading Go/WASM simulator...');
    await this.simulator.load();
    this.startSelectedRide();
    this.loop.start();
  }

  private bindHud(): void {
    this.hud.onCityChange(async (cityId) => this.selectCity(cityId));
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
      if (event.key === 'ArrowLeft') this.state.lookLeftHeld = true;
      if (event.key === 'ArrowRight') this.state.lookRightHeld = true;
      this.setDriveInput();
      this.setLookInput();
    });

    window.addEventListener('keyup', (event) => {
      if (event.key === 'w' || event.key === 'ArrowUp') this.state.throttleHeld = false;
      if (event.key === 's' || event.key === 'ArrowDown') this.state.brakeHeld = false;
      if (event.key === 'ArrowLeft') this.state.lookLeftHeld = false;
      if (event.key === 'ArrowRight') this.state.lookRightHeld = false;
      this.setDriveInput();
      this.setLookInput();
    });
  }

  private async selectCity(cityId: string): Promise<void> {
    const city = this.cityCatalog.find((entry) => entry.id === cityId) ?? this.currentCity;
    if (city.id === this.currentCity.id) return;
    this.currentCity = city;
    this.state.selectedCityId = city.id;
    this.hud.setCity(city);
    await this.loadManifestForCity(city);
    await this.selectTransportMode(city.defaultTransportMode);
  }

  private async loadManifestForCity(city: CityDefinition): Promise<void> {
    this.hud.showLoading(`Loading ${city.name} route manifest...`);
    this.manifest = await loadRouteManifest(city.manifestFile, city.routeManifestFallback);
    this.gtfsAttribution = this.manifest.attribution;
    this.updateAvailableModes();
  }

  private async selectTransportMode(mode: TransportMode, restart = true): Promise<void> {
    if (!this.manifest) return;
    await this.ensureModeLoaded(mode);
    const routes = this.availableRoutes(mode);
    if (routes.length === 0) return;
    this.state.selectedTransportMode = mode;
    const defaultLine = this.currentCity.defaultLineByMode[mode];
    this.state.selectedRoute = routes.find((route) => route.line === defaultLine) ?? routes[0];
    this.state.selectedStartStation = 0;
    this.syncRouteSelectors();
    if (restart) this.startSelectedRide();
  }

  private async ensureModeLoaded(mode: TransportMode): Promise<void> {
    if (!this.manifest) return;
    const cacheKey = `${this.currentCity.id}:${mode}`;
    if (this.routesByCityMode.has(cacheKey)) return;
    this.hud.showLoading(`Loading ${this.currentCity.name} ${transportModeLabel(mode, this.currentCity.transportModes)} routes...`);
    const loaded = await loadRoutesForMode(
      mode,
      this.manifest,
      this.currentCity.demoRoutesFallback,
      this.currentCity.routeManifestFallback.attribution
    );
    this.gtfsAttribution = loaded.attribution;
    this.routesByCityMode.set(cacheKey, loaded.routes);
    this.hud.hideLoading();
  }

  private availableRoutes(mode = this.state.selectedTransportMode): DemoRoute[] {
    return this.routesByCityMode.get(`${this.currentCity.id}:${mode}`) ?? [];
  }

  private syncRouteSelectors(): void {
    this.hud.setCity(this.currentCity);
    this.hud.setTransportModes(this.currentCity.transportModes, this.state.selectedTransportMode);
    this.updateAvailableModes();
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
    this.world = new TransitWorld(
      createRouteCurve(route),
      route,
      this.availableRoutes(),
      this.currentCity,
      resolveTransportModeDefinition(routeMode(route), this.currentCity.transportModes)
    );
    this.world.mount(this.appEl);
    this.world.setInteriorLookInput(this.state.lookLeftHeld, this.state.lookRightHeld);
    this.world.setSeason(this.state.selectedSeason);
    this.world.setTimeOfDay(this.state.selectedTime === 'auto' ? this.currentLocalHour() : this.state.selectedTime);
    this.miniMap.setRoute(route);
    this.routeDiagram.setRoute(route, this.availableRoutes());
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
      `${this.currentCity.shortLabel} · ${transportModeLabel(routeMode(route), this.currentCity.transportModes)} · ${route.agency ?? this.currentCity.noticeNetworkName} · ${route.description} ${this.currentCity.freeRideNotice} Source: ${route.source ?? 'demo route'}. ${this.gtfsAttribution} Vector 3D scenery: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Relief: Mapzen Terrain Tiles on AWS Open Data.`
    );
  }

  private setDriveInput(): void {
    if (this.state.selectedMode !== 'driver') return;
    this.updateFromState(this.simulator.setDriverInput(this.state.throttleHeld ? 1 : 0, this.state.brakeHeld ? 1 : 0));
  }

  private setLookInput(): void {
    this.world?.setInteriorLookInput(this.state.lookLeftHeld, this.state.lookRightHeld);
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

  private updateAvailableModes(): void {
    const modes = this.manifest?.modes.map((mode) => mode.mode) ?? [this.currentCity.defaultTransportMode];
    this.hud.setAvailableTransportModes(modes, this.state.selectedTransportMode);
  }
}
