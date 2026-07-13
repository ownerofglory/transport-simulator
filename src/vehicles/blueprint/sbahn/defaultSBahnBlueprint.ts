import rawConfig from '../../configs/db-br430-sbahn.json';
import { parseSBahnBlueprint, type SBahnBlueprintConfig } from './SBahnBlueprintConfig';

// The built-in DB BR 430 config ships with the bundle, so validation can only
// fail on a bad code change. Surface that loudly in dev but keep the S-Bahn
// working by trusting the raw JSON rather than crashing at import time.
const parsed = parseSBahnBlueprint(rawConfig);
if (!parsed.ok) {
  console.error('Built-in S-Bahn blueprint "db-br430-sbahn" failed validation:', parsed.errors);
}

export const defaultSBahnBlueprint: SBahnBlueprintConfig = parsed.ok ? parsed.config : (rawConfig as unknown as SBahnBlueprintConfig);
