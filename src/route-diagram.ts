import type { DemoRoute } from './route';
import type { SimulatorState } from './wasm';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATION_GAP = 34;
const TOP_PADDING = 26;

export class SsbRouteDiagram {
  private route: DemoRoute | null = null;
  private readonly title: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly stationNodes: SVGCircleElement[] = [];
  private vehicleMarker: SVGGElement | null = null;
  private lastAutoScrollAt = 0;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = `
      <div class="route-diagram-header">
        <div class="label">SSB route schematic</div>
        <div class="route-diagram-title">-</div>
      </div>
      <div class="route-diagram-scroll"><svg aria-label="Selected SSB line schematic"></svg></div>
    `;
    this.title = this.root.querySelector<HTMLElement>('.route-diagram-title')!;
    this.scroll = this.root.querySelector<HTMLElement>('.route-diagram-scroll')!;
    this.svg = this.root.querySelector<SVGSVGElement>('svg')!;
  }

  setRoute(route: DemoRoute): void {
    this.route = route;
    this.stationNodes.length = 0;
    this.svg.replaceChildren();
    this.title.textContent = `${route.line}  ·  ${route.stations[0]?.name ?? ''} → ${route.destination}`;
    this.root.style.setProperty('--route-color', route.color ?? '#ffd900');

    const height = Math.max(130, TOP_PADDING * 2 + Math.max(1, route.stations.length - 1) * STATION_GAP);
    this.svg.setAttribute('viewBox', `0 0 390 ${height}`);
    this.svg.setAttribute('height', String(height));

    const line = this.svgElement('line', 'route-diagram-line');
    line.setAttribute('x1', '30');
    line.setAttribute('x2', '30');
    line.setAttribute('y1', String(TOP_PADDING));
    line.setAttribute('y2', String(height - TOP_PADDING));
    this.svg.appendChild(line);

    route.stations.forEach((station, index) => {
      const y = this.stationY(index);
      const group = this.svgElement('g', 'route-station');
      group.dataset.stationIndex = String(index);
      const node = this.svgElement('circle', 'route-station-node');
      node.setAttribute('cx', '30');
      node.setAttribute('cy', String(y));
      node.setAttribute('r', index === 0 || index === route.stations.length - 1 ? '6.5' : '5');
      const label = this.svgElement('text', 'route-station-label');
      label.setAttribute('x', '48');
      label.setAttribute('y', String(y + 4));
      label.textContent = station.name;
      group.append(node, label);
      this.svg.appendChild(group);
      this.stationNodes.push(node);
    });

    this.vehicleMarker = this.svgElement('g', 'route-vehicle');
    const halo = this.svgElement('circle', 'route-vehicle-halo');
    halo.setAttribute('r', '10');
    const body = this.svgElement('rect', 'route-vehicle-body');
    body.setAttribute('x', '-5');
    body.setAttribute('y', '-8');
    body.setAttribute('width', '10');
    body.setAttribute('height', '16');
    body.setAttribute('rx', '3');
    this.vehicleMarker.append(halo, body);
    this.svg.appendChild(this.vehicleMarker);
    this.updateMarker(0);
  }

  update(state: SimulatorState): void {
    if (!this.route || !this.vehicleMarker) return;
    const distanceM = Math.max(0, Math.min(this.route.routeLengthM, state.distanceM));
    const markerY = this.distanceY(distanceM);
    this.updateMarker(markerY);

    const stoppedIndex = state.doorsOpen ? this.nearestStationIndex(distanceM) : -1;
    const nextIndex = Math.min(this.route.stations.length - 1, Math.max(0, state.stationIndex + (state.doorsOpen ? 0 : 1)));
    const nextStation = this.route.stations[nextIndex];
    const remainingM = nextStation ? nextStation.distanceM - distanceM : Number.POSITIVE_INFINITY;
    const approaching = !state.doorsOpen && remainingM >= 0 && remainingM <= Math.max(450, state.speedMps * 28);

    this.stationNodes.forEach((node, index) => {
      node.classList.toggle('passed', this.route!.stations[index].distanceM < distanceM - 12);
      node.classList.toggle('current', index === stoppedIndex);
      node.classList.toggle('approaching', approaching && index === nextIndex);
    });

    const now = performance.now();
    if (now - this.lastAutoScrollAt > 350) {
      const desired = markerY - this.scroll.clientHeight / 2;
      this.scroll.scrollTop = Math.max(0, Math.min(this.scroll.scrollHeight - this.scroll.clientHeight, desired));
      this.lastAutoScrollAt = now;
    }
  }

  private distanceY(distanceM: number): number {
    const stations = this.route?.stations ?? [];
    if (stations.length < 2) return TOP_PADDING;
    let next = stations.findIndex((station) => station.distanceM >= distanceM);
    if (next <= 0) return this.stationY(Math.max(0, next));
    if (next < 0) return this.stationY(stations.length - 1);
    const previous = next - 1;
    const span = stations[next].distanceM - stations[previous].distanceM || 1;
    const progress = (distanceM - stations[previous].distanceM) / span;
    return this.stationY(previous) + progress * STATION_GAP;
  }

  private nearestStationIndex(distanceM: number): number {
    if (!this.route?.stations.length) return -1;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.route.stations.forEach((station, index) => {
      const distance = Math.abs(station.distanceM - distanceM);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  private updateMarker(y: number): void {
    this.vehicleMarker?.setAttribute('transform', `translate(30 ${y})`);
  }

  private stationY(index: number): number {
    return TOP_PADDING + index * STATION_GAP;
  }

  private svgElement<K extends keyof SVGElementTagNameMap>(tag: K, className: string): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NS, tag);
    element.setAttribute('class', className);
    return element;
  }
}
