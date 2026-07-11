import { createRouteCurve, routeMode, type DemoRoute } from '../route';
import { resolveTransportModeDefinition } from '../domain/transport';
import { TransitWorld } from '../world';
import { SimulatorClient } from '../simulator/SimulatorClient';
import type { SimulatorConfig, SimulatorState } from '../simulator/simulator-types';
import type { CameraMode } from '../world/CameraController';
import type { CityDefinition } from '../cities';
import { SimulatorLoop } from './SimulatorLoop';
import type { Mode, Season } from './types';

// Delay before automatically starting the opposite direction after reaching a terminal.
const TERMINAL_TURNAROUND_MS = 4000;

/** Immutable snapshot of everything needed to (re)build the world and simulator. */
export type RouteSession = {
  route: DemoRoute;
  networkRoutes: DemoRoute[];
  city: CityDefinition;
  rideMode: Mode;
  startStationIndex: number;
  cameraMode: CameraMode;
  season: Season;
  lookLeftHeld: boolean;
  lookRightHeld: boolean;
};

/** Hooks the runtime uses to read app state and notify UI/coordination layers. */
export type SimulatorRuntimeDeps = {
  getPaused: () => boolean;
  getSelectedTime: () => 'auto' | number;
  getCurrentLocalHour: () => number;
  // Per animation frame after the world is updated/rendered (UI: minimap, HUD, diagram).
  onFrame: (state: SimulatorState, dt: number) => void;
  // Discrete simulator state change (init/reset/pause/driver input) for HUD/diagram.
  onDiscreteState: (state: SimulatorState) => void;
  // After a world (re)build, so route-linked UI (minimap, diagram) can refresh.
  onWorldReady: (world: TransitWorld, route: DemoRoute) => void;
  onTerminalTurnaround: () => void;
};

/**
 * Owns the active Three.js world, the Go/WASM simulator client, the render loop,
 * and the selected-route lifecycle. UI panels stay in the app layer and are fed
 * through the {@link SimulatorRuntimeDeps} callbacks.
 */
export class SimulatorRuntime {
  private readonly simulator = new SimulatorClient();
  private readonly loop: SimulatorLoop;
  private activeWorld: TransitWorld | null = null;
  private session: RouteSession | null = null;
  // Route the current world geometry was built for; lets non-geometry changes
  // (start station, ride mode, restart) skip the expensive world rebuild.
  private builtRouteId: string | null = null;

  constructor(
    private readonly appEl: HTMLElement,
    private readonly deps: SimulatorRuntimeDeps
  ) {
    this.loop = new SimulatorLoop({
      turnaroundMs: TERMINAL_TURNAROUND_MS,
      getPaused: () => this.deps.getPaused(),
      getSelectedTime: () => this.deps.getSelectedTime(),
      getCurrentLocalHour: () => this.deps.getCurrentLocalHour(),
      step: (dt) => this.simulator.step(dt),
      onAutoTimeHour: (hour) => this.activeWorld?.setTimeOfDay(hour),
      onState: (state, dt) => this.handleFrame(state, dt),
      onTerminalTurnaround: () => this.deps.onTerminalTurnaround()
    });
  }

  /** The active world, exposed for camera/cinematic/screenshot access. */
  get world(): TransitWorld | null {
    return this.activeWorld;
  }

  /** Loads the Go/WASM simulator module. */
  load(): Promise<void> {
    return this.simulator.load();
  }

  /** Starts the render/simulation loop. */
  startLoop(): void {
    this.loop.start();
  }

  /** Latest simulator state known to the loop. */
  currentState(): SimulatorState | null {
    return this.loop.currentState();
  }

  /** Rebuilds the world for a new route/city and initializes the simulator. */
  loadRoute(session: RouteSession): SimulatorState {
    this.session = session;
    this.buildWorld(session);
    return this.initSimulator(session);
  }

  /**
   * Applies a new start station by re-initializing the simulator and letting
   * the next frame reposition the train. The world (terrain, OSM scenery,
   * stations, vehicle) is preserved because the route geometry is unchanged.
   */
  setStartStation(session: RouteSession): SimulatorState {
    return this.reinitPreservingWorld(session);
  }

  /**
   * Applies a new ride/driver mode by re-initializing the simulator only; the
   * world does not depend on ride mode, so its geometry is preserved.
   */
  setRideMode(session: RouteSession): SimulatorState {
    return this.reinitPreservingWorld(session);
  }

