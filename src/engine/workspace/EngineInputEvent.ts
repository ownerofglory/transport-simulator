/**
 * Semantic input the InputController translates physical events into. The
 * controller does not decide which subsystem handles an event — it emits these
 * and the active {@link Workspace} interprets them.
 */
export type EngineInputEvent =
  | { type: 'throttle'; value: number }
  | { type: 'brake'; value: number }
  | { type: 'look'; left: boolean; right: boolean }
  | { type: 'zoom'; delta: number }
  | { type: 'photo-toggle' }
  | { type: 'photo-exit' }
  | { type: 'photo-cycle' };
