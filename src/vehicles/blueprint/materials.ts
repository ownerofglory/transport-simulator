import * as THREE from 'three';
import type { VehicleMaterialConfig } from './VehicleBlueprintConfig';

export function buildBlueprintMaterials(
  materialConfigs: Record<string, VehicleMaterialConfig>
): Record<string, THREE.MeshStandardMaterial> {
  const materials: Record<string, THREE.MeshStandardMaterial> = {};
  for (const [name, materialConfig] of Object.entries(materialConfigs)) {
    const isGlass = name === 'glass' || materialConfig.transmission !== undefined;
    materials[name] = new THREE.MeshPhysicalMaterial({
      color: materialConfig.color,
      roughness: materialConfig.roughness ?? 0.5,
      metalness: materialConfig.metalness ?? 0.1,
      opacity: materialConfig.opacity ?? 1,
      transparent: materialConfig.transparent ?? false,
      emissive: materialConfig.emissive,
      emissiveIntensity: materialConfig.emissiveIntensity ?? 1,
      side: materialConfig.transparent ? THREE.DoubleSide : THREE.FrontSide,
      clearcoat: materialConfig.clearcoat ?? (isGlass ? 0.35 : name === 'body' || name === 'shell' || name === 'accent' ? 0.22 : 0),
      clearcoatRoughness: materialConfig.clearcoatRoughness ?? 0.18,
      envMapIntensity: materialConfig.envMapIntensity ?? (isGlass ? 1.15 : 0.7),
      transmission: materialConfig.transmission ?? 0,
      thickness: materialConfig.thickness ?? 0,
      ior: materialConfig.ior ?? 1.5
    });
  }
  return materials;
}

// Resolves a named material reference, falling back to a neutral grey so a bad
// or missing reference never crashes the builder.
export function resolveMaterial(
  materials: Record<string, THREE.MeshStandardMaterial>,
  name: string | undefined,
  fallback: string
): THREE.MeshStandardMaterial {
  if (name && materials[name]) return materials[name];
  if (materials[fallback]) return materials[fallback];
  return new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 });
}
