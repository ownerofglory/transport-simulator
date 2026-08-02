import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { LiveVehicleStore, TrackedVehicle } from './LiveVehicleStore';
import { delayLevel, modeColor } from './liveTypes';
import type { BBox } from './viewport';

// Whole-VVS overview: the S-Bahn bounding box, city tier by default (§2.2).
const STUTTGART_CENTER: [number, number] = [48.7827, 9.18];
const INITIAL_ZOOM = 11;
// Line badges fade in below the mid-altitude band (§2.3); on the map that is
// district zoom and closer.
const BADGE_MIN_ZOOM = 13;

function boundsToBBox(b: L.LatLngBounds): BBox {
  return { latMin: b.getSouth(), lonMin: b.getWest(), latMax: b.getNorth(), lonMax: b.getEast() };
}

function markerHtml(v: TrackedVehicle, delayObserved: boolean): string {
  const color = modeColor(v.data.mode);
  const planned = v.data.source === 'schedule';
  const delay = delayLevel(v.data.delaySeconds, delayObserved);
  const line = v.data.line ?? '';
  return (
    `<span class="lv-arrow" style="--c:${color}"></span>` +
    `<span class="lv-badge lv-delay-${delay}">${escapeHtml(line)}</span>` +
    (planned ? '<span class="lv-planned" title="Scheduled position"></span>' : '')
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/**
 * Full-screen Leaflet map that renders the live vehicle store. It reports its
 * viewport up (for tier/bbox polling) and animates markers from the store every
 * frame — the store owns interpolation, this component only paints it.
 */
export function LiveMap({
  store,
  onViewportChange,
  onSelect,
  selectedRunId,
  followRunId,
  delayObserved = false,
  initialView
}: {
  store: LiveVehicleStore;
  onViewportChange: (bbox: BBox, zoom: number) => void;
  onSelect: (runId: string | null) => void;
  selectedRunId: string | null;
  followRunId: string | null;
  /** False while the backend cannot observe delay — see `delayObservedFor`. */
  delayObserved?: boolean;
  /** Restores map center/zoom when returning from the 3D view. */
  initialView?: { lat: number; lon: number; zoom: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const bearings = useRef(new Map<string, number>());
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Latest prop values read inside the imperative loop without re-subscribing.
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedRunId);
  selectedRef.current = selectedRunId;
  const followRef = useRef(followRunId);
  followRef.current = followRunId;
  const delayObservedRef = useRef(delayObserved);
  delayObservedRef.current = delayObserved;

  // Create the map once and drive the animation loop for its lifetime.
  useEffect(() => {
    if (!containerRef.current) return;
    const startCenter: [number, number] = initialView ? [initialView.lat, initialView.lon] : STUTTGART_CENTER;
    const startZoom = initialView ? initialView.zoom : INITIAL_ZOOM;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView(
      startCenter,
      startZoom
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    mapRef.current = map;

    const report = () => onViewportRef.current(boundsToBBox(map.getBounds()), map.getZoom());
    map.on('moveend', report);
    map.on('zoomend', report);
    map.on('click', () => onSelectRef.current(null));
    // Leaflet mis-measures a container that just mounted; settle then report.
    const raf = requestAnimationFrame(() => {
      map.invalidateSize();
      report();
    });

    const frame = (time: number) => {
      const dt = lastTimeRef.current ? Math.min(0.1, (time - lastTimeRef.current) / 1000) : 0.016;
      lastTimeRef.current = time;
      store.tick(dt);
      reconcile(map);
      // Follow mode keeps the camera locked to the vehicle (chase framing §2.4).
      const followed = followRef.current ? store.get(followRef.current) : undefined;
      if (followed) map.setView([followed.render.lat, followed.render.lon], map.getZoom(), { animate: false });
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTimeRef.current = 0;
      markers.current.clear();
      bearings.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Restyle selection/follow highlight when it changes (loop reads the refs too,
  // but this makes the change immediate without waiting a frame).
  useEffect(() => {
    for (const [runId, marker] of markers.current) applyHighlight(marker, runId, selectedRunId, followRunId);
  }, [selectedRunId, followRunId]);

  function reconcile(map: L.Map) {
    const showBadges = map.getZoom() >= BADGE_MIN_ZOOM;
    const live = new Set<string>();

    for (const v of store.list()) {
      live.add(v.runId);
      let marker = markers.current.get(v.runId);
      if (!marker) {
        marker = L.marker([v.render.lat, v.render.lon], {
          icon: L.divIcon({
            className: 'lv-icon',
            html: markerHtml(v, delayObservedRef.current),
            iconSize: [26, 26],
            iconAnchor: [13, 13]
          }),
          keyboard: false,
          riseOnHover: true
        });
        marker.on('click', (e) => {
          L.DomEvent.stop(e);
          onSelectRef.current(v.runId);
        });
        marker.addTo(map);
        markers.current.set(v.runId, marker);
        applyHighlight(marker, v.runId, selectedRef.current, followRef.current);
      } else {
        marker.setLatLng([v.render.lat, v.render.lon]);
      }
      updateMarkerElement(marker, v, showBadges);
    }

    // Despawn markers whose runs left the store.
    for (const [runId, marker] of markers.current) {
      if (live.has(runId)) continue;
      marker.remove();
      markers.current.delete(runId);
      bearings.current.delete(runId);
    }
  }

  function updateMarkerElement(marker: L.Marker, v: TrackedVehicle, showBadges: boolean) {
    const el = marker.getElement();
    if (!el) return;
    const arrow = el.querySelector<HTMLElement>('.lv-arrow');
    if (arrow) {
      const prev = bearings.current.get(v.runId);
      // Only touch the DOM when the heading actually changed.
      if (prev === undefined || Math.abs(prev - v.bearing) > 1) {
        arrow.style.transform = `rotate(${v.bearing}deg)`;
        bearings.current.set(v.runId, v.bearing);
      }
    }
    const badge = el.querySelector<HTMLElement>('.lv-badge');
    if (badge) {
      badge.style.display = showBadges && v.data.line ? '' : 'none';
      // Delay severity changes over a run's life (and flips wholesale once the
      // backend can observe delay at all), so restyle rather than leaving the
      // class the marker was created with.
      const level = delayLevel(v.data.delaySeconds, delayObservedRef.current);
      const cls = `lv-badge lv-delay-${level}`;
      if (badge.className !== cls) badge.className = cls;
    }
  }

  return (
    <div className="lv-map">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

function applyHighlight(marker: L.Marker, runId: string, selected: string | null, followed: string | null) {
  const el = marker.getElement();
  if (!el) return;
  el.classList.toggle('lv-selected', runId === selected);
  el.classList.toggle('lv-followed', runId === followed);
}
