import type { SimulatorConfig, SimulatorState } from './simulator-types';

declare global {
  interface Window {
    // Go runtime constructor is provided by wasm_exec.js.
    Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };

    // Simulator bridge registered by the Go/WASM module.
    ssim?: SimulatorWasmBridge;
  }
}

// String-based Go/WASM bridge; JSON keeps the JS/WASM boundary simple.
type SimulatorWasmBridge = {
  initSim(configJson: string): string;
  stepSim(dtSeconds: number): string;
  resetSim(): string;
  setPaused(paused: boolean): string;
  setDriverInput(throttle: number, brake: number): string;
};

/** Loads one browser script tag and resolves when it is ready. */
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

/** Thin TypeScript client around the Go/WASM simulator bridge. */
export class SimulatorClient {
  // Shared promise prevents duplicate wasm_exec.js / sim.wasm initialization.
  private static wasmReady: Promise<void> | null = null;

  /** Loads wasm_exec.js, instantiates sim.wasm, and waits for window.ssim. */
  async load(): Promise<void> {
    if (window.ssim) return;
    if (SimulatorClient.wasmReady) return SimulatorClient.wasmReady;

    SimulatorClient.wasmReady = (async () => {
      await loadScript('/wasm_exec.js'); // Go-provided JS runtime shim.

      const go = new window.Go();
      const response = await fetch('/sim.wasm'); // compiled Go simulator module.

      if (!response.ok) {
        throw new Error(`Could not fetch sim.wasm: ${response.status}`);
      }

      const bytes = await response.arrayBuffer();
      const result = await WebAssembly.instantiate(bytes, go.importObject);

      // Go registers window.ssim before blocking inside its runtime loop.
      void go.run(result.instance);

      if (!window.ssim) {
        throw new Error('Go WASM loaded, but window.ssim was not registered.');
      }
    })().catch((error) => {
      SimulatorClient.wasmReady = null;
      throw error;
    });

    return SimulatorClient.wasmReady;
  }

  /** Initializes a new simulator session from route/config data. */
  init(config: SimulatorConfig): SimulatorState {
    return this.parse(window.ssim?.initSim(JSON.stringify(config)));
  }

  /** Advances the simulator by one frame delta in seconds. */
  step(dtSeconds: number): SimulatorState {
    return this.parse(window.ssim?.stepSim(dtSeconds));
  }

  /** Resets the current simulator session using its existing config. */
  reset(): SimulatorState {
    return this.parse(window.ssim?.resetSim());
  }

  /** Pauses or resumes simulator stepping without changing the active route. */
  setPaused(paused: boolean): SimulatorState {
    return this.parse(window.ssim?.setPaused(paused));
  }

  /** Sends normalized driver input: 0 means released, 1 means fully held. */
  setDriverInput(throttle: number, brake: number): SimulatorState {
    return this.parse(window.ssim?.setDriverInput(throttle, brake));
  }

  /** Parses JSON returned from Go/WASM and reports missing bridge errors consistently. */
  private parse(json: string | undefined): SimulatorState {
    if (!json) throw new Error('Simulator WASM bridge is not available.');
    return JSON.parse(json) as SimulatorState;
  }
}
