import type { TransportMode, TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from '../cities';
import type { DemoRoute } from '../route';
import type { SimulatorState } from '../simulator/simulator-types';
import type { Mode } from '../app/types';

export class HudView {
  readonly root: HTMLDivElement;
  readonly notice: HTMLDivElement;
  readonly loading: HTMLDivElement;

  private readonly routeSelect: HTMLSelectElement;
  private readonly stationSelect: HTMLSelectElement;
  private readonly citySelect: HTMLSelectElement;
  private readonly transportTabsEl: HTMLDivElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly timeSelect: HTMLSelectElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly photoButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly lineField: HTMLElement;
  private readonly speedField: HTMLElement;
  private readonly stationField: HTMLElement;
  private readonly doorsField: HTMLElement;
  private readonly scoreField: HTMLElement;
  private readonly scheduleField: HTMLElement;
  private transportModeHandler: ((mode: TransportMode) => void | Promise<void>) | null = null;

  constructor(parent: HTMLElement) {
    this.loading = document.createElement('div');
    this.loading.className = 'loading';
    this.loading.textContent = 'Loading VVS GTFS route packages...';
    parent.appendChild(this.loading);

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-header">
        <div><h1>Stuttgart Transit Simulator</h1><div class="label">Free, non-commercial simulator</div></div>
        <button class="menu-toggle" data-action="menu" aria-expanded="true" aria-label="Collapse menu">−</button>
      </div>
      <div class="hud-content">
        <div class="toolbar city-toolbar">
          <select data-action="city" aria-label="City"></select>
        </div>
        <div class="transport-tabs" role="tablist" aria-label="Means of transport"></div>
        <div class="toolbar">
          <select data-action="route" aria-label="Line"></select>
          <select data-action="station" aria-label="Start station"></select>
          <select data-action="mode" aria-label="Mode">
            <option value="ride">Ride</option>
            <option value="driver">Drive</option>
          </select>
          <select data-action="time" aria-label="Time of day">
            <option value="auto" selected>Local time (auto)</option>
            <option value="6">06:00 · Dawn</option><option value="9">09:00 · Morning</option>
            <option value="13">13:00 · Day</option>
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
          <button data-action="pause">Pause</button><button data-action="camera">Camera</button><button data-action="photo">Photo</button><button data-action="reset">Restart</button>
        </div>
        <div class="driver-controls" data-panel="driver">
          <button data-drive="throttle">Throttle</button><button data-drive="brake">Brake</button>
          <div class="hint">W/ArrowUp throttle · S/ArrowDown brake</div>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    this.notice = document.createElement('div');
    this.notice.className = 'notice';
    parent.appendChild(this.notice);

    this.routeSelect = this.root.querySelector('[data-action="route"]') as HTMLSelectElement;
    this.stationSelect = this.root.querySelector('[data-action="station"]') as HTMLSelectElement;
    this.citySelect = this.root.querySelector('[data-action="city"]') as HTMLSelectElement;
    this.transportTabsEl = this.root.querySelector('.transport-tabs') as HTMLDivElement;
    this.modeSelect = this.root.querySelector('[data-action="mode"]') as HTMLSelectElement;
    this.timeSelect = this.root.querySelector('[data-action="time"]') as HTMLSelectElement;
    this.pauseButton = this.root.querySelector('[data-action="pause"]') as HTMLButtonElement;
    this.cameraButton = this.root.querySelector('[data-action="camera"]') as HTMLButtonElement;
    this.photoButton = this.root.querySelector('[data-action="photo"]') as HTMLButtonElement;
    this.resetButton = this.root.querySelector('[data-action="reset"]') as HTMLButtonElement;
    this.menuButton = this.root.querySelector('[data-action="menu"]') as HTMLButtonElement;
    this.titleEl = this.root.querySelector('.hud-header h1') as HTMLHeadingElement;
    this.subtitleEl = this.root.querySelector('.hud-header .label') as HTMLDivElement;
    this.lineField = this.root.querySelector('[data-field="line"]') as HTMLElement;
    this.speedField = this.root.querySelector('[data-field="speed"]') as HTMLElement;
    this.stationField = this.root.querySelector('[data-field="station"]') as HTMLElement;
    this.doorsField = this.root.querySelector('[data-field="doors"]') as HTMLElement;
    this.scoreField = this.root.querySelector('[data-field="score"]') as HTMLElement;
    this.scheduleField = this.root.querySelector('[data-field="schedule"]') as HTMLElement;

    this.menuButton.addEventListener('click', () => {
      this.setCollapsed(!this.root.classList.contains('collapsed'));
    });

    this.setCollapsed(window.matchMedia('(max-width: 760px)').matches);
  }

  private setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle('collapsed', collapsed);
    this.menuButton.textContent = collapsed ? '+' : '−';
    this.menuButton.setAttribute('aria-expanded', String(!collapsed));
    this.menuButton.setAttribute('aria-label', collapsed ? 'Expand menu' : 'Collapse menu');
  }

  setRoutes(routes: DemoRoute[], selectedRouteId: string): void {
    this.routeSelect.innerHTML = routes
      .map((route) => `<option value="${route.id}">${route.line} to ${route.destination}</option>`)
      .join('');
    this.routeSelect.value = selectedRouteId;
  }

  setCities(cities: CityDefinition[], selectedCityId: string): void {
    this.citySelect.innerHTML = cities
      .map((city) => `<option value="${city.id}">${city.name}</option>`)
      .join('');
    this.citySelect.value = selectedCityId;
  }

  setCity(city: CityDefinition): void {
    this.citySelect.value = city.id;
    this.titleEl.textContent = city.menuTitle;
    this.subtitleEl.textContent = city.freeRideNotice;
    this.setTransportModes(city.transportModes, city.defaultTransportMode);
  }

  setStations(route: DemoRoute, selectedIndex: number): void {
    const usableStations = route.stations.slice(0, Math.max(1, route.stations.length - 1));
    this.stationSelect.innerHTML = usableStations
      .map((station, index) => `<option value="${index}">${station.name}</option>`)
      .join('');
    this.stationSelect.value = String(Math.min(selectedIndex, Math.max(usableStations.length - 1, 0)));
  }

  setTransportMode(mode: TransportMode): void {
    for (const button of this.transportTabsEl.querySelectorAll<HTMLButtonElement>('[data-mode-tab]')) {
      const selected = button.dataset.modeTab === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    }
  }

  setTransportModes(definitions: TransportModeDefinition[], selectedMode: TransportMode): void {
    this.transportTabsEl.innerHTML = definitions
      .map((definition) => `<button role="tab" data-mode-tab="${definition.id}" ${definition.available ? '' : 'disabled'}>${definition.label}</button>`)
      .join('');
    for (const button of this.transportTabsEl.querySelectorAll<HTMLButtonElement>('[data-mode-tab]')) {
      button.addEventListener('click', () => this.transportModeHandler?.(button.dataset.modeTab as TransportMode));
    }
    this.setTransportMode(selectedMode);
  }

  setAvailableTransportModes(availableModes: TransportMode[], selectedMode: TransportMode): void {
    const enabled = new Set(availableModes);
    for (const button of this.transportTabsEl.querySelectorAll<HTMLButtonElement>('[data-mode-tab]')) {
      const mode = button.dataset.modeTab as TransportMode;
      const available = enabled.has(mode);
      button.disabled = !available;
      const selected = available && mode === selectedMode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('disabled', !available);
    }
  }

  setMode(mode: Mode): void {
    this.modeSelect.value = mode;
  }

  setTime(time: 'auto' | number): void {
    this.timeSelect.value = String(time);
  }

  setPause(paused: boolean): void {
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }

  updateSimulatorState(state: SimulatorState): void {
    this.lineField.textContent = `${state.line} -> ${state.destination}`;
    this.speedField.textContent = `${Math.round(state.speedMps * 3.6)} km/h`;
    this.stationField.textContent = state.tripComplete ? 'Trip complete' : state.nextStation;
    this.doorsField.textContent = state.doorsOpen ? `Open ${state.dwellRemainingS.toFixed(0)}s` : 'Closed';
    this.scoreField.textContent = state.mode === 'driver' ? String(state.driverScore) : '-';
    this.scheduleField.textContent = state.mode === 'driver'
      ? `${state.timetableDeltaS >= 0 ? '+' : ''}${state.timetableDeltaS.toFixed(0)}s`
      : '-';
    this.root.classList.toggle('driver-mode', state.mode === 'driver');
  }

  updateNotice(text: string): void {
    this.notice.textContent = text;
  }

  showLoading(text: string): void {
    this.loading.textContent = text;
    this.loading.classList.remove('hidden');
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  onTransportModeChange(handler: (mode: TransportMode) => void | Promise<void>): void {
    this.transportModeHandler = handler;
  }

  onCityChange(handler: (cityId: string) => void | Promise<void>): void {
    this.citySelect.addEventListener('change', (event) => handler((event.target as HTMLSelectElement).value));
  }

  onRouteChange(handler: (routeId: string) => void): void {
    this.routeSelect.addEventListener('change', (event) => handler((event.target as HTMLSelectElement).value));
  }

  onStationChange(handler: (stationIndex: number) => void): void {
    this.stationSelect.addEventListener('change', (event) => handler(Number((event.target as HTMLSelectElement).value)));
  }

  onModeChange(handler: (mode: Mode) => void): void {
    this.modeSelect.addEventListener('change', (event) => handler((event.target as HTMLSelectElement).value as Mode));
  }

  onTimeChange(handler: (time: 'auto' | number) => void): void {
    this.timeSelect.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      handler(value === 'auto' ? 'auto' : Number(value));
    });
  }

  onPause(handler: () => void): void {
    this.pauseButton.addEventListener('click', handler);
  }

  onCamera(handler: () => void): void {
    this.cameraButton.addEventListener('click', handler);
  }

  onReset(handler: () => void): void {
    this.resetButton.addEventListener('click', handler);
  }

  onPhoto(handler: () => void): void {
    this.photoButton.addEventListener('click', handler);
  }

  onDriveInput(handler: (kind: 'throttle' | 'brake', held: boolean) => void): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
      const kind = button.dataset.drive as 'throttle' | 'brake';
      button.addEventListener('pointerdown', () => handler(kind, true));
      button.addEventListener('pointerup', () => handler(kind, false));
      button.addEventListener('pointerleave', () => handler(kind, false));
    }
  }
}
