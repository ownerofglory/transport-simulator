import { useEffect, useRef } from 'react';
import { SimulatorRuntime } from '../../simulator/SimulatorRuntime';
import type { SimulatorSnapshotStore } from './SimulatorSnapshotStore';

/**
 * Mounts the imperative SimulatorRuntime (Three.js canvas) into a plain div.
 * React owns the element lifecycle; the runtime owns everything inside it.
 */
export function SimulatorViewport({
  store,
  onRuntime
}: {
  store: SimulatorSnapshotStore;
  onRuntime: (runtime: SimulatorRuntime | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const runtime = new SimulatorRuntime(containerRef.current, store);
    onRuntime(runtime);
    void runtime.load().catch((error: unknown) => {
      console.error(error);
    });
    return () => {
      onRuntime(null);
      runtime.dispose();
    };
  }, [onRuntime, store]);

  return <div ref={containerRef} className="simulator-viewport" />;
}
