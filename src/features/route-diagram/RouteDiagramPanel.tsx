import { useEffect, useRef } from 'react';
import { TransitRouteDiagram } from '../../route-diagram';
import type { DemoRoute } from '../../route';
import type { SimulatorUiSnapshot } from '../simulation/SimulatorSnapshotStore';

/** React wrapper that owns a TransitRouteDiagram (SVG schematic) imperatively. */
export function RouteDiagramPanel({
  route,
  routes,
  snapshot
}: {
  route?: DemoRoute;
  routes: DemoRoute[];
  snapshot: SimulatorUiSnapshot;
}) {
  const el = useRef<HTMLElement>(null);
  const diagram = useRef<TransitRouteDiagram | null>(null);

  useEffect(() => {
    if (!el.current) return;
    diagram.current = new TransitRouteDiagram(el.current);
    return () => {
      diagram.current?.dispose();
      diagram.current = null;
    };
  }, []);

  useEffect(() => {
    if (route) diagram.current?.setRoute(route, routes);
  }, [route, routes]);

  useEffect(() => {
    diagram.current?.update({
      distanceM: snapshot.distanceM,
      doorsOpen: snapshot.doorsOpen,
      stationIndex: snapshot.stationIndex,
      speedMps: snapshot.speedMps
    });
  }, [snapshot]);

  return <section ref={el} className="route-diagram" />;
}
