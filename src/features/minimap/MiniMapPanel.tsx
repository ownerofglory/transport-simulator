import { useEffect, useRef } from 'react';
import { VehicleMiniMap } from '../../minimap';
import type { DemoRoute } from '../../route';

/** React wrapper that owns a VehicleMiniMap (Leaflet) instance imperatively. */
export function MiniMapPanel({ route, distanceM }: { route?: DemoRoute; distanceM: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<VehicleMiniMap | null>(null);

  useEffect(() => {
    if (!el.current) return;
    map.current = new VehicleMiniMap(el.current);
    return () => {
      map.current?.dispose();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!route) return;
    map.current?.setRoute(route);
    const handle = window.setTimeout(() => map.current?.invalidateSize(), 0);
    return () => window.clearTimeout(handle);
  }, [route]);

  useEffect(() => map.current?.update(distanceM), [distanceM]);

  return <div ref={el} className="minimap" tabIndex={0} aria-label="Route minimap" />;
}
