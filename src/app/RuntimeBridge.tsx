import { useEffect, useRef } from 'react';
import type { SimulatorRuntime } from '../simulator/SimulatorRuntime';
import { RuntimeReconciler } from '../engine/runtime/RuntimeReconciler';
import type { DesiredRuntimeState } from '../engine/runtime/DesiredRuntimeState';

/**
 * Single bridge between React and the runtime. Replaces AppShell's chain of
 * per-command effects: React computes one {@link DesiredRuntimeState}, the
 * reconciler applies the minimal diff. Renders nothing.
 */
export function RuntimeBridge({
  runtime,
  desired
}: {
  runtime: SimulatorRuntime | null;
  desired: DesiredRuntimeState;
}) {
  const reconciler = useRef<RuntimeReconciler | null>(null);

  useEffect(() => {
    reconciler.current = runtime ? new RuntimeReconciler(runtime) : null;
    // A fresh runtime starts with no prior desired state; apply immediately so
    // the newly mounted world reflects the current selection.
    reconciler.current?.apply(desired);
    // desired intentionally excluded: re-created only when the runtime changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  useEffect(() => {
    reconciler.current?.apply(desired);
  }, [desired]);

  return null;
}
