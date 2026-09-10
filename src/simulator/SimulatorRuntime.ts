import { createRouteCurve, routeMode, type DemoRoute } from '../route';
import type { CityDefinition } from '../cities';
import { resolveTransportModeDefinition } from '../domain/transport';
import type { CameraMode } from '../world/CameraController';
import { TransitWorld } from '../world';
import { SimulatorClient } from './SimulatorClient';
import { SimulatorLoop } from '../app/SimulatorLoop';
import type { DebugWeather, Mode, Season, TrafficDensity } from '../app/types';
import type { SimulatorSnapshotStore } from '../features/simulation/SimulatorSnapshotStore';
import { InputState } from '../engine/runtime/InputState';
import { RuntimeMachine } from '../engine/runtime/RuntimeMachine';
import { worldKey } from '../engine/runtime/worldKey';
import { TransitEngine } from '../engine/core/TransitEngine';
import { LegacyWorldSystem } from '../engine/core/LegacyWorldSystem';
import { WorkspaceManager } from '../engine/workspace/WorkspaceManager';
import { SimulationWorkspace } from '../engine/workspace/SimulationWorkspace';
import { PhotoWorkspace } from '../engine/workspace/PhotoWorkspace';
import type { EngineInputEvent } from '../engine/workspace/EngineInputEvent';

/** Everything needed to (re)build the world and initialize the simulator. */
export type RouteSession = {
  route: DemoRoute;
  networkRoutes: DemoRoute[];
  city: CityDefinition;
  mode: Mode;
  startStationIndex: number;
  season: Season;
  time: 'auto' | number;
  cameraMode: CameraMode;
  trafficDensity: TrafficDensity;
  debugWeather: DebugWeather;
};

/** Imperative command surface the React shell drives via effects. */
export type SimulatorCommands = {
  /** Transient held input (throttle/brake/look); written to directly, never via React. */
  readonly input: InputState;
  /** Routes a semantic input event through the active workspace. */
  handleInput(event: EngineInputEvent): boolean;
  loadRoute(session: RouteSession): void;
  setStartStation(session: RouteSession): void;
  setRideMode(session: RouteSession): void;
  resetSimulation(session: RouteSession): void;
  setPaused(paused: boolean): void;
  cycleCamera(): CameraMode | undefined;
  setCameraMode(mode: CameraMode): void;
  adjustZoom(delta: number): void;
  setSeason(season: Season): void;
  setTime(time: 'auto' | number): void;
  setTrafficDensity(density: TrafficDensity): void;
  setDebugWeather(weather: DebugWeather): void;
  togglePhotoMode(): void;
  enterPhotoMode(): void;
  exitPhotoMode(): void;
  onPhotoMode(handler: (active: boolean) => void): void;
  cyclePhotoPreset(): void;
  exportScreenshot(): Promise<void>;
};

/**
 * Owns the Three.js world, the Go/WASM simulator client, and the render loop.
 * React never touches these — it only issues commands and reads snapshots. The
 * world is rebuilt only on loadRoute; other changes re-init the simulator.
 */
export class SimulatorRuntime implements SimulatorCommands {
  readonly input = new InputState();
  // Runtime lifecycle (idle → loading-engine → ready → running/paused → …) lives
  // in an explicit machine instead of loaded/paused/disposed booleans.
  private readonly machine = new RuntimeMachine();
  private readonly simulator = new SimulatorClient();
  private world: TransitWorld | null = null;
  // Owns the render + system loop; wraps the current world via LegacyWorldSystem.
  private engine: TransitEngine | null = null;
  private session: RouteSession | null = null;
  private journeyLegs: DemoRoute[] = [];
  private journeyLegIndex = 0;
  // Input is routed through the active workspace (simulation ↔ photo).
  private readonly workspaces = new WorkspaceManager();
  private readonly simulationWorkspace = new SimulationWorkspace(this);
  private readonly photoWorkspace = new PhotoWorkspace(this);
  private photoActive = false;
  private photoLabelHandler: ((label: string) => void) | null = null;
  private photoModeHandler: ((active: boolean) => void) | null = null;
  private activeRouteHandler: ((route: DemoRoute) => void) | null = null;
  private readonly loop: SimulatorLoop;

  constructor(
    private readonly container: HTMLElement,
    private readonly snapshots: SimulatorSnapshotStore
  ) {
    // Held input goes straight to the simulator/world, never through React.
    this.input.onChange(() => this.applyInput());
    // Start in the driving workspace; photo mode swaps in the photo workspace.
    void this.workspaces.activate(this.simulationWorkspace);
    this.loop = new SimulatorLoop({
      turnaroundMs: 4000,
      getPaused: () => this.machine.matches('paused'),
      getSelectedTime: () => this.session?.time ?? 'auto',
      getCurrentLocalHour: currentLocalHour,
      step: (dt) => this.simulator.step(dt),
      onAutoTimeHour: (hour) => this.world?.setTimeOfDay(hour),
      onState: (state, dt) => {
        this.world?.updateTrain(state.distanceM, state.doorsOpen, dt, state.nextStation);
        this.engine?.update(dt, 1);
        this.snapshots.update(state);
      },
      onTerminalTurnaround: () => this.advanceJourneyLeg()
    });
  }

