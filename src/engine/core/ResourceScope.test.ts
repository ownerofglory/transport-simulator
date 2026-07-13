import { describe, it, expect, vi } from 'vitest';
import { ResourceScope, type Disposable } from './ResourceScope';

const disposable = (): Disposable & { dispose: ReturnType<typeof vi.fn> } => ({ dispose: vi.fn() });

describe('ResourceScope', () => {
  it('disposes every tracked resource once', () => {
    const scope = new ResourceScope();
    const a = disposable();
    const b = disposable();
    scope.track(a);
    scope.track(b);
    scope.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });

  it('returns the tracked value for inline use', () => {
    const scope = new ResourceScope();
    const a = disposable();
    expect(scope.track(a)).toBe(a);
  });

  it('does not dispose a released resource', () => {
    const scope = new ResourceScope();
    const a = disposable();
    scope.track(a);
    scope.release(a);
    scope.dispose();
    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('immediately disposes resources tracked after disposal (no leak)', () => {
    const scope = new ResourceScope();
    scope.dispose();
    expect(scope.isDisposed).toBe(true);
    const late = disposable();
    scope.track(late);
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });

  it('clears its set so a second dispose does not re-dispose', () => {
    const scope = new ResourceScope();
    const a = disposable();
    scope.track(a);
    scope.dispose();
    scope.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
  });
});
