import { VehicleMiniMap } from '../minimap';
import { TransitRouteDiagram } from '../route-diagram';
import { demoRoute, routeMode, type DemoRoute } from '../route';
import { loadCityCatalog, resolveCities, stuttgartCity, type CityDefinition } from '../cities';
import { transportModeLabel, type TransportMode } from '../domain/transport';
import type { TransitWorld } from '../world';
import { createInitialAppState, type AppState } from './AppState';
import { readUrlState, writeUrlState } from './AppUrlState';
import { RouteRepository } from './RouteRepository';
import { SimulatorRuntime, type RouteSession } from './SimulatorRuntime';
import { InputController } from './InputController';
import { HudView } from '../ui/HudView';
import type { SimulatorState } from '../simulator/simulator-types';
import type { CameraMode } from '../world/CameraController';

/** Coordinates HUD, city/route loading, simulator runtime, and input. */
export class AppController {
  private readonly hud = new HudView(document.body);

  // Right-side UI rail contains route diagram; minimap is mounted separately.
  private readonly rightRail = document.createElement('div');
  private readonly routeDiagramEl = document.createElement('section');
  private readonly miniMapEl = document.createElement('div');
  private readonly routeDiagram: TransitRouteDiagram;
  private readonly miniMap: VehicleMiniMap;
  private readonly photoOverlay = document.createElement('div');
  private readonly photoLabel = document.createElement('div');
  private readonly photoExitButton = document.createElement('button');
  private readonly photoCycleButton = document.createElement('button');
  private readonly photoShotButton = document.createElement('button');

  private readonly state: AppState = createInitialAppState(demoRoute.id);

  // Owns city manifests, lazy per-city/mode route loading, caching, and attribution.
  private readonly routes = new RouteRepository();

  private cityCatalog: CityDefinition[] = [stuttgartCity];
  private currentCity: CityDefinition = stuttgartCity;

  // Owns the world, simulator client, render loop, and route lifecycle.
  private readonly runtime: SimulatorRuntime;

  // Owns raw keyboard/touch/pointer listeners, emitting semantic input events.
  private readonly input: InputController;

  constructor(private readonly appEl: HTMLDivElement) {
    this.runtime = new SimulatorRuntime(appEl, {
      getPaused: () => this.state.paused,
      getSelectedTime: () => this.state.selectedTime,
      getCurrentLocalHour: () => this.currentLocalHour(),
      onFrame: (state) => this.onFrame(state),
      onDiscreteState: (state) => this.onDiscreteState(state),
      onWorldReady: (world, route) => this.onWorldReady(world, route),
      onTerminalTurnaround: () => this.startOppositeRide()
    });

    this.input = new InputController(appEl, {
      setThrottle: (held) => { this.state.throttleHeld = held; this.setDriveInput(); },
      setBrake: (held) => { this.state.brakeHeld = held; this.setDriveInput(); },
      setLook: (left, right) => {
        this.state.lookLeftHeld = left;
        this.state.lookRightHeld = right;
        this.setLookInput();
      },
      zoom: (delta) => this.runtime.adjustZoom(delta),
      togglePhotoMode: () => void this.togglePhotoMode(),
      exitPhotoMode: () => void this.togglePhotoMode(false)
    });

    this.rightRail.className = 'right-rail';
    document.body.appendChild(this.rightRail);

    this.routeDiagramEl.className = 'route-diagram';
    this.rightRail.appendChild(this.routeDiagramEl);
    this.routeDiagram = new TransitRouteDiagram(this.routeDiagramEl);

    this.miniMapEl.className = 'minimap';
    document.body.appendChild(this.miniMapEl);
    this.miniMap = new VehicleMiniMap(this.miniMapEl);

    this.photoOverlay.className = 'photo-overlay';
    this.photoLabel.className = 'label';
    this.photoExitButton.textContent = 'Exit';
    this.photoCycleButton.textContent = 'Angle';
    this.photoShotButton.textContent = 'Screenshot';
    this.photoOverlay.append(this.photoExitButton, this.photoLabel, this.photoCycleButton, this.photoShotButton);
    document.body.appendChild(this.photoOverlay);

    this.bindHud();
    this.bindPhotoOverlay();
  }

