import type { Dispatch } from 'react';
import type { AppAction } from '../../app/app-actions';

/** Pointer throttle/brake buttons (visible only in driver mode via CSS). */
export function DriverControls({ dispatch }: { dispatch: Dispatch<AppAction> }) {
  const bind = (type: 'throttle-changed' | 'brake-changed') => ({
    onPointerDown: () => dispatch({ type, held: true }),
    onPointerUp: () => dispatch({ type, held: false }),
    onPointerLeave: () => dispatch({ type, held: false })
  });
  return (
    <div className="driver-controls">
      <button {...bind('throttle-changed')}>Throttle</button>
      <button {...bind('brake-changed')}>Brake</button>
      <div className="hint">W/ArrowUp throttle · S/ArrowDown brake</div>
    </div>
  );
}