  /**
   * Restarts the current ride. When the route geometry is unchanged this only
   * resets the simulator session and keeps the existing world.
   */
  resetSimulation(session: RouteSession): SimulatorState {
    this.session = session;
    if (this.needsWorldRebuild(session)) {
      this.buildWorld(session);
      return this.initSimulator(session);
    }
    return this.applyDiscrete(this.simulator.reset());
  }

  /** Pauses or resumes simulator stepping. */
  setPaused(paused: boolean): SimulatorState {
    return this.applyDiscrete(this.simulator.setPaused(paused));
  }

  /** Sends normalized driver throttle/brake input to the simulator. */
  setDriverInput(throttle: number, brake: number): SimulatorState {
    return this.applyDiscrete(this.simulator.setDriverInput(throttle, brake));
  }

  /** Cycles the world camera mode, returning the new mode if a world exists. */
  cycleCamera(): CameraMode | undefined {
    return this.activeWorld?.cycleCamera();
  }

  /** Applies interior look input (cab/passenger swivel) to the camera. */
  setInteriorLook(leftHeld: boolean, rightHeld: boolean): void {
    this.activeWorld?.setInteriorLookInput(leftHeld, rightHeld);
  }

  /** Adjusts camera zoom by a normalized delta. */
  adjustZoom(delta: number): void {
    this.activeWorld?.adjustCameraZoom(delta);
  }

  /** Applies the seasonal scenery/lighting look. */
  setSeason(season: Season): void {
    this.activeWorld?.setSeason(season);
  }

  /** Applies a time-of-day, resolving 'auto' to the current local hour. */
  setTime(selectedTime: 'auto' | number): void {
    this.activeWorld?.setTimeOfDay(selectedTime === 'auto' ? this.deps.getCurrentLocalHour() : selectedTime);
  }

  /** Renders one immediate frame from the latest state (e.g. while paused). */
  renderFrame(): void {
    const state = this.loop.currentState();
    if (!state || !this.activeWorld) return;
    this.activeWorld.updateTrain(state.distanceM, state.doorsOpen, 1 / 60, state.nextStation);
    this.activeWorld.render();
  }

  /** Disposes the world and stops the loop. */
  dispose(): void {
    this.loop.stop();
    this.activeWorld?.dispose();
    this.activeWorld = null;
    this.session = null;
    this.builtRouteId = null;
  }

  /** True when the world must be rebuilt because route geometry changed (or none exists). */
  private needsWorldRebuild(session: RouteSession): boolean {
    return !this.activeWorld || this.builtRouteId !== session.route.id;
  }

  /** Re-inits the simulator, rebuilding the world only if route geometry changed. */
  private reinitPreservingWorld(session: RouteSession): SimulatorState {
    this.session = session;
    if (this.needsWorldRebuild(session)) this.buildWorld(session);
    return this.initSimulator(session);
  }

  private handleFrame(state: SimulatorState, dt: number): void {
    if (!this.activeWorld) return;
    this.activeWorld.updateTrain(state.distanceM, state.doorsOpen, dt, state.nextStation);
    this.activeWorld.render();
    this.deps.onFrame(state, dt);
  }

  private applyDiscrete(state: SimulatorState): SimulatorState {
    this.loop.setState(state);
    this.deps.onDiscreteState(state);
    return state;
  }

  private buildWorld(session: RouteSession): void {
    this.activeWorld?.dispose();
    this.appEl.replaceChildren();

    const world = new TransitWorld(
      createRouteCurve(session.route),
      session.route,
      session.networkRoutes,
      session.city,
      resolveTransportModeDefinition(routeMode(session.route), session.city.transportModes)
    );

    world.mount(this.appEl);
    world.setCameraMode(session.cameraMode);
    world.setInteriorLookInput(session.lookLeftHeld, session.lookRightHeld);
    world.setSeason(session.season);
    world.setTimeOfDay(this.resolvedHour());

    this.activeWorld = world;
    this.builtRouteId = session.route.id;
    this.deps.onWorldReady(world, session.route);
  }

  private initSimulator(session: RouteSession): SimulatorState {
    return this.applyDiscrete(this.simulator.init(this.routeConfig(session)));
  }

  private routeConfig(session: RouteSession): SimulatorConfig {
    return {
      line: session.route.line,
      destination: session.route.destination,
      speedLimitMps: session.route.speedLimitMps,
      routeLengthM: session.route.routeLengthM,
      stations: session.route.stations,
      mode: session.rideMode,
      startStationIndex: session.startStationIndex
    };
  }

  private resolvedHour(): number {
    const time = this.deps.getSelectedTime();
    return time === 'auto' ? this.deps.getCurrentLocalHour() : time;
  }
}
