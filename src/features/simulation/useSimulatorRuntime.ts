import { createContext, useContext } from 'react';
import type { SimulatorCommands } from '../../simulator/SimulatorRuntime';

export const SimulatorCommandsContext = createContext<SimulatorCommands | null>(null);

export function useSimulatorRuntime(): SimulatorCommands {
  const commands = useContext(SimulatorCommandsContext);
  if (!commands) throw new Error('Simulator runtime is not mounted');
  return commands;
}