  /** Bootstraps catalog, initial routes, WASM simulator, and the render loop. */
  async start(): Promise<void> {
    this.hud.showLoading('Loading city catalog...');
    const urlState = readUrlState();

    const catalog = await loadCityCatalog();
    this.cityCatalog = resolveCities(catalog);

    this.state.selectedSeason = urlState.season ?? this.state.selectedSeason;
    this.state.selectedTime = urlState.time ?? this.state.selectedTime;
    this.state.selectedMode = urlState.rideMode ?? this.state.selectedMode;
    this.state.selectedCameraMode = urlState.cameraMode ?? this.state.selectedCameraMode;

    this.currentCity = this.cityCatalog.find((city) => city.id === (urlState.city ?? this.state.selectedCityId)) ?? this.cityCatalog[0] ?? stuttgartCity;
    this.state.selectedCityId = this.currentCity.id;

    this.hud.setCities(this.cityCatalog, this.currentCity.id);
    this.hud.setCity(this.currentCity);

    await this.loadManifestForCity(this.currentCity);
    await this.selectTransportMode(
      this.resolveTransportModeFromUrl(urlState.transportMode),
      false,
      urlState.routeId,
      urlState.startStationIndex
    );

    this.hud.showLoading('Loading Go/WASM simulator...');
    await this.runtime.load();

    this.startSelectedRide();
    this.runtime.startLoop();
  }

  /** Wires HUD events back into app state, route loading, and world updates. */
  private bindHud(): void {
    this.hud.onCityChange(async (cityId) => this.selectCity(cityId));
    this.hud.onTransportModeChange(async (mode) => this.selectTransportMode(mode));

    this.hud.onRouteChange((routeId) => {
      const route = this.availableRoutes().find((entry) => entry.id === routeId) ?? this.availableRoutes()[0] ?? demoRoute;
      this.state.selectedRouteId = route.id;
      this.state.selectedStartStation = 0;
      this.syncRouteSelectors();
      this.startSelectedRide();
    });

    this.hud.onStationChange((stationIndex) => {
      this.state.selectedStartStation = stationIndex;
      this.restartRide((session) => this.runtime.setStartStation(session));
    });

    this.hud.onModeChange((mode) => {
      this.state.selectedMode = mode;
      this.restartRide((session) => this.runtime.setRideMode(session));
    });

    this.hud.onTimeChange((time) => {
      this.state.selectedTime = time;
      this.runtime.setTime(time);
      this.updateUrlState();
    });

    this.hud.onPause(() => {
      this.state.paused = !this.state.paused;
      this.hud.setPause(this.state.paused);
      this.runtime.setPaused(this.state.paused);
    });

    this.hud.onCamera(() => {
      if (this.state.photoModeActive && this.runtime.world) {
        this.runtime.world.cycleCinematicPreset();
        this.refreshPhotoOverlay();
        this.runtime.renderFrame();
        return;
      }
      this.state.selectedCameraMode = (this.runtime.cycleCamera() as CameraMode | undefined) ?? this.state.selectedCameraMode;
      this.updateUrlState();
      // Render one immediate frame so camera button feedback is visible while paused.
      this.runtime.renderFrame();
    });

    this.hud.onPhoto(() => void this.togglePhotoMode());
    this.hud.onReset(() => this.restartRide((session) => this.runtime.resetSimulation(session)));

    this.hud.onDriveInput((kind, held) => {
      if (kind === 'throttle') this.state.throttleHeld = held;
      if (kind === 'brake') this.state.brakeHeld = held;
      this.setDriveInput();
    });
  }

  private bindPhotoOverlay(): void {
    this.photoExitButton.addEventListener('click', () => void this.togglePhotoMode(false));
    this.photoCycleButton.addEventListener('click', () => {
      if (!this.runtime.world) return;
      this.runtime.world.cycleCinematicPreset();
      this.refreshPhotoOverlay();
      this.runtime.renderFrame();
    });
    this.photoShotButton.addEventListener('click', () => void this.exportScreenshot());
  }

  /** Switches active city, loads its manifest, and selects its default transport mode. */
  private async selectCity(cityId: string): Promise<void> {
    const city = this.cityCatalog.find((entry) => entry.id === cityId) ?? this.currentCity;
    if (city.id === this.currentCity.id) return;

    this.currentCity = city;
    this.state.selectedCityId = city.id;
    this.hud.setCity(city);

    await this.loadManifestForCity(city);
    await this.selectTransportMode(city.defaultTransportMode);
  }

