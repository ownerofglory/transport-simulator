import { collectMaterialConfigErrors, type BlueprintStandardMaterialConfig } from '../standardMaterial';

// Declarative configuration for the Citaro-family bus renderer. The config owns
// everything that distinguishes one bus from another: livery materials, body
// formation (section lengths, door and axle positions), articulation rules and
// display colors. Fine Citaro styling (window pitch, seat spacing, mirror and
// wiper geometry, ...) lives in buildBusFromBlueprint.ts.

export type BusMaterialConfig = BlueprintStandardMaterialConfig;

export const BUS_MATERIAL_ROLES = [
  'body',
  'black',
  'skirt',
  'roof',
  'glass',
  'interior',
  'metal',
  'tyre',
  'hub',
  'seat',
  'seatBack',
  'floor',
  'grab',
  'lightStrip',
  'driver',
  'rubber',
  'headlight',
  'indicator',
  'tailLamp',
  'stopButton'
] as const;

export type BusMaterialRole = (typeof BUS_MATERIAL_ROLES)[number];

export type BusSectionConfig = {
  centerOffsetM: number;
  lengthM: number;
  cab: 'front' | 'joint';
  rear: 'tail' | 'joint';
  doorZs: number[];
  axleZs: number[];
  name: string;
};

export type BusBlueprintConfig = {
  id: string;
  kind: 'bus';
  displayName: string;
  materials: Record<BusMaterialRole, BusMaterialConfig>;
  destinationDisplay: {
    background: string;
    foreground: string;
  };
  rigid: {
    section: BusSectionConfig;
    halfLengthM: number;
  };
  articulated?: {
    // Route lines (exact, upper-cased) and line prefixes that run articulated
    // units, restricted to the listed city ids.
    lines: string[];
    linePrefixes: string[];
    cityIds: string[];
    applyWhenCityUnknown: boolean;
    sections: BusSectionConfig[];
    halfLengthM: number;
  };
  // Height of the night-time headlight beam origin above the road.
  headlightBeamHeightM: number;
};

export type BusBlueprintParseResult =
  | { ok: true; config: BusBlueprintConfig }
  | { ok: false; errors: string[] };

// Narrows an untrusted value (e.g. a user-edited JSON file) into a
// BusBlueprintConfig. Never throws; malformed input is reported as errors.
export function parseBusBlueprint(raw: unknown): BusBlueprintParseResult {
  const errors: string[] = [];
  const root = asRecord(raw, 'config', errors);
  if (!root) return { ok: false, errors };

  requireString(root, 'id', errors);
  requireString(root, 'displayName', errors);
  if (root.kind !== 'bus') errors.push('kind must be "bus"');

  const materials = asRecord(root.materials, 'materials', errors);
  if (materials) {
    for (const role of BUS_MATERIAL_ROLES) {
      collectMaterialConfigErrors(materials[role], `materials.${role}`, errors);
    }
  }

  const display = asRecord(root.destinationDisplay, 'destinationDisplay', errors);
  if (display) {
    requireString(display, 'background', errors, 'destinationDisplay.');
    requireString(display, 'foreground', errors, 'destinationDisplay.');
  }

  const rigid = asRecord(root.rigid, 'rigid', errors);
  if (rigid) {
    requireNumber(rigid, 'halfLengthM', errors, 'rigid.');
    validateSection(rigid.section, 'rigid.section', errors);
  }

  if (root.articulated !== undefined) {
    const articulated = asRecord(root.articulated, 'articulated', errors);
    if (articulated) {
      requireNumber(articulated, 'halfLengthM', errors, 'articulated.');
      if (typeof articulated.applyWhenCityUnknown !== 'boolean') errors.push('articulated.applyWhenCityUnknown must be a boolean');
      for (const key of ['lines', 'linePrefixes', 'cityIds'] as const) {
        if (!isStringArray(articulated[key])) errors.push(`articulated.${key} must be an array of strings`);
      }
      if (!Array.isArray(articulated.sections) || articulated.sections.length === 0) {
        errors.push('articulated.sections must be a non-empty array');
      } else {
        articulated.sections.forEach((section, index) => validateSection(section, `articulated.sections[${index}]`, errors));
      }
    }
  }

  requireNumber(root, 'headlightBeamHeightM', errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: raw as BusBlueprintConfig };
}

function validateSection(raw: unknown, path: string, errors: string[]): void {
  const section = asRecord(raw, path, errors);
  if (!section) return;
  requireNumber(section, 'centerOffsetM', errors, `${path}.`);
  requireNumber(section, 'lengthM', errors, `${path}.`);
  requireString(section, 'name', errors, `${path}.`);
  if (section.cab !== 'front' && section.cab !== 'joint') errors.push(`${path}.cab must be "front" or "joint"`);
  if (section.rear !== 'tail' && section.rear !== 'joint') errors.push(`${path}.rear must be "tail" or "joint"`);
  for (const key of ['doorZs', 'axleZs'] as const) {
    if (!Array.isArray(section[key]) || (section[key] as unknown[]).some((value) => typeof value !== 'number')) {
      errors.push(`${path}.${key} must be an array of numbers`);
    }
  }
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
