import { describe, it, expect, vi } from 'vitest';
import { WorkspaceManager } from './WorkspaceManager';
import { SimulationWorkspace } from './SimulationWorkspace';
import { PhotoWorkspace } from './PhotoWorkspace';
import type { Workspace, WorkspaceTarget } from './Workspace';

function makeTarget() {
  return {
    input: { setThrottle: vi.fn(), setBrake: vi.fn(), setLook: vi.fn(), reset: vi.fn() },
    adjustZoom: vi.fn(),
    enterPhotoMode: vi.fn(),
    exitPhotoMode: vi.fn(),
    cyclePhotoPreset: vi.fn()
  } satisfies WorkspaceTarget;
}

function recordingWorkspace(id: string, log: string[]): Workspace {
  return {
    id,
    enter: vi.fn(() => void log.push(`${id}.enter`)),
    exit: vi.fn(() => void log.push(`${id}.exit`)),
    handleInput: () => false
  };
}

describe('WorkspaceManager', () => {
  it('enters the first workspace and reports the active id', async () => {
    const log: string[] = [];
    const manager = new WorkspaceManager();
    await manager.activate(recordingWorkspace('a', log));
    expect(log).toEqual(['a.enter']);
    expect(manager.activeId).toBe('a');
  });

  it('exits the previous workspace before entering the next', async () => {
    const log: string[] = [];
    const manager = new WorkspaceManager();
    await manager.activate(recordingWorkspace('a', log));
    await manager.activate(recordingWorkspace('b', log));
    expect(log).toEqual(['a.enter', 'a.exit', 'b.enter']);
  });

  it('activating the same workspace twice is a no-op', async () => {
    const log: string[] = [];
    const manager = new WorkspaceManager();
    const a = recordingWorkspace('a', log);
    await manager.activate(a);
    await manager.activate(a);
    expect(log).toEqual(['a.enter']);
  });

  it('routes input to the active workspace only', async () => {
    const manager = new WorkspaceManager();
    const consumed: Workspace = { id: 'x', enter: () => {}, exit: () => {}, handleInput: () => true };
    await manager.activate(consumed);
    expect(manager.handleInput({ type: 'zoom', delta: 1 })).toBe(true);
  });

  it('returns false when there is no active workspace', () => {
    const manager = new WorkspaceManager();
    expect(manager.handleInput({ type: 'photo-exit' })).toBe(false);
  });
});

describe('SimulationWorkspace', () => {
  it('routes driving input, zoom, and photo-toggle', () => {
    const target = makeTarget();
    const ws = new SimulationWorkspace(target);
    expect(ws.handleInput({ type: 'throttle', value: 1 })).toBe(true);
    expect(target.input.setThrottle).toHaveBeenCalledWith(1);
    ws.handleInput({ type: 'brake', value: 0.5 });
    expect(target.input.setBrake).toHaveBeenCalledWith(0.5);
    ws.handleInput({ type: 'look', left: true, right: false });
    expect(target.input.setLook).toHaveBeenCalledWith(true, false);
    ws.handleInput({ type: 'zoom', delta: -1 });
    expect(target.adjustZoom).toHaveBeenCalledWith(-1);
    ws.handleInput({ type: 'photo-toggle' });
    expect(target.enterPhotoMode).toHaveBeenCalledTimes(1);
  });

  it('releases held input on exit', () => {
    const target = makeTarget();
    new SimulationWorkspace(target).exit();
    expect(target.input.reset).toHaveBeenCalledTimes(1);
  });

  it('ignores photo-exit/cycle', () => {
    const target = makeTarget();
    const ws = new SimulationWorkspace(target);
    expect(ws.handleInput({ type: 'photo-exit' })).toBe(false);
    expect(ws.handleInput({ type: 'photo-cycle' })).toBe(false);
  });
});

describe('PhotoWorkspace', () => {
  it('resets input on enter and exits on photo-exit/toggle', () => {
    const target = makeTarget();
    const ws = new PhotoWorkspace(target);
    ws.enter();
    expect(target.input.reset).toHaveBeenCalledTimes(1);
    expect(ws.handleInput({ type: 'photo-exit' })).toBe(true);
    expect(target.exitPhotoMode).toHaveBeenCalledTimes(1);
    ws.handleInput({ type: 'photo-toggle' });
    expect(target.exitPhotoMode).toHaveBeenCalledTimes(2);
  });

  it('cycles preset and zooms', () => {
    const target = makeTarget();
    const ws = new PhotoWorkspace(target);
    ws.handleInput({ type: 'photo-cycle' });
    expect(target.cyclePhotoPreset).toHaveBeenCalledTimes(1);
    ws.handleInput({ type: 'zoom', delta: 2 });
    expect(target.adjustZoom).toHaveBeenCalledWith(2);
  });

  it('swallows driving input so it never reaches the simulator', () => {
    const target = makeTarget();
    const ws = new PhotoWorkspace(target);
    expect(ws.handleInput({ type: 'throttle', value: 1 })).toBe(true);
    expect(target.input.setThrottle).not.toHaveBeenCalled();
  });
});