  /** Loads the WASM simulator; starts the loop and inits the pending session. */
  async load(): Promise<void> {
    this.machine.send({ type: 'LOAD_ENGINE' });
    try {
      await this.simulator.load();
    } catch (error) {
      this.machine.send({ type: 'FAIL', error: error as Error });
      throw error;
    }
    // Guard against React StrictMode's mount→unmount→mount: if this instance was
    // disposed while the WASM load was in flight, do not start its loop.
    if (this.machine.matches('disposed')) return;
    this.machine.send({ type: 'ENGINE_READY' });
    if (this.session) this.resetSimulation(this.session);
    this.loop.start();
  }

  /** Current runtime lifecycle state value (for debugging/telemetry). */
  get lifecycle(): string {
    return this.machine.current.value;
  }

  /** Registers a callback for cinematic-preset label changes (photo overlay). */
  onPhotoLabel(handler: (label: string) => void): void {
    this.photoLabelHandler = handler;
  }

  /** Registers the route currently shown in the world, including transfers. */
  onActiveRoute(handler: (route: DemoRoute) => void): void {
    this.activeRouteHandler = handler;
    if (this.session) handler(this.session.route);
  }

  loadRoute(session: RouteSession): void {
    this.journeyLegs = [session.route, ...(session.route.journeyLegs ?? [])];
    this.journeyLegIndex = 0;
    this.buildWorld({ ...session, route: this.journeyLegs[0], startStationIndex: 0 });
    if (this.machine.engineReady) this.initializeSimulation(this.session!);
  }

  private buildWorld(session: RouteSession): void {
    this.session = session;
    this.activeRouteHandler?.(session.route);
    // Disposing the engine disposes the previous world (via LegacyWorldSystem).
    this.engine?.dispose();
    this.container.replaceChildren();
    this.world = new TransitWorld(
      createRouteCurve(session.route),
      session.route,
      session.networkRoutes,
      session.city,
      resolveTransportModeDefinition(routeMode(session.route), session.city.transportModes)
    );
    this.world.mount(this.container);
    this.engine = new TransitEngine(this.world.scene, this.world.camera, this.world.renderer);
    this.engine.register(new LegacyWorldSystem(this.world));
    this.applyWorldSettings(session);
  }

  setStartStation(session: RouteSession): void {
    this.session = session;
    if (this.machine.engineReady) this.resetSimulation(session);
  }

  setRideMode(session: RouteSession): void {
    this.session = session;
    if (this.machine.engineReady) this.resetSimulation(session);
  }

  resetSimulation(session: RouteSession): void {
    const journeyLegs = [session.route, ...(session.route.journeyLegs ?? [])];
    if (journeyLegs.length > 1) {
      this.journeyLegs = journeyLegs;
      this.journeyLegIndex = 0;
      const firstSession = { ...session, route: journeyLegs[0], startStationIndex: 0 };
      if (this.session?.route !== journeyLegs[0]) this.buildWorld(firstSession);
      else this.session = firstSession;
    } else {
      this.journeyLegs = [session.route];
      this.journeyLegIndex = 0;
      this.session = session;
    }
    if (this.session) this.initializeSimulation(this.session);
  }

  private initializeSimulation(session: RouteSession): void {
    // Reaching a live world+sim is the machine's running state. LOAD_WORLD is
    // valid from ready/running/paused/terminal-dwell, so this also clears a
    // prior pause and completes a terminal turnaround.
    this.machine.send({ type: 'LOAD_WORLD', sessionKey: worldKey(session) });
    this.machine.send({ type: 'WORLD_READY' });
    const state = this.simulator.init({
      line: session.route.line,
      destination: session.route.destination,
      speedLimitMps: session.route.speedLimitMps,
      routeLengthM: session.route.routeLengthM,
      stations: session.route.stations,
      mode: session.mode,
      startStationIndex: session.startStationIndex
    });
    this.loop.setState(state);
    this.snapshots.update(state, true);
  }

  /** Rebuilds the world with the next vehicle type after a journey transfer. */
  private advanceJourneyLeg(): void {
    if (!this.session || this.journeyLegIndex >= this.journeyLegs.length - 1) return;
    // Mark the terminal dwell in the machine; ignored if it already fired, which
    // is the guard against a turnaround running twice.
    this.machine.send({ type: 'TERMINAL_REACHED', at: performance.now() });
    this.journeyLegIndex++;
    const nextSession: RouteSession = {
      ...this.session,
      route: this.journeyLegs[this.journeyLegIndex],
      networkRoutes: [this.journeyLegs[this.journeyLegIndex]],
      startStationIndex: 0
    };
    this.buildWorld(nextSession);
    this.initializeSimulation(nextSession);
  }

