import { useEffect, useRef } from 'react';
import { TransitRouteDiagram } from '../../route-diagram';
import type { DemoRoute } from '../../route';
import type { SimulatorUiSnapshot } from '../simulation/SimulatorSnapshotStore';

/** React wrapper that owns a TransitRouteDiagram (SVG schematic) imperatively. */
export function RouteDiagramPanel({
  route,
  routes,
  activeRoute,
  journeyLegs,
  snapshot
}: {
  route?: DemoRoute;
  routes: DemoRoute[];
  activeRoute?: DemoRoute;
  journeyLegs?: DemoRoute[];
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
    if (route) diagram.current?.setRoute(route, routes, journeyLegs);
  }, [route, routes, journeyLegs]);

  useEffect(() => {
    const activeIndex = activeRoute ? routes.findIndex((candidate) => candidate.id === activeRoute.id) : -1;
    const distanceOffset = activeIndex > 0
      ? routes.slice(0, activeIndex).reduce((total, candidate) => total + candidate.routeLengthM, 0)
      : 0;
    const stationOffset = activeIndex > 0
      ? routes.slice(0, activeIndex).reduce((total, candidate) => total + candidate.stations.length, 0)
      : 0;
    diagram.current?.update({
      distanceM: snapshot.distanceM + distanceOffset,
      doorsOpen: snapshot.doorsOpen,
      stationIndex: snapshot.stationIndex + stationOffset,
      speedMps: snapshot.speedMps
    });
  }, [snapshot, activeRoute, routes]);

  return <section ref={el} className="route-diagram" />;
}
