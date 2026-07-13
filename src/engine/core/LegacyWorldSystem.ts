import type { TransitWorld } from '../../world';
import type { EngineSystem } from './EngineSystem';

/**
 * Adapter that lets the existing {@link TransitWorld} live inside the engine's
 * system list while it is decomposed into real systems (camera, active vehicle,
 * lighting, environment, …). Rendering is owned by the engine now; this adapter
 * only ties world disposal into the engine's disposal so ownership is explicit.
 *
 * The world's per-frame simulation binding (updateTrain) is still driven
 * directly by SimulatorRuntime and will migrate into ActiveVehicleSystem.
 */
export class LegacyWorldSystem implements EngineSystem {
  constructor(private readonly world: TransitWorld) {}

  dispose(): void {
    this.world.dispose();
  }
}
