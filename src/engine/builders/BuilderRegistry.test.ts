import { describe, it, expect } from 'vitest';
import { BuilderRegistry } from './BuilderRegistry';

describe('BuilderRegistry', () => {
  it('registers and resolves builders by key', () => {
    const r = new BuilderRegistry<string, () => string>();
    r.register('bus', () => 'stop').register('rail', () => 'platform');
    expect(r.resolve('bus')()).toBe('stop');
    expect(r.resolve('rail')()).toBe('platform');
  });

  it('has() reports registration', () => {
    const r = new BuilderRegistry<string, number>();
    r.register('a', 1);
    expect(r.has('a')).toBe(true);
    expect(r.has('b')).toBe(false);
  });

  it('resolveOptional returns undefined for an unregistered key', () => {
    const r = new BuilderRegistry<string, number>();
    expect(r.resolveOptional('missing')).toBeUndefined();
  });

  it('resolve throws for an unregistered key', () => {
    const r = new BuilderRegistry<string, number>();
    expect(() => r.resolve('missing')).toThrow(/No builder registered for missing/);
  });

  it('re-registering a key overrides the previous builder', () => {
    const r = new BuilderRegistry<string, number>();
    r.register('a', 1).register('a', 2);
    expect(r.resolve('a')).toBe(2);
  });
});
