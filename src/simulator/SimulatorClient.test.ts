import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.ssim;
  document.querySelectorAll('script[src="/wasm_exec.js"]').forEach(script => script.remove());
});

it('shares one WASM startup across StrictMode runtime instances', async () => {
  vi.resetModules();
  const { SimulatorClient } = await import('./SimulatorClient');
  const bridge = {} as NonNullable<Window['ssim']>;
  const run = vi.fn(() => { window.ssim = bridge; return new Promise<void>(() => {}); });
  vi.stubGlobal('Go', class { importObject = {}; run = run; });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({ exports: {}, instance: {} } as
    WebAssembly.Instance & WebAssembly.WebAssemblyInstantiatedSource);
  const first = new SimulatorClient().load();
  const second = new SimulatorClient().load();
  const scripts = document.querySelectorAll('script[src="/wasm_exec.js"]');
  expect(scripts).toHaveLength(1);
  scripts[0].dispatchEvent(new Event('load'));
  await Promise.all([first, second]);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledOnce();
  expect(window.ssim).toBe(bridge);
});
