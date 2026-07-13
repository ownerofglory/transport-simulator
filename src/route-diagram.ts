import type { DemoRoute } from './route';
import type { SimulatorState } from './simulator/simulator-types';

// The diagram only needs a few live fields; accepting a subset lets the React
// snapshot drive it without constructing a full SimulatorState.
export type RouteDiagramProgress = Pick<SimulatorState, 'distanceM' | 'doorsOpen' | 'stationIndex' | 'speedMps'>;

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATION_GAP = 34;
const TOP_PADDING = 26;

export class TransitRouteDiagram {
  private route: DemoRoute | null = null;
  private stationTransfers = new Map<string, string[]>();
  private readonly title: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly stationNodes: SVGCircleElement[] = [];
  private readonly stationXs: number[] = [];
  private vehicleMarker: SVGGElement | null = null;
  private lastAutoScrollAt = 0;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = `
      <div class="route-diagram-header">
        <div class="label">Transit route schematic</div>
        <div class="route-diagram-title">-</div>
      </div>
      <div class="route-diagram-scroll"><svg aria-label="Selected transit line schematic"></svg></div>
    `;
    this.title = this.root.querySelector<HTMLElement>('.route-diagram-title')!;
    this.scroll = this.root.querySelector<HTMLElement>('.route-diagram-scroll')!;
    this.svg = this.root.querySelector<SVGSVGElement>('svg')!;
  }

  /** Clears the diagram DOM; used when the owning React panel unmounts. */
  dispose(): void {
    this.root.replaceChildren();
  }

  setRoute(route: DemoRoute, networkRoutes: DemoRoute[] = [route], journeyLegs?: DemoRoute[]): void {
    this.route = route;
    this.stationTransfers = this.computeTransfers(route, networkRoutes);
    this.stationNodes.length = 0;
    this.stationXs.length = 0;
    this.svg.replaceChildren();
    this.title.textContent = `${route.line}  ·  ${route.stations[0]?.name ?? ''} → ${route.destination}`;
    this.root.style.setProperty('--route-color', route.color ?? '#ffd900');

    const height = Math.max(130, TOP_PADDING * 2 + Math.max(1, route.stations.length - 1) * STATION_GAP);
    this.svg.setAttribute('viewBox', `0 0 390 ${height}`);
    this.svg.setAttribute('height', String(height));

    const legOffsets = journeyLegs?.reduce<number[]>((offsets, leg) => {
      offsets.push((offsets.at(-1) ?? 0) + leg.stations.length);
      return offsets;
    }, [0]);
    const stationX = (index: number): number => {
      if (!journeyLegs?.length || !legOffsets) return 30;
      const legIndex = Math.max(0, legOffsets.findIndex((offset, candidate) => index < offset && candidate > 0));
      return 30 + (legIndex % 3) * 104;
    };
    if (journeyLegs?.length && legOffsets) {
      const colors = ['#ffd900', '#62c9ff', '#f28b6b', '#9ee493'];
      journeyLegs.forEach((leg, legIndex) => {
        const start = legOffsets[legIndex];
        const end = legOffsets[legIndex + 1] - 1;
        const x = stationX(start);
        const segment = this.svgElement('line', 'route-diagram-line');
        segment.setAttribute('x1', String(x));
        segment.setAttribute('x2', String(x));
        segment.setAttribute('y1', String(this.stationY(start)));
        segment.setAttribute('y2', String(this.stationY(end)));
        segment.setAttribute('stroke', colors[legIndex % colors.length]);
        this.svg.appendChild(segment);

        const label = this.svgElement('text', 'route-station-transfer');
        label.setAttribute('x', String(x + 12));
        label.setAttribute('y', String(Math.max(15, this.stationY(start) - 12)));
        label.textContent = `${leg.line} → ${leg.destination}`;
        this.svg.appendChild(label);
        if (legIndex >= journeyLegs.length - 1) return;
        const nextStart = legOffsets[legIndex + 1];
        const connector = this.svgElement('line', 'route-diagram-line');
        connector.setAttribute('x1', String(x));
        connector.setAttribute('y1', String(this.stationY(end)));
        connector.setAttribute('x2', String(stationX(nextStart)));
        connector.setAttribute('y2', String(this.stationY(nextStart)));
        connector.setAttribute('stroke-dasharray', '4 4');
        this.svg.appendChild(connector);
        const transfer = this.svgElement('text', 'route-station-transfer');
        transfer.setAttribute('x', String(Math.min(x, stationX(nextStart)) + 12));
        transfer.setAttribute('y', String((this.stationY(end) + this.stationY(nextStart)) / 2 + 4));
        const seconds = leg.transferAfterS;
        transfer.textContent = seconds === undefined ? 'Transfer' : `Transfer · ${Math.round(seconds / 60)} min`;
        this.svg.appendChild(transfer);
      });
    } else {
      const line = this.svgElement('line', 'route-diagram-line');
      line.setAttribute('x1', '30');
      line.setAttribute('x2', '30');
      line.setAttribute('y1', String(TOP_PADDING));
      line.setAttribute('y2', String(height - TOP_PADDING));
      this.svg.appendChild(line);
    }

    route.stations.forEach((station, index) => {
      const y = this.stationY(index);
      const x = stationX(index);
      const group = this.svgElement('g', 'route-station');
      group.dataset.stationIndex = String(index);
      const node = this.svgElement('circle', 'route-station-node');
      node.setAttribute('cx', String(x));
      node.setAttribute('cy', String(y));
      node.setAttribute('r', index === 0 || index === route.stations.length - 1 ? '6.5' : '5');
      const label = this.svgElement('text', 'route-station-label');
      label.setAttribute('x', String(x + 18));
      label.setAttribute('y', String(y + 4));
      label.textContent = station.name;
      const transfers = this.stationTransfers.get(station.name) ?? [];
      if (transfers.length) {
        const transferText = this.svgElement('tspan', 'route-station-transfer');
        transferText.textContent = `  ·  ${transfers.join(' ')}`;
        label.appendChild(transferText);
      }
      group.append(node, label);
      this.svg.appendChild(group);
      this.stationNodes.push(node);
      this.stationXs.push(x);
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
    this.updateMarker(this.stationXs[0] ?? 30, 0);
  }

  update(state: RouteDiagramProgress): void {
    if (!this.route || !this.vehicleMarker) return;
    const distanceM = Math.max(0, Math.min(this.route.routeLengthM, state.distanceM));
    const { x: markerX, y: markerY } = this.distancePosition(distanceM);
    this.updateMarker(markerX, markerY);

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

  private distancePosition(distanceM: number): { x: number; y: number } {
    const stations = this.route?.stations ?? [];
    if (stations.length < 2) return { x: this.stationXs[0] ?? 30, y: TOP_PADDING };
    let next = stations.findIndex((station) => station.distanceM >= distanceM);
    if (next <= 0) return { x: this.stationXs[Math.max(0, next)] ?? 30, y: this.stationY(Math.max(0, next)) };
    if (next < 0) return { x: this.stationXs.at(-1) ?? 30, y: this.stationY(stations.length - 1) };
    const previous = next - 1;
    const span = stations[next].distanceM - stations[previous].distanceM || 1;
    const progress = (distanceM - stations[previous].distanceM) / span;
    return {
      x: (this.stationXs[previous] ?? 30) + ((this.stationXs[next] ?? 30) - (this.stationXs[previous] ?? 30)) * progress,
      y: this.stationY(previous) + progress * STATION_GAP
    };
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

  private updateMarker(x: number, y: number): void {
    this.vehicleMarker?.setAttribute('transform', `translate(${x} ${y})`);
  }

  private computeTransfers(route: DemoRoute, networkRoutes: DemoRoute[]): Map<string, string[]> {
    const transfers = new Map<string, Set<string>>();
    const currentStations = new Set(route.stations.map((station) => station.name));
    for (const candidate of networkRoutes) {
      if (candidate.id === route.id || candidate.line === route.line) continue;
      for (const station of candidate.stations) {
        if (!currentStations.has(station.name)) continue;
        let stationTransfers = transfers.get(station.name);
        if (!stationTransfers) {
          stationTransfers = new Set<string>();
          transfers.set(station.name, stationTransfers);
        }
        stationTransfers.add(candidate.line);
      }
    }
    return new Map(
      [...transfers.entries()].map(([stationName, lines]) => [stationName, [...lines].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))])
    );
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
