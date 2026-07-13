import * as THREE from 'three';

// Material config shared by the kind-specific blueprint renderers (bus,
// s-bahn, ...). Unlike buildBlueprintMaterials in ./materials.ts, this factory
// applies no defaults of its own: only properties present in the config are
// set, so ported procedural builders keep byte-identical material state.
export type BlueprintStandardMaterialConfig = {
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  doubleSided?: boolean;
};

export function makeStandardMaterial(config: BlueprintStandardMaterialConfig): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = { color: config.color };
  if (config.roughness !== undefined) params.roughness = config.roughness;
  if (config.metalness !== undefined) params.metalness = config.metalness;
  if (config.opacity !== undefined) params.opacity = config.opacity;
  if (config.transparent !== undefined) params.transparent = config.transparent;
  if (config.emissive !== undefined) params.emissive = config.emissive;
  if (config.emissiveIntensity !== undefined) params.emissiveIntensity = config.emissiveIntensity;
  if (config.doubleSided) params.side = THREE.DoubleSide;
  return new THREE.MeshStandardMaterial(params);
}

const CSS_COLOR = /^#[0-9a-fA-F]{3,8}$/;

// Shared validation for material entries in untrusted blueprint configs.
export function collectMaterialConfigErrors(raw: unknown, path: string, errors: string[]): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const material = raw as Record<string, unknown>;
  if (typeof material.color !== 'string' || !CSS_COLOR.test(material.color)) {
    errors.push(`${path}.color must be a hex color string`);
  }
  if (material.emissive !== undefined && (typeof material.emissive !== 'string' || !CSS_COLOR.test(material.emissive))) {
    errors.push(`${path}.emissive must be a hex color string`);
  }
  for (const key of ['roughness', 'metalness', 'opacity', 'emissiveIntensity'] as const) {
    if (material[key] !== undefined && typeof material[key] !== 'number') {
      errors.push(`${path}.${key} must be a number`);
    }
  }
  for (const key of ['transparent', 'doubleSided'] as const) {
    if (material[key] !== undefined && typeof material[key] !== 'boolean') {
      errors.push(`${path}.${key} must be a boolean`);
    }
  }
}
