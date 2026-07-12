import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DemoRoute } from './route';
import { bearing, geoPoints, interpolate, pointDistance, type GeoPoint } from './minimap/route-position';

export class VehicleMiniMap {
  private map: L.Map;
  private routeLine?: L.Polyline;
  private marker: L.Marker;
  private routePoints: GeoPoint[] = [];
  private cumulativeDistances: number[] = [];
  private readonly markerEl = document.createElement('div');

  constructor(target: HTMLElement) {
    this.map = L.map(target, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.markerEl.className = 'vehicle-marker';
    this.markerEl.innerHTML = '<span></span>';
    this.marker = L.marker([48.7758, 9.1829], {
      icon: L.divIcon({
        className: 'vehicle-marker-wrap',
        html: this.markerEl,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
      interactive: false
    }).addTo(this.map);
  }

  setRoute(route: DemoRoute): void {
    this.routePoints = geoPoints(route);
    this.cumulativeDistances = [0];
    for (let i = 1; i < this.routePoints.length; i++) {
      this.cumulativeDistances.push(this.cumulativeDistances[i - 1] + pointDistance(this.routePoints[i - 1], this.routePoints[i]));
    }

    this.routeLine?.remove();
    if (this.routePoints.length < 2) return;

    const latLngs = this.routePoints.map((p) => L.latLng(p.lat, p.lon));
    this.routeLine = L.polyline(latLngs, {
      color: route.color ?? '#ffd900',
      weight: 5,
      opacity: 0.9
    }).addTo(this.map);
    this.map.fitBounds(this.routeLine.getBounds(), { padding: [12, 12], animate: false });
    this.update(0);
  }

  update(distanceM: number): void {
    if (this.routePoints.length < 2) return;
    const total = this.cumulativeDistances[this.cumulativeDistances.length - 1] || 1;
    const target = Math.max(0, Math.min(total, distanceM));
    let index = 1;
    while (index < this.cumulativeDistances.length - 1 && this.cumulativeDistances[index] < target) index++;

    const prevDistance = this.cumulativeDistances[index - 1];
    const nextDistance = this.cumulativeDistances[index];
    const t = (target - prevDistance) / Math.max(1, nextDistance - prevDistance);
    const pos = interpolate(this.routePoints[index - 1], this.routePoints[index], t);
    const heading = bearing(this.routePoints[index - 1], this.routePoints[index]);

    this.marker.setLatLng([pos.lat, pos.lon]);
    this.markerEl.style.transform = `rotate(${heading}deg)`;
    this.map.panTo([pos.lat, pos.lon], { animate: false });
  }

  invalidateSize(): void {
    this.map.invalidateSize();
  }

  /** Tears down the Leaflet map and its DOM/event listeners. */
  dispose(): void {
    this.routeLine?.remove();
    this.marker.remove();
    this.map.remove();
  }
}
