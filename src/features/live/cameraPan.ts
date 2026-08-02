// Pan convention for the live 3D free-flight camera, kept pure so the drag
// direction is pinned by a test rather than by a sign buried in an event handler.
//
// Convention: the drag moves the *camera*, not the ground. Dragging right pushes
// the view right, so the world appears to slide left; dragging down pushes the
// view forward, into the screen. This is the inverse of a grab-the-map map pan.

const PAN_SCALE_PER_METRE = 0.0018;

export type PlanarVector = { x: number; z: number };

/** Metres of ground movement per pixel of drag, at a given camera distance. */
export function panScale(cameraDistanceM: number): number {
  return cameraDistanceM * PAN_SCALE_PER_METRE;
}

/**
 * Ground-plane offset to add to the orbit target for a drag of (dx, dy) pixels.
 * `right` and `forward` are the camera's horizontal basis vectors.
 */
export function panOffset(
  right: PlanarVector,
  forward: PlanarVector,
  dx: number,
  dy: number,
  scale: number
): PlanarVector {
  return {
    x: (right.x * dx + forward.x * dy) * scale,
    z: (right.z * dx + forward.z * dy) * scale
  };
}
