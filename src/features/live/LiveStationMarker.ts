import * as THREE from 'three';
import { makeLabelTexture } from '../../labels';

// Ground anchor for a searched station: a ring on the terrain, a thin mast and a
// name plate, so the camera's destination is identifiable once the flight ends.
const RING_INNER_M = 12;
const RING_OUTER_M = 15;
const MAST_HEIGHT_M = 30;
const LABEL_HEIGHT_M = 15;
const MARKER_COLOR = 0xffd34d;
// makeLabelTexture draws one centred line at a fixed font size, so the canvas has
// to grow with the name or long stops ("Groß Charlottengroden Wendeplatz") are
// clipped at both ends. The plate keeps the canvas aspect so text never stretches.
const LABEL_TEXTURE_HEIGHT_PX = 140;
const LABEL_PX_PER_CHAR = 34;
const LABEL_MIN_WIDTH_PX = 320;
const LABEL_MAX_WIDTH_PX = 1600;

function labelWidthPx(name: string): number {
  const wanted = name.length * LABEL_PX_PER_CHAR + 80;
  return Math.min(LABEL_MAX_WIDTH_PX, Math.max(LABEL_MIN_WIDTH_PX, Math.round(wanted)));
}

/**
 * The single "you searched for this" marker in the live 3D scene. One instance
 * is owned by {@link Live3DScene}; {@link show} retargets it instead of building
 * a second marker, and the geometries/materials/texture are disposed once.
 */
export class LiveStationMarker {
  readonly group = new THREE.Group();

  private readonly ring: THREE.Mesh;
  private readonly mast: THREE.Mesh;
  private readonly label: THREE.Sprite;
  private labelTexture: THREE.CanvasTexture | null = null;
  private x = 0;
  private z = 0;

  constructor() {
    this.group.visible = false;

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(RING_INNER_M, RING_OUTER_M, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    this.ring.renderOrder = 2;
    this.group.add(this.ring);

    this.mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, MAST_HEIGHT_M, 8),
      new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: 0.8 })
    );
    this.mast.position.y = MAST_HEIGHT_M / 2;
    this.group.add(this.mast);

    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
    this.label.position.y = MAST_HEIGHT_M + LABEL_HEIGHT_M / 2;
    this.label.renderOrder = 3;
    this.group.add(this.label);
  }

  /** Places (or re-places) the marker at a world position with a station name. */
  show(name: string, x: number, z: number): void {
    this.x = x;
    this.z = z;
    const widthPx = labelWidthPx(name);
    const texture = makeLabelTexture(name, {
      width: widthPx,
      height: LABEL_TEXTURE_HEIGHT_PX,
      bg: '#101720',
      fg: '#ffd34d'
    });
    this.label.scale.set((widthPx / LABEL_TEXTURE_HEIGHT_PX) * LABEL_HEIGHT_M, LABEL_HEIGHT_M, 1);
    const material = this.label.material as THREE.SpriteMaterial;
    material.map = texture;
    material.needsUpdate = true;
    this.labelTexture?.dispose(); // one texture per marker; the previous name is gone
    this.labelTexture = texture;
    this.group.visible = true;
  }

  /** Re-seats the marker on the terrain, which streams in and changes height. */
  update(heightAt: (x: number, z: number) => number): void {
    if (!this.group.visible) return;
    this.group.position.set(this.x, heightAt(this.x, this.z) + 0.3, this.z);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.mast.geometry.dispose();
    (this.mast.material as THREE.Material).dispose();
    (this.label.material as THREE.Material).dispose();
    this.labelTexture?.dispose();
    this.labelTexture = null;
  }
}
