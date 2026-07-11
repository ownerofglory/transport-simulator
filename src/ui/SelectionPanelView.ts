import type { TransportMode, TransportModeDefinition } from '../domain/transport';
import type { CityDefinition } from '../cities';
import type { DemoRoute } from '../route';
import type { Mode } from '../app/types';

/** City, transport-mode, route, start-station, ride-mode, and time selectors. */
export class SelectionPanelView {
  private readonly cityToolbar = document.createElement('div');
  private readonly transportTabsEl = document.createElement('div');
  private readonly selectsToolbar = document.createElement('div');

  private readonly citySelect: HTMLSelectElement;
  private readonly routeSelect: HTMLSelectElement;
  private readonly stationSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly timeSelect: HTMLSelectElement;

  private transportModeHandler: ((mode: TransportMode) => void | Promise<void>) | null = null;

  constructor() {
    this.cityToolbar.className = 'toolbar city-toolbar';
    this.cityToolbar.innerHTML = `<select data-action="city" aria-label="City"></select>`;

    this.transportTabsEl.className = 'transport-tabs';
    this.transportTabsEl.setAttribute('role', 'tablist');
    this.transportTabsEl.setAttribute('aria-label', 'Means of transport');

    this.selectsToolbar.className = 'toolbar';
    this.selectsToolbar.innerHTML = `
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
    `;

    this.citySelect = this.cityToolbar.querySelector('[data-action="city"]') as HTMLSelectElement;
    this.routeSelect = this.selectsToolbar.querySelector('[data-action="route"]') as HTMLSelectElement;
    this.stationSelect = this.selectsToolbar.querySelector('[data-action="station"]') as HTMLSelectElement;
    this.modeSelect = this.selectsToolbar.querySelector('[data-action="mode"]') as HTMLSelectElement;
    this.timeSelect = this.selectsToolbar.querySelector('[data-action="time"]') as HTMLSelectElement;

    // Delegate tab clicks once so rebuilding tab buttons never re-attaches listeners.
    this.transportTabsEl.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mode-tab]');
      if (!button || button.disabled) return;
      void this.transportModeHandler?.(button.dataset.modeTab as TransportMode);
    });
  }

  /** Appends this view's elements into the given container, in display order. */
  mountInto(container: HTMLElement): void {
    container.append(this.cityToolbar, this.transportTabsEl, this.selectsToolbar);
  }

  setCities(cities: CityDefinition[], selectedCityId: string): void {
    this.citySelect.innerHTML = cities
      .map((city) => `<option value="${city.id}">${city.name}</option>`)
      .join('');
    this.citySelect.value = selectedCityId;
  }

  setCityValue(cityId: string): void {
    this.citySelect.value = cityId;
  }

  setRoutes(routes: DemoRoute[], selectedRouteId: string): void {
    this.routeSelect.innerHTML = routes
      .map((route) => `<option value="${route.id}">${route.line} to ${route.destination}</option>`)
      .join('');
    this.routeSelect.value = selectedRouteId;
  }

  setStations(route: DemoRoute, selectedIndex: number): void {
    const usableStations = route.stations.slice(0, Math.max(1, route.stations.length - 1));
    this.stationSelect.innerHTML = usableStations
      .map((station, index) => `<option value="${index}">${station.name}</option>`)
      .join('');
    this.stationSelect.value = String(Math.min(selectedIndex, Math.max(usableStations.length - 1, 0)));
  }

  setTransportModes(definitions: TransportModeDefinition[], selectedMode: TransportMode): void {
    this.transportTabsEl.innerHTML = definitions
      .map((definition) => `<button role="tab" data-mode-tab="${definition.id}" ${definition.available ? '' : 'disabled'}>${definition.label}</button>`)
      .join('');
    this.setTransportMode(selectedMode);
  }

  setTransportMode(mode: TransportMode): void {
    for (const button of this.transportTabsEl.querySelectorAll<HTMLButtonElement>('[data-mode-tab]')) {
      const selected = button.dataset.modeTab === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    }
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

  dispose(): void {
    this.cityToolbar.remove();
    this.transportTabsEl.remove();
    this.selectsToolbar.remove();
  }
}
