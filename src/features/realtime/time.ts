// Parsing/formatting helpers for the string timestamps the backend returns.
// Values may be ISO 8601 or a bare "HH:MM"; both are handled.

/** Parses a backend timestamp to epoch milliseconds, or null if unparseable. */
export function parseTimeMs(value: string | undefined): number | null {
  if (!value) return null;
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return iso;
  const hm = /^(\d{1,2}):(\d{2})/.exec(value);
  if (hm) {
    const d = new Date();
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    return d.getTime();
  }
  return null;
}

/** Formats a backend timestamp as a local "HH:MM" clock, falling back to the raw value. */
export function formatClock(value: string | undefined): string {
  const ms = parseTimeMs(value);
  if (ms === null) return value ?? '--:--';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Whole seconds between two backend timestamps (b - a), or 0 when either is missing. */
export function secondsBetween(a: string | undefined, b: string | undefined): number {
  const ta = parseTimeMs(a);
  const tb = parseTimeMs(b);
  if (ta === null || tb === null) return 0;
  return Math.round((tb - ta) / 1000);
}
