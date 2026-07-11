import type { TransportMode, TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from '../cities';
import type { DemoRoute } from '../route';
import type { SimulatorState } from '../simulator/simulator-types';
import type { Mode } from '../app/types';
import { LoadingView } from './LoadingView';
import { AppShellView } from './AppShellView';
import { SelectionPanelView } from './SelectionPanelView';
import { SimulatorStatsView } from './SimulatorStatsView';
import { DriverControlsView } from './DriverControlsView';

/**
 * Composes the HUD from focused view classes (shell, selection panel, stats,
 * driver controls, loading overlay) and exposes a single coordinating API to
 * the app layer. Building the tabs no longer re-attaches listeners, and setCity
 * no longer rebuilds transport tabs.
 */
export class HudView {
  private readonly loading: LoadingView;
  private readonly shell: AppShellView;
  private readonly selection = new SelectionPanelView();
  private readonly stats = new SimulatorStatsView();
  private readonly driver = new DriverControlsView();

  constructor(parent: HTMLElement) {
    this.loading = new LoadingView(parent);
    this.shell = new AppShellView(parent);

    // Content order: selection panel, stats, primary controls, driver controls.
    this.selection.mountInto(this.shell.contentEl);
    this.stats.mountInto(this.shell.contentEl);
    this.shell.contentEl.appendChild(this.shell.controlsEl);
    this.driver.mountInto(this.shell.contentEl);
  }

  setRoutes(routes: DemoRoute[], selectedRouteId: string): void {
    this.selection.setRoutes(routes, selectedRouteId);
  }

  setCities(cities: CityDefinition[], selectedCityId: string): void {
    this.selection.setCities(cities, selectedCityId);
  }

  setCity(city: CityDefinition): void {
    this.selection.setCityValue(city.id);
    this.shell.setTitle(city.menuTitle);
    this.shell.setSubtitle(city.freeRideNotice);
  }

  setStations(route: DemoRoute, selectedIndex: number): void {
    this.selection.setStations(route, selectedIndex);
  }

  setTransportMode(mode: TransportMode): void {
    this.selection.setTransportMode(mode);
  }

  setTransportModes(definitions: TransportModeDefinition[], selectedMode: TransportMode): void {
    this.selection.setTransportModes(definitions, selectedMode);
  }

  setAvailableTransportModes(availableModes: TransportMode[], selectedMode: TransportMode): void {
    this.selection.setAvailableTransportModes(availableModes, selectedMode);
  }

  setMode(mode: Mode): void {
    this.selection.setMode(mode);
  }

  setTime(time: 'auto' | number): void {
    this.selection.setTime(time);
  }

  setPause(paused: boolean): void {
    this.shell.setPause(paused);
  }

  updateSimulatorState(state: SimulatorState): void {
    this.stats.update(state);
    this.shell.setDriverMode(state.mode === 'driver');
  }

  updateNotice(text: string): void {
    this.shell.setNotice(text);
  }

  showLoading(text: string): void {
    this.loading.show(text);
  }

  hideLoading(): void {
    this.loading.hide();
  }

  onTransportModeChange(handler: (mode: TransportMode) => void | Promise<void>): void {
    this.selection.onTransportModeChange(handler);
  }

  onCityChange(handler: (cityId: string) => void | Promise<void>): void {
    this.selection.onCityChange(handler);
  }

  onRouteChange(handler: (routeId: string) => void): void {
    this.selection.onRouteChange(handler);
  }

  onStationChange(handler: (stationIndex: number) => void): void {
    this.selection.onStationChange(handler);
  }

  onModeChange(handler: (mode: Mode) => void): void {
    this.selection.onModeChange(handler);
  }

  onTimeChange(handler: (time: 'auto' | number) => void): void {
    this.selection.onTimeChange(handler);
  }

  onPause(handler: () => void): void {
    this.shell.onPause(handler);
  }

  onCamera(handler: () => void): void {
    this.shell.onCamera(handler);
  }

  onReset(handler: () => void): void {
    this.shell.onReset(handler);
  }

  onPhoto(handler: () => void): void {
    this.shell.onPhoto(handler);
  }

  onDriveInput(handler: (kind: 'throttle' | 'brake', held: boolean) => void): void {
    this.driver.onDriveInput(handler);
  }

  dispose(): void {
    this.driver.dispose();
    this.stats.dispose();
    this.selection.dispose();
    this.shell.dispose();
    this.loading.dispose();
  }
}
