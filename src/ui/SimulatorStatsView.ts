import type { SimulatorState } from '../simulator/simulator-types';

/** Live simulator readouts: line, speed, next station, doors, and driver stats. */
export class SimulatorStatsView {
  readonly root = document.createElement('div');
  private readonly lineField: HTMLElement;
  private readonly speedField: HTMLElement;
  private readonly stationField: HTMLElement;
  private readonly doorsField: HTMLElement;
  private readonly scoreField: HTMLElement;
  private readonly scheduleField: HTMLElement;

  constructor() {
    this.root.className = 'meta';
    this.root.innerHTML = `
      <div class="card"><div class="label">Line</div><div class="value" data-field="line">-</div></div>
      <div class="card"><div class="label">Speed</div><div class="value" data-field="speed">-</div></div>
      <div class="card"><div class="label">Next station</div><div class="value" data-field="station">-</div></div>
      <div class="card"><div class="label">Doors</div><div class="value" data-field="doors">-</div></div>
      <div class="card driver-stat"><div class="label">Score</div><div class="value" data-field="score">-</div></div>
      <div class="card driver-stat"><div class="label">Schedule</div><div class="value" data-field="schedule">-</div></div>
    `;

    this.lineField = this.field('line');
    this.speedField = this.field('speed');
    this.stationField = this.field('station');
    this.doorsField = this.field('doors');
    this.scoreField = this.field('score');
    this.scheduleField = this.field('schedule');
  }

  /** Appends this view's element into the given container. */
  mountInto(container: HTMLElement): void {
    container.appendChild(this.root);
  }

  update(state: SimulatorState): void {
    this.lineField.textContent = `${state.line} -> ${state.destination}`;
    this.speedField.textContent = `${Math.round(state.speedMps * 3.6)} km/h`;
    this.stationField.textContent = state.tripComplete ? 'Trip complete' : state.nextStation;
    this.doorsField.textContent = state.doorsOpen ? `Open ${state.dwellRemainingS.toFixed(0)}s` : 'Closed';
    this.scoreField.textContent = state.mode === 'driver' ? String(state.driverScore) : '-';
    this.scheduleField.textContent = state.mode === 'driver'
      ? `${state.timetableDeltaS >= 0 ? '+' : ''}${state.timetableDeltaS.toFixed(0)}s`
      : '-';
  }

  dispose(): void {
    this.root.remove();
  }

  private field(name: string): HTMLElement {
    return this.root.querySelector(`[data-field="${name}"]`) as HTMLElement;
  }
}
