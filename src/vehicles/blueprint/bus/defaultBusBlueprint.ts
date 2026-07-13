import rawConfig from '../../configs/vvs-citaro-bus.json';
import { parseBusBlueprint, type BusBlueprintConfig } from './BusBlueprintConfig';

// The built-in SSB/VVS Citaro config ships with the bundle, so validation can
// only fail on a bad code change. Surface that loudly in dev but keep the bus
// working by trusting the raw JSON rather than crashing at import time.
const parsed = parseBusBlueprint(rawConfig);
if (!parsed.ok) {
  console.error('Built-in bus blueprint "vvs-citaro-bus" failed validation:', parsed.errors);
}

export const defaultBusBlueprint: BusBlueprintConfig = parsed.ok ? parsed.config : (rawConfig as unknown as BusBlueprintConfig);
