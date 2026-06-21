import type { SimulatorConfig, SimulatorState } from './simulator-types';

declare global {
  interface Window {
    Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
    ssim?: SimulatorWasmBridge;
  }
}

type SimulatorWasmBridge = {
  initSim(configJson: string): string;
  stepSim(dtSeconds: number): string;
  resetSim(): string;
  setPaused(paused: boolean): string;
  setDriverInput(throttle: number, brake: number): string;
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export class SimulatorClient {
  private wasmReady: Promise<void> | null = null;

  async load(): Promise<void> {
    if (window.ssim) return;
    if (this.wasmReady) return this.wasmReady;

    this.wasmReady = (async () => {
      await loadScript('/wasm_exec.js');
      const go = new window.Go();
      const response = await fetch('/sim.wasm');
      if (!response.ok) {
        throw new Error(`Could not fetch sim.wasm: ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const result = await WebAssembly.instantiate(bytes, go.importObject);
      void go.run(result.instance);
      if (!window.ssim) {
        throw new Error('Go WASM loaded, but window.ssim was not registered.');
      }
    })();

    return this.wasmReady;
  }

  init(config: SimulatorConfig): SimulatorState {
    return this.parse(window.ssim?.initSim(JSON.stringify(config)));
  }

  step(dtSeconds: number): SimulatorState {
    return this.parse(window.ssim?.stepSim(dtSeconds));
  }

  reset(): SimulatorState {
    return this.parse(window.ssim?.resetSim());
  }

  setPaused(paused: boolean): SimulatorState {
    return this.parse(window.ssim?.setPaused(paused));
  }

  setDriverInput(throttle: number, brake: number): SimulatorState {
    return this.parse(window.ssim?.setDriverInput(throttle, brake));
  }

  private parse(json: string | undefined): SimulatorState {
    if (!json) throw new Error('Simulator WASM bridge is not available.');
    return JSON.parse(json) as SimulatorState;
  }
}
