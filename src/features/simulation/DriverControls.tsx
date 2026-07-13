import { useContext } from 'react';
import { SimulatorCommandsContext } from './useSimulatorRuntime';

/** Pointer throttle/brake buttons (visible only in driver mode via CSS). */
export function DriverControls() {
  // The runtime mounts asynchronously; tolerate its absence during early renders.
  const commands = useContext(SimulatorCommandsContext);
  const bind = (control: 'throttle' | 'brake') => ({
    onPointerDown: () => set(control, 1),
    onPointerUp: () => set(control, 0),
    onPointerLeave: () => set(control, 0)
  });
  const set = (control: 'throttle' | 'brake', value: number) => {
    if (!commands) return;
    if (control === 'throttle') commands.input.setThrottle(value);
    else commands.input.setBrake(value);
  };
  return (
    <div className="driver-controls">
      <button {...bind('throttle')}>Throttle</button>
      <button {...bind('brake')}>Brake</button>
      <div className="hint">W/ArrowUp throttle · S/ArrowDown brake</div>
    </div>
  );
}
