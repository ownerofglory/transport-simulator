import { useEffect, useState } from 'react';
import { fetchLiveStatus } from './liveApi';

// Session-cached /live/status probe (concept §2.1): resolved once and shared, but
// re-attempted after a failure so a transient outage doesn't disable Live for good.
type Gate = 'loading' | 'enabled' | 'disabled' | 'error';
let cached: Promise<Gate> | null = null;

function probe(): Promise<Gate> {
  if (!cached) {
    cached = fetchLiveStatus()
      .then((s) => (s.enabled ? 'enabled' : 'disabled') as Gate)
      .catch(() => {
        cached = null; // allow a later retry
        return 'error' as Gate;
      });
  }
  return cached;
}

/**
 * The Live entry point. Rendered only for live-eligible cities (§1 gate); the
 * button itself is enabled only when the backend reports live traffic available.
 */
export function LiveEntryButton({ eligible, onEnter }: { eligible: boolean; onEnter: () => void }) {
  const [gate, setGate] = useState<Gate>('loading');

  useEffect(() => {
    if (!eligible) return;
    let active = true;
    void probe().then((g) => active && setGate(g));
    return () => {
      active = false;
    };
  }, [eligible]);

  if (!eligible) return null;

  const ready = gate === 'enabled';
  const title = ready
    ? 'Watch real VVS vehicles live'
    : gate === 'loading'
      ? 'Checking live traffic…'
      : 'Live traffic unavailable';

  return (
    <button className="lv-entry" title={title} disabled={!ready} onClick={onEnter}>
      Live
    </button>
  );
}
