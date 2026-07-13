import { describe, it, expect } from 'vitest';
import {
  bootstrapInitialState,
  bootstrapTransition,
  type LoadedCatalog
} from './bootstrapMachine';

const catalog = { cities: [], routes: [], availableModes: [], attribution: '' } as unknown as LoadedCatalog;

describe('bootstrapTransition', () => {
  it('walks cities → manifest → routes → ready', () => {
    let s = bootstrapInitialState();
    expect(s.value).toBe('loading-cities');
    s = bootstrapTransition(s, { type: 'LOAD_MANIFEST', cityId: 'stuttgart' });
    expect(s).toEqual({ value: 'loading-manifest', cityId: 'stuttgart' });
    s = bootstrapTransition(s, { type: 'LOAD_ROUTES', cityId: 'stuttgart', mode: 'stadtbahn', operationId: 1 });
    expect(s.value).toBe('loading-routes');
    s = bootstrapTransition(s, { type: 'ROUTES_LOADED', operationId: 1, catalog });
    expect(s.value).toBe('ready');
  });

  it('rejects a stale ROUTES_LOADED from a superseded operation', () => {
    let s = bootstrapTransition(
      bootstrapTransition(bootstrapInitialState(), { type: 'LOAD_MANIFEST', cityId: 'ulm' }),
      { type: 'LOAD_ROUTES', cityId: 'ulm', mode: 'stadtbahn', operationId: 2 }
    );
    // A response tagged with the old operation id must not flip to ready.
    const stale = bootstrapTransition(s, { type: 'ROUTES_LOADED', operationId: 1, catalog });
    expect(stale).toBe(s);
  });

  it('lets a newer city selection supersede an in-flight route load', () => {
    const routing = bootstrapTransition(
      bootstrapTransition(bootstrapInitialState(), { type: 'LOAD_MANIFEST', cityId: 'ulm' }),
      { type: 'LOAD_ROUTES', cityId: 'ulm', mode: 'stadtbahn', operationId: 1 }
    );
    const next = bootstrapTransition(routing, { type: 'LOAD_MANIFEST', cityId: 'odessa' });
    expect(next).toEqual({ value: 'loading-manifest', cityId: 'odessa' });
    // The stale ulm response can no longer overwrite the odessa selection.
    expect(bootstrapTransition(next, { type: 'ROUTES_LOADED', operationId: 1, catalog }).value).toBe('loading-manifest');
  });

  it('ignores a scoped failure from a superseded operation but applies unscoped failures', () => {
    const routing = bootstrapTransition(
      bootstrapTransition(bootstrapInitialState(), { type: 'LOAD_MANIFEST', cityId: 'ulm' }),
      { type: 'LOAD_ROUTES', cityId: 'ulm', mode: 'stadtbahn', operationId: 5 }
    );
    expect(bootstrapTransition(routing, { type: 'FAIL', operationId: 4, error: new Error('stale') })).toBe(routing);
    expect(bootstrapTransition(routing, { type: 'FAIL', error: new Error('fatal') }).value).toBe('failed');
  });
});