  /** Loads one city's route manifest and updates mode availability. */
  private async loadManifestForCity(city: CityDefinition): Promise<void> {
    this.hud.showLoading(`Loading ${city.name} route manifest...`);
    await this.routes.loadManifest(city);
    this.updateAvailableModes();
  }

  /** Selects a transport mode, lazily loading routes for that city/mode if needed. */
  private async selectTransportMode(
    mode: TransportMode,
    restart = true,
    preferredRouteId?: string,
    preferredStartStationIndex?: number
  ): Promise<void> {
    if (!this.routes.manifestForCity(this.currentCity.id)) return;

    await this.ensureModeLoaded(mode);

    const routes = this.availableRoutes(mode);
    if (routes.length === 0) return;

    this.state.selectedTransportMode = mode;

    const defaultRouteId = this.currentCity.defaultRouteIdByMode?.[mode];
    const defaultLine = this.currentCity.defaultLineByMode[mode];

    const selectedRoute = routes.find((route) => route.id === preferredRouteId)
      ?? routes.find((route) => route.id === defaultRouteId)
      ?? routes.find((route) => route.line === defaultLine)
      ?? routes[0];
    this.state.selectedRouteId = selectedRoute.id;

    const requestedStationIndex = preferredStartStationIndex ?? 0;
    this.state.selectedStartStation = Math.max(0, Math.min(selectedRoute.stations.length - 1, requestedStationIndex));
    this.syncRouteSelectors();

    if (restart) this.startSelectedRide();
    else this.updateUrlState();
  }

  /** Loads route packages for a city/mode once via the repository cache. */
  private async ensureModeLoaded(mode: TransportMode): Promise<void> {
    if (this.routes.hasRoutes(this.currentCity.id, mode)) return;

    this.hud.showLoading(this.routes.routesLoadingLabel(this.currentCity, mode));
    await this.routes.loadRoutes(this.currentCity, mode);
    this.hud.hideLoading();
  }

  /** Returns routes already loaded for the selected city and given/current mode. */
  private availableRoutes(mode = this.state.selectedTransportMode): DemoRoute[] {
    return this.routes.routesFor(this.currentCity.id, mode);
  }

  /** Resolves the current DemoRoute from state's route id via the repository. */
  private currentRoute(): DemoRoute {
    return this.routes.resolveRoute(this.currentCity.id, this.state.selectedTransportMode, this.state.selectedRouteId)
      ?? this.availableRoutes()[0]
      ?? demoRoute;
  }

  /** Pushes current controller state into all HUD selectors. */
  private syncRouteSelectors(): void {
    this.hud.setCity(this.currentCity);
    this.hud.setTransportModes(this.currentCity.transportModes, this.state.selectedTransportMode);
    this.updateAvailableModes();
    this.hud.setTransportMode(this.state.selectedTransportMode);
    this.hud.setRoutes(this.availableRoutes(), this.state.selectedRouteId);
    this.hud.setStations(this.currentRoute(), this.state.selectedStartStation);
    this.hud.setMode(this.state.selectedMode);
    this.hud.setTime(this.state.selectedTime);
    this.hud.setPause(this.state.paused);
  }

  /** Snapshots current app state into a session the runtime can build from. */
  private buildSession(): RouteSession {
    return {
      route: this.currentRoute(),
      networkRoutes: this.availableRoutes(),
      city: this.currentCity,
      rideMode: this.state.selectedMode,
      startStationIndex: this.state.selectedStartStation,
      cameraMode: this.state.selectedCameraMode,
      season: this.state.selectedSeason,
      lookLeftHeld: this.state.lookLeftHeld,
      lookRightHeld: this.state.lookRightHeld
    };
  }

  /** Starts a fresh ride for a new route/city selection (full world rebuild). */
  private startSelectedRide(): void {
    this.restartRide((session) => this.runtime.loadRoute(session));
  }

  /** Shared ride (re)start housekeeping around a specific runtime action. */
  private restartRide(action: (session: RouteSession) => void): void {
    this.state.photoModeActive = false;
    document.body.classList.remove('photo-mode');
    this.state.paused = false;
    this.hud.setPause(false);
    action(this.buildSession());
    this.updateNotice();
    this.hud.hideLoading();
    this.updateUrlState();
  }

  /** Refreshes route-linked side panels after the runtime rebuilds the world. */
  private onWorldReady(_world: TransitWorld, route: DemoRoute): void {
    this.miniMap.setRoute(route);
    this.routeDiagram.setRoute(route, this.availableRoutes());
    // Let Leaflet measure after the minimap has been mounted and laid out.
    window.setTimeout(() => this.miniMap.invalidateSize(), 0);
  }

