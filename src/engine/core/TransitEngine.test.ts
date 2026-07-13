import { describe, it, expect, vi } from 'vitest';
import type * as THREE from 'three';
import { TransitEngine } from './TransitEngine';
import type { EngineSystem } from './EngineSystem';

function makeEngine() {
  const render = vi.fn();
  const scene = {} as THREE.Scene;
  const camera = {} as THREE.PerspectiveCamera;
  const renderer = { render } as unknown as THREE.WebGLRenderer;
  return { engine: new TransitEngine(scene, camera, renderer), render, scene, camera };
}

/** Records lifecycle calls with a shared log so ordering can be asserted. */
function recordingSystem(name: string, log: string[]): EngineSystem {
  return {
    fixedUpdate: () => log.push(`${name}.fixed`),
    update: () => log.push(`${name}.update`),
    dispose: () => log.push(`${name}.dispose`)
  };
}

describe('TransitEngine', () => {
  it('updates systems in registration order, then renders once', () => {
    const { engine, render, scene, camera } = makeEngine();
    const log: string[] = [];
    engine.register(recordingSystem('a', log));
    engine.register(recordingSystem('b', log));
    engine.update(0.016, 1);
    expect(log).toEqual(['a.update', 'b.update']);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(scene, camera);
  });

  it('runs fixedUpdate for every system without rendering', () => {
    const { engine, render } = makeEngine();
    const log: string[] = [];
    engine.register(recordingSystem('a', log));
    engine.register(recordingSystem('b', log));
    engine.fixedUpdate(1 / 60);
    expect(log).toEqual(['a.fixed', 'b.fixed']);
    expect(render).not.toHaveBeenCalled();
  });

  it('disposes systems in reverse registration order', () => {
    const { engine } = makeEngine();
    const log: string[] = [];
    engine.register(recordingSystem('a', log));
    engine.register(recordingSystem('b', log));
    engine.register(recordingSystem('c', log));
    engine.dispose();
    expect(log).toEqual(['c.dispose', 'b.dispose', 'a.dispose']);
  });

  it('tolerates systems that implement only some hooks', () => {
    const { engine, render } = makeEngine();
    const dispose = vi.fn();
    engine.register({ dispose }); // no update/fixedUpdate
    expect(() => engine.update(0.016, 1)).not.toThrow();
    expect(() => engine.fixedUpdate(0.016)).not.toThrow();
    expect(render).toHaveBeenCalledTimes(1);
    engine.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not re-dispose systems after a dispose', () => {
    const { engine } = makeEngine();
    const dispose = vi.fn();
    engine.register({ dispose });
    engine.dispose();
    engine.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
