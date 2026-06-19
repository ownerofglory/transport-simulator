declare global {
  interface Window {
    Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
    ssim?: SimulatorWasmBridge;
  }
}

export type StationConfig = {
  name: string;
  distanceM: number;
  scheduledS?: number;
};

export type SimulatorConfig = {
  line: string;
  destination: string;
  routeLengthM: number;
  speedLimitMps: number;
  mode?: 'ride' | 'driver';
  startStationIndex?: number;
  stations: StationConfig[];
};

export type SimulatorState = {
  line: string;
  destination: string;
  distanceM: number;
  speedMps: number;
  nextStation: string;
  stationIndex: number;
  doorsOpen: boolean;
  dwelling: boolean;
  dwellRemainingS: number;
  tripComplete: boolean;
  simTimeS: number;
  mode: 'ride' | 'driver';
  driverScore: number;
  lastStopErrorM: number;
  timetableDeltaS: number;
  safetyEvents: number;
  speeding: boolean;
};

type SimulatorWasmBridge = {
  initSim(configJson: string): string;
  stepSim(dtSeconds: number): string;
  resetSim(): string;
  setPaused(paused: boolean): string;
  setDriverInput(throttle: number, brake: number): string;
};

let wasmReady: Promise<void> | null = null;

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

export async function loadSimulatorWasm(): Promise<void> {
  if (window.ssim) return;
  if (wasmReady) return wasmReady;

  wasmReady = (async () => {
    await loadScript('/wasm_exec.js');
    const go = new window.Go();
    const response = await fetch('/sim.wasm');
    if (!response.ok) {
      throw new Error(`Could not fetch sim.wasm: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, go.importObject);
    void go.run(result.instance);

    // Go registers window.ssim synchronously before blocking on select{}.
    if (!window.ssim) {
      throw new Error('Go WASM loaded, but window.ssim was not registered.');
    }
  })();

  return wasmReady;
}

export function initSimulator(config: SimulatorConfig): SimulatorState {
  const json = window.ssim?.initSim(JSON.stringify(config));
  if (!json) throw new Error('Simulator WASM bridge is not available.');
  return JSON.parse(json) as SimulatorState;
}

export function stepSimulator(dtSeconds: number): SimulatorState {
  const json = window.ssim?.stepSim(dtSeconds);
  if (!json) throw new Error('Simulator WASM bridge is not available.');
  return JSON.parse(json) as SimulatorState;
}

export function resetSimulator(): SimulatorState {
  const json = window.ssim?.resetSim();
  if (!json) throw new Error('Simulator WASM bridge is not available.');
  return JSON.parse(json) as SimulatorState;
}

export function setSimulatorPaused(paused: boolean): SimulatorState {
  const json = window.ssim?.setPaused(paused);
  if (!json) throw new Error('Simulator WASM bridge is not available.');
  return JSON.parse(json) as SimulatorState;
}

export function setDriverInput(throttle: number, brake: number): SimulatorState {
  const json = window.ssim?.setDriverInput(throttle, brake);
  if (!json) throw new Error('Simulator WASM bridge is not available.');
  return JSON.parse(json) as SimulatorState;
}
