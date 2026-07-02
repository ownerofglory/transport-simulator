import type {
  VehicleBlueprintConfig,
  VehicleBlueprintKind,
  VehicleDestinationDisplayConfig,
  VehicleDoorConfig,
  VehicleWindowConfig
} from './VehicleBlueprintConfig';

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VALID_KINDS: VehicleBlueprintKind[] = ['stadtbahn', 'bus', 's-bahn', 'zacke', 'seilbahn', 'ferry', 'tram'];

// Extreme-value caps prevent malformed uploaded configs from producing broken/degenerate geometry.
const MAX_LENGTH_M = 120;
const MAX_WIDTH_M = 6;
const MAX_HEIGHT_M = 8;

export type VehicleBlueprintValidationResult =
  | { valid: true; config: VehicleBlueprintConfig; warnings: string[] }
  | { valid: false; errors: string[] };

export function validateVehicleBlueprint(raw: unknown): VehicleBlueprintValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['Vehicle blueprint must be a JSON object.'] };
  }
  const value = raw as Record<string, unknown>;

  if (typeof value.id !== 'string' || !value.id.trim()) errors.push('"id" is required and must be a non-empty string.');
  if (typeof value.displayName !== 'string' || !value.displayName.trim()) errors.push('"displayName" is required and must be a non-empty string.');
  if (typeof value.kind !== 'string' || !VALID_KINDS.includes(value.kind as VehicleBlueprintKind)) {
    errors.push(`"kind" is required and must be one of: ${VALID_KINDS.join(', ')}.`);
  }

  const dimensions = value.dimensions as Record<string, unknown> | undefined;
  if (typeof dimensions !== 'object' || dimensions === null) {
    errors.push('"dimensions" is required and must be an object.');
  } else {
    for (const key of ['lengthM', 'widthM', 'heightM'] as const) {
      const dimensionValue = dimensions[key];
      if (typeof dimensionValue !== 'number' || !Number.isFinite(dimensionValue) || dimensionValue <= 0) {
        errors.push(`"dimensions.${key}" must be a positive number.`);
      }
    }
  }

  const materials = value.materials as Record<string, unknown> | undefined;
  if (typeof materials !== 'object' || materials === null) {
    errors.push('"materials" is required and must be an object of named material configs.');
  } else {
    for (const [name, materialConfig] of Object.entries(materials)) {
      if (typeof materialConfig !== 'object' || materialConfig === null) {
        errors.push(`Material "${name}" must be an object.`);
        continue;
      }
      const color = (materialConfig as Record<string, unknown>).color;
      if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
        errors.push(`Material "${name}".color must be a valid hex color string (e.g. "#f2f2f2").`);
      }
    }
  }
  const materialNames = new Set(typeof materials === 'object' && materials ? Object.keys(materials) : []);

  const sections = value.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    errors.push('"sections" is required and must be a non-empty array.');
  } else {
    sections.forEach((section, index) => {
      if (typeof section !== 'object' || section === null) {
        errors.push(`sections[${index}] must be an object.`);
        return;
      }
      const sectionValue = section as Record<string, unknown>;
      if (typeof sectionValue.center !== 'number' || !Number.isFinite(sectionValue.center)) {
        errors.push(`sections[${index}].center must be a finite number.`);
      }
      if (typeof sectionValue.length !== 'number' || !Number.isFinite(sectionValue.length) || sectionValue.length <= 0) {
        errors.push(`sections[${index}].length must be a positive number.`);
      }
      for (const materialKey of ['bodyMaterial', 'accentMaterial', 'glassMaterial', 'darkMaterial', 'roofMaterial'] as const) {
        const reference = sectionValue[materialKey];
        if (typeof reference === 'string' && !materialNames.has(reference)) {
          errors.push(`sections[${index}].${materialKey} references unknown material "${reference}".`);
        }
      }
    });
  }
  const sectionCount = Array.isArray(sections) ? sections.length : 0;

  validateSectionReferencingArray(value.doors as VehicleDoorConfig[] | undefined, 'doors', sectionCount, materialNames, errors);
  validateSectionReferencingArray(value.windows as VehicleWindowConfig[] | undefined, 'windows', sectionCount, materialNames, errors);
  validateSectionReferencingArray(value.destinationDisplays as VehicleDestinationDisplayConfig[] | undefined, 'destinationDisplays', sectionCount, materialNames, errors);

  if (errors.length > 0) return { valid: false, errors };

  const config = clampExtremeValues(raw as unknown as VehicleBlueprintConfig, warnings);
  return { valid: true, config, warnings };
}

function validateSectionReferencingArray(
  entries: Array<{ section?: number; material?: string; glassMaterial?: string; darkMaterial?: string }> | undefined,
  label: string,
  sectionCount: number,
  materialNames: Set<string>,
  errors: string[]
): void {
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    errors.push(`"${label}" must be an array when present.`);
    return;
  }
  entries.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${label}[${index}] must be an object.`);
      return;
    }
    if (typeof entry.section !== 'number' || entry.section < 0 || entry.section >= sectionCount) {
      errors.push(`${label}[${index}].section (${entry.section}) does not reference an existing section index.`);
    }
    for (const materialKey of ['material', 'glassMaterial', 'darkMaterial'] as const) {
      const reference = entry[materialKey];
      if (typeof reference === 'string' && !materialNames.has(reference)) {
        errors.push(`${label}[${index}].${materialKey} references unknown material "${reference}".`);
      }
    }
  });
}

// Caps runaway numeric values from untrusted configs while leaving well-formed configs untouched.
function clampExtremeValues(config: VehicleBlueprintConfig, warnings: string[]): VehicleBlueprintConfig {
  const clamped: VehicleBlueprintConfig = JSON.parse(JSON.stringify(config));
  const clamp = (label: string, value: number, max: number): number => {
    if (value > max) {
      warnings.push(`${label} (${value}) exceeded the maximum of ${max} and was clamped.`);
      return max;
    }
    return value;
  };
  clamped.dimensions.lengthM = clamp('dimensions.lengthM', clamped.dimensions.lengthM, MAX_LENGTH_M);
  clamped.dimensions.widthM = clamp('dimensions.widthM', clamped.dimensions.widthM, MAX_WIDTH_M);
  clamped.dimensions.heightM = clamp('dimensions.heightM', clamped.dimensions.heightM, MAX_HEIGHT_M);
  clamped.sections = clamped.sections.map((section, index) => ({
    ...section,
    length: clamp(`sections[${index}].length`, section.length, MAX_LENGTH_M)
  }));
  return clamped;
}