  setPaused(paused: boolean): void {
    this.machine.send(paused ? { type: 'PAUSE' } : { type: 'RESUME' });
    if (this.machine.engineReady) this.snapshots.update(this.simulator.setPaused(paused), true);
  }

  /** Forwards the current held input to the simulator (driver mode) and world (look). */
  private applyInput(): void {
    this.world?.setInteriorLookInput(this.input.lookX < 0, this.input.lookX > 0);
    if (this.machine.engineReady && this.session?.mode === 'driver') {
      this.snapshots.update(this.simulator.setDriverInput(this.input.throttle, this.input.brake), true);
    }
  }

  /** Routes a semantic input event through the active workspace (simulation/photo). */
  handleInput(event: EngineInputEvent): boolean {
    return this.workspaces.handleInput(event);
  }

  cycleCamera(): CameraMode | undefined {
    return this.world?.cycleCamera();
  }

  setCameraMode(mode: CameraMode): void {
    if (this.session) this.session.cameraMode = mode;
    this.world?.setCameraMode(mode);
  }

  adjustZoom(delta: number): void {
    this.world?.adjustCameraZoom(delta);
  }

  setSeason(season: Season): void {
    if (this.session) this.session.season = season;
    this.world?.setSeason(season);
  }

  setTime(time: 'auto' | number): void {
    if (this.session) this.session.time = time;
    this.world?.setTimeOfDay(time === 'auto' ? currentLocalHour() : time);
  }

  setTrafficDensity(density: TrafficDensity): void {
    if (this.session) this.session.trafficDensity = density;
    this.world?.setTrafficDensity(density);
  }

  setDebugWeather(weather: DebugWeather): void {
    if (this.session) this.session.debugWeather = weather;
    this.world?.setWeatherOverride(weather === 'auto' ? null : weather);
  }

  /** Registers a callback for photo-mode activation changes (overlay visibility). */
  onPhotoMode(handler: (active: boolean) => void): void {
    this.photoModeHandler = handler;
    handler(this.photoActive);
  }

  togglePhotoMode(): void {
    if (this.photoActive) this.exitPhotoMode();
    else this.enterPhotoMode();
  }

  enterPhotoMode(): void {
    // Switching workspace releases any held driver/look input.
    this.input.reset();
    const result = this.world?.setCinematicMode(true);
    this.photoActive = !!result?.active;
    document.body.classList.toggle('photo-mode', this.photoActive);
    if (result) this.photoLabelHandler?.(result.label);
    this.photoModeHandler?.(this.photoActive);
    void this.workspaces.activate(this.photoWorkspace);
    this.renderNow();
  }

  exitPhotoMode(): void {
    const result = this.world?.setCinematicMode(false);
    this.photoActive = false;
    document.body.classList.remove('photo-mode');
    if (result) this.photoLabelHandler?.(result.label);
    this.photoModeHandler?.(this.photoActive);
    void this.workspaces.activate(this.simulationWorkspace);
    this.renderNow();
  }

  cyclePhotoPreset(): void {
    const result = this.world?.cycleCinematicPreset();
    if (result) this.photoLabelHandler?.(result.label);
    this.renderNow();
  }

  async exportScreenshot(): Promise<void> {
    if (!this.world || !this.session) return;
    this.renderNow();
    document.body.classList.add('photo-capture');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const blob = await new Promise<Blob | null>((resolve) => this.world!.renderer.domElement.toBlob(resolve, 'image/png'));
    document.body.classList.remove('photo-capture');
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.session.city.id}_${this.session.route.line.replace(/[^\w-]+/g, '_')}_${this.world.currentCinematicPreset().replaceAll('-', '_')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /** Stops the loop and disposes the world; called on viewport unmount. */
  dispose(): void {
    this.machine.send({ type: 'DISPOSE' });
    this.input.onChange(null);
    this.input.reset();
    this.photoActive = false;
    this.loop.stop();
    this.loop.setState(null);
    this.engine?.dispose();
    this.engine = null;
    this.world = null;
    this.container.replaceChildren();
    document.body.classList.remove('photo-mode', 'photo-capture');
  }

  private applyWorldSettings(session: RouteSession): void {
    this.world?.setCameraMode(session.cameraMode);
    this.world?.setSeason(session.season);
    this.world?.setTimeOfDay(session.time === 'auto' ? currentLocalHour() : session.time);
    this.world?.setTrafficDensity(session.trafficDensity);
    this.world?.setWeatherOverride(session.debugWeather === 'auto' ? null : session.debugWeather);
  }

  private renderNow(): void {
    const state = this.loop.currentState();
    if (!state || !this.world) return;
    this.world.updateTrain(state.distanceM, state.doorsOpen, 1 / 60, state.nextStation);
    this.engine?.update(1 / 60, 1);
  }
}

const currentLocalHour = (): number => {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
};