  /** Discrete simulator state change (init/reset/pause/input): refresh HUD/diagram. */
  private onDiscreteState(simState: SimulatorState): void {
    this.hud.updateSimulatorState(simState);
    this.routeDiagram.update(simState);
  }

  /** Per-frame hook after the runtime updates/renders the world. */
  private onFrame(simState: SimulatorState): void {
    this.miniMap.update(simState.distanceM);
    this.hud.updateSimulatorState(simState);
    this.routeDiagram.update(simState);
  }

  private async togglePhotoMode(force?: boolean): Promise<void> {
    const world = this.runtime.world;
    if (!world) return;
    const shouldEnable = force ?? !this.state.photoModeActive;
    if (shouldEnable === this.state.photoModeActive) return;
    this.state.photoModeActive = shouldEnable;
    const result = world.toggleCinematicMode();
    document.body.classList.toggle('photo-mode', result.active);
    this.refreshPhotoOverlay();
    this.runtime.renderFrame();
  }

  private refreshPhotoOverlay(): void {
    const world = this.runtime.world;
    if (!world) return;
    this.photoLabel.textContent = world.currentCinematicPresetLabel();
  }

  private async exportScreenshot(): Promise<void> {
    const world = this.runtime.world;
    if (!world) return;
    this.runtime.renderFrame();
    document.body.classList.add('photo-capture');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const blob = await new Promise<Blob | null>((resolve) => world.renderer.domElement.toBlob(resolve, 'image/png'));
    document.body.classList.remove('photo-capture');
    if (!blob) return;
    const link = document.createElement('a');
    const preset = world.currentCinematicPreset().replaceAll('-', '_');
    const safeLine = this.currentRoute().line.replace(/[^\w-]+/g, '_');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.currentCity.id}_${safeLine}_${preset}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /** Updates public attribution and data-source notice for the current ride. */
  private updateNotice(): void {
    const route = this.currentRoute();

    this.hud.updateNotice(
      `${this.currentCity.shortLabel} · ${transportModeLabel(routeMode(route), this.currentCity.transportModes)} · ${route.agency ?? this.currentCity.noticeNetworkName} · ${route.description} ${this.currentCity.freeRideNotice} Source: ${route.source ?? 'demo route'}. ${this.routes.attribution} Vector 3D scenery: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Relief: Mapzen Terrain Tiles on AWS Open Data.`
    );
  }

  /** Sends current throttle/brake state to WASM when in driver mode. */
  private setDriveInput(): void {
    if (this.state.selectedMode !== 'driver') return;

    this.runtime.setDriverInput(
      this.state.throttleHeld ? 1 : 0,
      this.state.brakeHeld ? 1 : 0
    );
  }

  /** Sends current cab/passenger look state to the world camera controller. */
  private setLookInput(): void {
    this.runtime.setInteriorLook(this.state.lookLeftHeld, this.state.lookRightHeld);
  }

  /** Finds the best same-line route going back from terminal to origin. */
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

    // Require both endpoint matches before auto-switching to the opposite direction.
    return bestMatch && bestMatch.score >= 16 ? bestMatch.candidate : undefined;
  }

  /** Starts the opposite-direction route after terminal turnaround, if one is known. */
  private startOppositeRide(): void {
    const opposite = this.findOppositeRoute(this.currentRoute());
    if (!opposite) return;

    this.state.selectedRouteId = opposite.id;
    this.state.selectedStartStation = 0;
    this.syncRouteSelectors();
    this.startSelectedRide();
  }

  /** Returns local wall-clock hour as a fractional value, e.g. 13.5 for 13:30. */
  private currentLocalHour(): number {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }

  /** Enables/disables transport tabs based on the loaded manifest. */
  private updateAvailableModes(): void {
    const modes = this.routes.availableModes(this.currentCity);
    this.hud.setAvailableTransportModes(modes, this.state.selectedTransportMode);
  }

  private resolveTransportModeFromUrl(requestedMode?: TransportMode): TransportMode {
    if (!requestedMode) return this.currentCity.defaultTransportMode;
    return this.currentCity.transportModes.some((definition) => definition.id === requestedMode)
      ? requestedMode
      : this.currentCity.defaultTransportMode;
  }

  private updateUrlState(): void {
    writeUrlState(this.state);
  }
}
