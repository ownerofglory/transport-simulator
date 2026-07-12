import type { SimulatorCommands } from '../../simulator/SimulatorRuntime';

/** Bottom overlay shown in photo mode: exit, preset label/cycle, screenshot. */
export function PhotoModeOverlay({
  active,
  label,
  commands,
  onExit
}: {
  active: boolean;
  label: string;
  commands: SimulatorCommands;
  onExit: () => void;
}) {
  if (!active) return null;
  return (
    <div className="photo-overlay">
      <button onClick={onExit}>Exit</button>
      <div className="label">{label}</div>
      <button onClick={() => commands.cyclePhotoPreset()}>Angle</button>
      <button onClick={() => void commands.exportScreenshot()}>Screenshot</button>
    </div>
  );
}
