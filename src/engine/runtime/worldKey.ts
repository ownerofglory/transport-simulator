import { routeMode } from '../../route';
import type { RouteSession } from '../../simulator/SimulatorRuntime';

/**
 * Structural identity of a world. When this key changes the world must be fully
 * rebuilt (terrain, scenery, vehicle); when only other session/presentation
 * fields change, existing systems are updated in place instead.
 */
export function worldKey(session: RouteSession): string {
  return [
    session.city.id,
    session.route.id,
    session.route.shapeId ?? '',
    session.route.vehicleDesignId ?? '',
    routeMode(session.route)
  ].join(':');
}
