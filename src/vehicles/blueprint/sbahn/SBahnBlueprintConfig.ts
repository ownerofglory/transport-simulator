import { collectMaterialConfigErrors, type BlueprintStandardMaterialConfig } from '../standardMaterial';

// Declarative configuration for the BR 430-family S-Bahn/metro renderer. The
// config owns livery materials, car formation, door/window/seat layout, the
// end logo and display colors. Fixed BR 430 styling (body cross-section, nose
// profile, cab detailing, ...) lives in buildSBahnFromBlueprint.ts.

export const SBAHN_MATERIAL_ROLES = [
  'shell',
  'accent',
  'dark',
  'glass',
  'interior',
  'floor',
  'seat',
  'metal',
  'headlight',
  'tailLamp'
] as const;

export type SBahnMaterialRole = (typeof SBAHN_MATERIAL_ROLES)[number];

export type SBahnBlueprintConfig = {
  id: string;
  kind: 's-bahn';
  displayName: string;
  materials: Record<SBahnMaterialRole, BlueprintStandardMaterialConfig>;
  // Operator logo shown on both cab ends.
  logo: {
    text: string;
    background: string;
    foreground: string;
  };
  destinationDisplay: {
    background: string;
    foreground: string;
  };
  formation: {
    // Car centre offsets along the train; first/last cars get cab ends.
    carCenters: number[];
    halfLengthM: number;
    sectionNamePrefix: string;
  };
  // Per-car layout, all z positions in car-local metres.
  layout: {
    doorZs: number[];
    windowZs: number[];
    seatRowZs: number[];
    seatXs: number[];
    poleZs: number[];
    bogieZs: number[];
  };
  pantograph: {
    x: number;
    y: number;
    z: number;
  };
  headlightBeamHeightM: number;
};

export type SBahnBlueprintParseResult =
  | { ok: true; config: SBahnBlueprintConfig }
  | { ok: false; errors: string[] };

// Narrows an untrusted value (e.g. a user-edited JSON file) into an
// SBahnBlueprintConfig. Never throws; malformed input is reported as errors.
export function parseSBahnBlueprint(raw: unknown): SBahnBlueprintParseResult {
  const errors: string[] = [];
  const root = asRecord(raw, 'config', errors);
  if (!root) return { ok: false, errors };

  requireString(root, 'id', errors);
  requireString(root, 'displayName', errors);
  if (root.kind !== 's-bahn') errors.push('kind must be "s-bahn"');

  const materials = asRecord(root.materials, 'materials', errors);
  if (materials) {
    for (const role of SBAHN_MATERIAL_ROLES) {
      collectMaterialConfigErrors(materials[role], `materials.${role}`, errors);
    }
  }

  for (const [key, fields] of [
    ['logo', ['text', 'background', 'foreground']],
    ['destinationDisplay', ['background', 'foreground']]
  ] as const) {
    const record = asRecord(root[key], key, errors);
    if (record) for (const field of fields) requireString(record, field, errors, `${key}.`);
  }

  const formation = asRecord(root.formation, 'formation', errors);
  if (formation) {
    requireNumber(formation, 'halfLengthM', errors, 'formation.');
    requireString(formation, 'sectionNamePrefix', errors, 'formation.');
    if (!isNumberArray(formation.carCenters) || formation.carCenters.length < 2) {
      errors.push('formation.carCenters must be an array of at least 2 numbers');
    }
  }

  const layout = asRecord(root.layout, 'layout', errors);
  if (layout) {
    for (const key of ['doorZs', 'windowZs', 'seatRowZs', 'seatXs', 'poleZs', 'bogieZs'] as const) {
      if (!isNumberArray(layout[key])) errors.push(`layout.${key} must be an array of numbers`);
    }
  }

  const pantograph = asRecord(root.pantograph, 'pantograph', errors);
  if (pantograph) {
    for (const key of ['x', 'y', 'z'] as const) requireNumber(pantograph, key, errors, 'pantograph.');
  }

  requireNumber(root, 'headlightBeamHeightM', errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: raw as SBahnBlueprintConfig };
}

function asRecord(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  errors.push(`${path} must be an object`);
  return null;
}

function requireString(record: Record<string, unknown>, key: string, errors: string[], prefix = ''): void {
  if (typeof record[key] !== 'string' || record[key] === '') errors.push(`${prefix}${key} must be a non-empty string`);
}

function requireNumber(record: Record<string, unknown>, key: string, errors: string[], prefix = ''): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) errors.push(`${prefix}${key} must be a finite number`);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}
