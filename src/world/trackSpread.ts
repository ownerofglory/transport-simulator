/**
 * Lateral spread of the two running tracks along a route.
 *
 * Both tracks normally sit at a fixed offset either side of the alignment. An
 * island station breaks that: the platform stands *between* the tracks, so they
 * have to pull apart far enough to clear it and come back together again. The
 * profile is a function of route distance, shared by everything that positions
 * itself on a track — rails, ballast, sleepers, the player vehicle, oncoming
 * services, and the chase camera — so none of them can drift apart.
 *
 * A route with no island stops has no zones, and every lookup returns the base
 * offset unchanged.
 */

export type TrackSpreadZone = {
  centerM: number;
  // Full spread is held over this much either side of the centre.
  halfLengthM: number;
  // Transition either side of that, standing in for the turnout and reverse
  // curve that opens the tracks out on the real alignment.
  taperM: number;
  // Extra lateral offset per track at full spread.
  spreadM: number;
};

export class TrackSpreadProfile {
  static readonly none = new TrackSpreadProfile([]);

  constructor(private readonly zones: readonly TrackSpreadZone[] = []) {}

  /** True when no stop on the route spreads its tracks (the common case). */
  get isFlat(): boolean {
    return this.zones.length === 0;
  }

  /** Extra outward offset applied to each track at this point on the route. */
  spreadAtDistance(distanceM: number): number {
    let spread = 0;
    for (const zone of this.zones) {
      const fromCenter = Math.abs(distanceM - zone.centerM);
      const taperEnd = zone.halfLengthM + zone.taperM;
      if (fromCenter >= taperEnd) continue;
      const eased =
        fromCenter <= zone.halfLengthM
          ? 1
          : smoothstep(1 - (fromCenter - zone.halfLengthM) / zone.taperM);
      spread = Math.max(spread, zone.spreadM * eased);
    }
    return spread;
  }

  /**
   * The base offset moved outward by the local spread. Offsets of 0 (single
   * track guideways, centred strips) are left alone: there is no side to move.
   */
  laneOffsetAt(distanceM: number, baseOffsetM: number): number {
    if (this.isFlat || baseOffsetM === 0) return baseOffsetM;
    return baseOffsetM + Math.sign(baseOffsetM) * this.spreadAtDistance(distanceM);
  }
}

// Eased rather than linear so the track leaves and rejoins the alignment
// tangentially instead of kinking at both ends of the taper.
function smoothstep(k: number): number {
  return k * k * (3 - 2 * k);
}
