import { useEffect, useState } from 'react';
import { LiveStationSearch } from './LiveStationSearch';
import { ALL_LIVE_MODES, modeColor, modeLabel, type LiveMode } from './liveTypes';
import type { LiveSummary } from './useLiveVehicles';
import type { LatLon } from './liveProjection';
import type { RealtimeStation } from '../realtime/types';

// Freshness thresholds (§2.5): amber past ~30 s, red when the snapshot is degraded.
const STALE_SECONDS = 30;

function freshnessAgeSeconds(summary: LiveSummary, nowMs: number): number | null {
  if (summary.snapshotAgeSeconds === null || summary.lastUpdatedMs === null) return null;
  // Server-relative age at fetch time, plus the client time elapsed since — this
  // keeps counting up between polls without trusting the client's absolute clock.
  return summary.snapshotAgeSeconds + Math.max(0, Math.round((nowMs - summary.lastUpdatedMs) / 1000));
}

/**
 * Slim Live HUD (concept §2.5): station search, mode filter chips, data freshness,
 * vehicle count, a real-time clock, and the always-visible exit. Shared by the map
 * and 3D views so the controls stay in one place across the hand-off.
 */
export function LiveModePanel({
  summary,
  userModes,
  onToggleMode,
  onExit,
  onPickStation,
  getSearchOrigin
}: {
  summary: LiveSummary;
  userModes: Set<LiveMode>;
  onToggleMode: (mode: LiveMode) => void;
  onExit: () => void;
  /** Picking a station flies the 3D camera to it. */
  onPickStation: (station: RealtimeStation) => void;
  /** Current view centre, used to rank station hits by distance. */
  getSearchOrigin?: () => LatLon | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  // Start folded on phones, where the panel would otherwise cover the map.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = freshnessAgeSeconds(summary, now);
  const requested = new Set(summary.modesRequested);
  const freshnessClass = summary.degraded ? 'degraded' : age !== null && age > STALE_SECONDS ? 'stale' : 'fresh';
  const freshnessText = summary.error
    ? 'reconnecting…'
    : summary.degraded
      ? `degraded · ${age ?? '?'}s`
      : age === null
        ? 'connecting…'
        : `live · updated ${age}s ago`;

  const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`lv-hud ${collapsed ? 'collapsed' : ''}`}>
      <div className="lv-hud-top">
        <span className="lv-hud-title">Live · VVS</span>
        <div className="lv-hud-actions">
          <button className="lv-exit" onClick={onExit}>
            Exit Live
          </button>
          <button
            className="lv-fold"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand live controls' : 'Collapse live controls'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '+' : '−'}
          </button>
        </div>
      </div>

      <div className="lv-hud-content">
      <LiveStationSearch onPick={onPickStation} getNear={getSearchOrigin} />

      <div className="lv-chips">
        {ALL_LIVE_MODES.map((mode) => {
          const on = userModes.has(mode);
          // Enabled by the user but not currently requested because the zoom tier
          // suppresses it — hint that zooming in will bring it back.
          const tierHidden = on && !requested.has(mode);
          return (
            <button
              key={mode}
              className={`lv-chip ${on ? 'on' : 'off'} ${tierHidden ? 'tier-hidden' : ''}`}
              style={{ '--c': modeColor(mode) } as React.CSSProperties}
              title={tierHidden ? 'Zoom in to see this mode' : undefined}
              onClick={() => onToggleMode(mode)}
            >
              {modeLabel(mode)}
              {tierHidden && <span className="lv-chip-zoom">⤢</span>}
            </button>
          );
        })}
      </div>

        <div className="lv-hud-foot">
          <span className={`lv-fresh ${freshnessClass}`}>{freshnessText}</span>
          <span className="lv-count">{summary.count} in view</span>
          <span className="lv-clock">{clock}</span>
        </div>
      </div>
    </div>
  );
}
