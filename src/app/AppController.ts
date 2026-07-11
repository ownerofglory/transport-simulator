import { VehicleMiniMap } from '../minimap';
import { TransitRouteDiagram } from '../route-diagram';
import {
  createRouteCurve,
  demoRoute,
  routeMode,
  type DemoRoute
} from '../route';
import { loadCityCatalog, resolveCities, stuttgartCity, type CityDefinition } from '../cities';
import { resolveTransportModeDefinition, transportModeLabel, type TransportMode } from '../domain/transport';
import { TransitWorld } from '../world';
import { createInitialAppState, type AppState } from './AppState';
import { readUrlState, writeUrlState } from './AppUrlState';
import { RouteRepository } from './RouteRepository';
import { SimulatorLoop } from './SimulatorLoop';
import { HudView } from '../ui/HudView';
import { SimulatorClient } from '../simulator/SimulatorClient';
import type { SimulatorConfig, SimulatorState } from '../simulator/simulator-types';
import type { CameraMode } from '../world/CameraController';

// Delay before automatically starting the opposite direction after reaching a terminal.
const TERMINAL_TURNAROUND_MS = 4000;

/** Coordinates HUD, city/route loading, simulator state, world rendering, and input. */
export class AppController {
  private static readonly TOUCH_LOOK_DEADZONE_PX = 24;
  private static readonly TOUCH_LOOK_MAX_VERTICAL_DRIFT_PX = 64;
  private static readonly WHEEL_ZOOM_SENSITIVITY = 0.0012;
  private static readonly PINCH_ZOOM_SENSITIVITY = 0.004;

  private readonly hud = new HudView(document.body);
  private readonly simulator = new SimulatorClient();

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

  private world: TransitWorld | null = null;
  private cityCatalog: CityDefinition[] = [stuttgartCity];
  private currentCity: CityDefinition = stuttgartCity;
  private activeLookTouchId: number | null = null;
  private touchLookStartX = 0;
  private touchLookStartY = 0;
  private pinchDistancePx: number | null = null;

  // Shared animation/simulator loop; callbacks keep controller state as the single owner.
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

    this.photoOverlay.className = 'photo-overlay';
    this.photoLabel.className = 'label';
    this.photoExitButton.textContent = 'Exit';
    this.photoCycleButton.textContent = 'Angle';
    this.photoShotButton.textContent = 'Screenshot';
    this.photoOverlay.append(this.photoExitButton, this.photoLabel, this.photoCycleButton, this.photoShotButton);
    document.body.appendChild(this.photoOverlay);

    this.bindHud();
    this.bindKeyboard();
    this.bindTouchLook();
    this.bindZoomInput();
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
    await this.simulator.load();

