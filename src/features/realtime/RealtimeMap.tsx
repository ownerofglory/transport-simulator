import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export type MapPoint = { lat: number; lon: number };
export type PinKind = 'origin' | 'destination' | 'stop' | 'active';
export type MapPin = { id: string; lat: number; lon: number; kind: PinKind; title?: string; onClick?: () => void };

const STUTTGART: [number, number] = [48.7758, 9.1829];

const PIN_COLORS: Record<PinKind, string> = {
  origin: '#37d67a',
  destination: '#ff5c5c',
  stop: '#4aa8ff',
  active: '#ffd900'
};

/**
 * Interactive Leaflet map shared by the realtime modals: renders point pins and
 * an optional route path, and reports map clicks for pick-on-map workflows.
 */
export function RealtimeMap({
  pins,
  path,
  hint,
  onMapClick,
  fit = true
}: {
  pins: MapPin[];
  path?: MapPoint[] | null;
  hint?: string;
  onMapClick?: (point: MapPoint) => void;
  fit?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const pathLayer = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  // Create the map once; keep it alive for the modal's lifetime.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(STUTTGART, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => clickRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    pinLayer.current = L.layerGroup().addTo(map);
    pathLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Leaflet mis-measures a container that mounted this frame inside the modal.
    const raf = requestAnimationFrame(() => map.invalidateSize());
    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw pins and path, then fit the view to whatever geometry exists.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pinLayer.current || !pathLayer.current) return;
    pinLayer.current.clearLayers();
    pathLayer.current.clearLayers();

    for (const pin of pins) {
      const marker = L.circleMarker([pin.lat, pin.lon], {
        radius: pin.kind === 'stop' ? 7 : 9,
        color: '#0b1017',
        weight: 2,
        fillColor: PIN_COLORS[pin.kind],
        fillOpacity: 0.95
      });
      if (pin.title) marker.bindTooltip(pin.title, { direction: 'top' });
      if (pin.onClick) marker.on('click', (e) => { L.DomEvent.stop(e); pin.onClick!(); });
      marker.addTo(pinLayer.current);
    }

    const latLngs: L.LatLngExpression[] = [];
    if (path && path.length >= 2) {
      const line = path.map((p): L.LatLngExpression => [p.lat, p.lon]);
      L.polyline(line, { color: '#ffd900', weight: 5, opacity: 0.9 }).addTo(pathLayer.current);
      latLngs.push(...line);
    }
    for (const pin of pins) latLngs.push([pin.lat, pin.lon]);

    if (fit && latLngs.length) {
      const bounds = L.latLngBounds(latLngs);
      if (latLngs.length === 1) map.setView(latLngs[0] as [number, number], 14);
      else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    }
  }, [pins, path, fit]);

  return (
    <div className="rt-map">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {hint && <div className="rt-map-hint">{hint}</div>}
    </div>
  );
}
