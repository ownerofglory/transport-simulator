import { useEffect, useId, useRef } from 'react';
import { TransitRouteDiagram } from '../../route-diagram';
import type { DemoRoute } from '../../route';
import type { SimulatorUiSnapshot } from '../simulation/SimulatorSnapshotStore';
import { useCompactPanel } from '../../app/useCompactPanel';

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
  const el = useRef<HTMLDivElement>(null);
  const mobileList = useRef<HTMLOListElement>(null);
  const diagram = useRef<TransitRouteDiagram | null>(null);
  const { compact, collapsed, setCollapsed } = useCompactPanel();
  const expanded = !collapsed;
  const contentId = useId();
  const activeIndex = route ? Math.min(
    route.stations.length - 1,
    Math.max(0, snapshot.stationIndex + (activeRoute && journeyLegs
      ? journeyLegs.slice(0, Math.max(0, journeyLegs.findIndex((leg) => leg.id === activeRoute.id)))
        .reduce((count, leg) => count + leg.stations.length, 0)
      : 0) + (snapshot.doorsOpen ? 0 : 1))
  ) : 0;

  useEffect(() => {
    if (!compact || !expanded || !mobileList.current) return;
    const activeRow = mobileList.current.children[activeIndex] as HTMLElement | undefined;
    if (activeRow) mobileList.current.scrollTop = Math.max(0, activeRow.offsetTop - mobileList.current.clientHeight / 2);
  }, [compact, expanded, activeIndex, route?.id]);

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
    // Catalog routes are alternatives, not consecutive segments. Only a
    // transfer journey needs a cumulative offset in the combined schematic.
    const activeIndex = activeRoute && journeyLegs ? journeyLegs.findIndex((candidate) => candidate.id === activeRoute.id) : -1;
    const distanceOffset = activeIndex > 0
      ? journeyLegs!.slice(0, activeIndex).reduce((total, candidate) => total + candidate.routeLengthM, 0)
      : 0;
    const stationOffset = activeIndex > 0
      ? journeyLegs!.slice(0, activeIndex).reduce((total, candidate) => total + candidate.stations.length, 0)
      : 0;
    diagram.current?.update({
      distanceM: snapshot.distanceM + distanceOffset,
      doorsOpen: snapshot.doorsOpen,
      stationIndex: snapshot.stationIndex + stationOffset,
      speedMps: snapshot.speedMps
    });
  }, [snapshot, activeRoute, journeyLegs]);

  return (
    <section className={`route-diagram ${expanded ? 'expanded' : ''}`} aria-label="Route schematic">
      <button
        type="button"
        className="route-diagram-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={expanded ? 'Collapse route schematic' : 'Expand route schematic'}
        onClick={() => setCollapsed(value => !value)}
      >
        <span className="route-diagram-heading">
          <span className="label">Route schematic</span>
          <span className="route-diagram-title">{route ? `${route.line} · ${route.stations[0]?.name ?? ''} → ${route.destination}` : 'Select a route'}</span>
        </span>
        <span className="route-diagram-mobile-summary" aria-hidden>
          <span className="route-diagram-mobile-line">{route?.line ?? 'Route'}</span>
          <span className="route-diagram-mobile-next">{snapshot.tripComplete ? 'Trip complete' : `Next · ${snapshot.nextStation || route?.destination || 'Select route'}`}</span>
        </span>
        <span className="route-diagram-chevron" aria-hidden>{expanded ? '⌃' : '⌄'}</span>
      </button>
      <div ref={el} id={contentId} className="route-diagram-content" hidden={!expanded} />
      {compact && expanded && route && (
        <ol ref={mobileList} className="route-diagram-mobile-list" aria-label="Stations on route">
          {route.stations.map((station, index) => (
            <li
              key={`${index}-${station.name}`}
              className={index < activeIndex ? 'passed' : index === activeIndex ? 'current' : ''}
              aria-current={index === activeIndex ? 'step' : undefined}
            >
              <span>{station.name}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