    this.startSelectedRide();
    this.loop.start();
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
      this.startSelectedRide();
    });

    this.hud.onModeChange((mode) => {
      this.state.selectedMode = mode;
      this.startSelectedRide();
    });

    this.hud.onTimeChange((time) => {
      this.state.selectedTime = time;
      this.world?.setTimeOfDay(time === 'auto' ? this.currentLocalHour() : time);
      this.updateUrlState();
    });

    this.hud.onPause(() => {
      this.state.paused = !this.state.paused;
      this.hud.setPause(this.state.paused);
      this.updateFromState(this.simulator.setPaused(this.state.paused));
    });

    this.hud.onCamera(() => {
      if (this.state.photoModeActive && this.world) {
        this.world.cycleCinematicPreset();
        this.refreshPhotoOverlay();
        this.renderCurrentFrame();
        return;
      }
      this.state.selectedCameraMode = (this.world?.cycleCamera() as CameraMode | undefined) ?? this.state.selectedCameraMode;
      this.updateUrlState();

      const state = this.loop.currentState();
      if (state && this.world) {
        // Render one immediate frame so camera button feedback is visible while paused.
        this.world.updateTrain(state.distanceM, state.doorsOpen, 1 / 60, state.nextStation);
        this.world.render();
      }
    });

    this.hud.onPhoto(() => void this.togglePhotoMode());
    this.hud.onReset(() => this.startSelectedRide());

    this.hud.onDriveInput((kind, held) => {
      if (kind === 'throttle') this.state.throttleHeld = held;
      if (kind === 'brake') this.state.brakeHeld = held;
      this.setDriveInput();
    });
  }

  /** Binds keyboard driving and interior-look controls. */
  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.state.photoModeActive) {
        event.preventDefault();
        void this.togglePhotoMode(false);
        return;
      }
      if ((event.key === 'p' || event.key === 'P') && !event.repeat) {
        event.preventDefault();
        void this.togglePhotoMode();
        return;
      }
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

  private bindPhotoOverlay(): void {
    this.photoExitButton.addEventListener('click', () => void this.togglePhotoMode(false));
    this.photoCycleButton.addEventListener('click', () => {
      if (!this.world) return;
      this.world.cycleCinematicPreset();
      this.refreshPhotoOverlay();
      this.renderCurrentFrame();
    });
    this.photoShotButton.addEventListener('click', () => void this.exportScreenshot());
  }

  /** Lets mobile users look left/right with a horizontal swipe on the 3D viewport. */
  private bindTouchLook(): void {
    this.appEl.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2) {
        this.clearLookTouch();
        this.pinchDistancePx = this.touchDistance(event.touches[0], event.touches[1]);
        return;
      }

      if (event.touches.length !== 1) return;

      const touch = event.touches[0];
      if (!touch) return;

      this.activeLookTouchId = touch.identifier;
      this.touchLookStartX = touch.clientX;
      this.touchLookStartY = touch.clientY;
    }, { passive: true });

    this.appEl.addEventListener('touchmove', (event) => {
      if (event.touches.length === 2) {
        const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]];
        if (!firstTouch || !secondTouch) return;

        const distancePx = this.touchDistance(firstTouch, secondTouch);
        if (this.pinchDistancePx != null) {
          const deltaPx = distancePx - this.pinchDistancePx;
          this.world?.adjustCameraZoom(deltaPx * AppController.PINCH_ZOOM_SENSITIVITY);
        }
        this.pinchDistancePx = distancePx;
        this.clearLookTouch();
        event.preventDefault();
        return;
      }

      if (this.activeLookTouchId == null) return;

      const touch = Array.from(event.touches).find((entry) => entry.identifier === this.activeLookTouchId);
      if (!touch) return;

      const deltaX = touch.clientX - this.touchLookStartX;
      const deltaY = touch.clientY - this.touchLookStartY;

      if (Math.abs(deltaY) > AppController.TOUCH_LOOK_MAX_VERTICAL_DRIFT_PX) {
        this.clearLookTouch();
        return;
      }

      const shouldLookLeft = deltaX > AppController.TOUCH_LOOK_DEADZONE_PX;
      const shouldLookRight = deltaX < -AppController.TOUCH_LOOK_DEADZONE_PX;

      if (
        this.state.lookLeftHeld !== shouldLookLeft
        || this.state.lookRightHeld !== shouldLookRight
      ) {
        this.state.lookLeftHeld = shouldLookLeft;
        this.state.lookRightHeld = shouldLookRight;
        this.setLookInput();
      }
    }, { passive: false });

    const releaseTouch = (event: TouchEvent) => {
      if (event.touches.length < 2) this.pinchDistancePx = null;
      if (this.activeLookTouchId == null) return;

      const changed = Array.from(event.changedTouches).some((touch) => touch.identifier === this.activeLookTouchId);
      if (!changed) return;

      this.clearLookTouch();
    };

    this.appEl.addEventListener('touchend', releaseTouch, { passive: true });
    this.appEl.addEventListener('touchcancel', releaseTouch, { passive: true });
  }

  /** Lets desktop users zoom with the mouse wheel and mobile users pinch to zoom. */
  private bindZoomInput(): void {
    this.appEl.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.world?.adjustCameraZoom(-event.deltaY * AppController.WHEEL_ZOOM_SENSITIVITY);
    }, { passive: false });
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

  /** Converts route/app state into the config expected by the simulator. */
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

  /** Recreates Three world and side panels for the selected route. */
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
    this.world.setCameraMode(this.state.selectedCameraMode);
    this.world.setInteriorLookInput(this.state.lookLeftHeld, this.state.lookRightHeld);
    this.world.setSeason(this.state.selectedSeason);
    this.world.setTimeOfDay(this.state.selectedTime === 'auto' ? this.currentLocalHour() : this.state.selectedTime);

    this.miniMap.setRoute(route);
    this.routeDiagram.setRoute(route, this.availableRoutes());

    // Let Leaflet measure after the minimap has been mounted and laid out.
    window.setTimeout(() => this.miniMap.invalidateSize(), 0);
  }

  /** Starts or restarts the currently selected ride from current app state. */
  private startSelectedRide(): void {
    const route = this.currentRoute();
    this.rebuildWorld(route);
    this.state.photoModeActive = false;
    document.body.classList.remove('photo-mode');
    this.state.paused = false;
    this.hud.setPause(false);
    this.updateFromState(this.simulator.init(this.routeConfig(route)));
    this.updateNotice();
    this.hud.hideLoading();
    this.updateUrlState();
  }

  /** Stores simulator state and refreshes HUD/diagram immediately. */
  private updateFromState(simState: SimulatorState): void {
    this.loop.setState(simState);
    this.hud.updateSimulatorState(simState);
    this.routeDiagram.update(simState);
  }

  /** Per-frame render/update hook called by SimulatorLoop. */
  private onSimulatorState(simState: SimulatorState, dt: number): void {
    if (!this.world) return;

    this.world.updateTrain(simState.distanceM, simState.doorsOpen, dt, simState.nextStation);
    this.world.render();
    this.miniMap.update(simState.distanceM);
    this.hud.updateSimulatorState(simState);
    this.routeDiagram.update(simState);
  }

  private async togglePhotoMode(force?: boolean): Promise<void> {
    if (!this.world) return;
    const shouldEnable = force ?? !this.state.photoModeActive;
    if (shouldEnable === this.state.photoModeActive) return;
    this.state.photoModeActive = shouldEnable;
    const result = this.world.toggleCinematicMode();
    document.body.classList.toggle('photo-mode', result.active);
    this.refreshPhotoOverlay();
    this.renderCurrentFrame();
  }

  private refreshPhotoOverlay(): void {
    if (!this.world) return;
    this.photoLabel.textContent = this.world.currentCinematicPresetLabel();
  }

  private renderCurrentFrame(): void {
    const simState = this.loop.currentState();
    if (!simState || !this.world) return;
    this.world.updateTrain(simState.distanceM, simState.doorsOpen, 1 / 60, simState.nextStation);
    this.world.render();
  }

  private async exportScreenshot(): Promise<void> {
    if (!this.world) return;
    this.renderCurrentFrame();
    document.body.classList.add('photo-capture');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const blob = await new Promise<Blob | null>((resolve) => this.world?.renderer.domElement.toBlob(resolve, 'image/png'));
    document.body.classList.remove('photo-capture');
    if (!blob) return;
    const link = document.createElement('a');
    const preset = this.world.currentCinematicPreset().replaceAll('-', '_');
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

    this.updateFromState(this.simulator.setDriverInput(
      this.state.throttleHeld ? 1 : 0,
      this.state.brakeHeld ? 1 : 0
    ));
  }

  /** Sends current cab/passenger look state to the world camera controller. */
  private setLookInput(): void {
    this.world?.setInteriorLookInput(this.state.lookLeftHeld, this.state.lookRightHeld);
  }

  /** Clears any active touch look gesture and recenters the camera view. */
  private clearLookTouch(): void {
    this.activeLookTouchId = null;

    if (!this.state.lookLeftHeld && !this.state.lookRightHeld) return;

    this.state.lookLeftHeld = false;
    this.state.lookRightHeld = false;
    this.setLookInput();
  }

  private touchDistance(firstTouch: Touch, secondTouch: Touch): number {
    return Math.hypot(
      secondTouch.clientX - firstTouch.clientX,
      secondTouch.clientY - firstTouch.clientY
    );
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
