import { delayLevel, modeColor, modeLabel, type LiveVehicle } from './liveTypes';

function delayText(delaySeconds: number | undefined, observed: boolean): string {
  if (!observed || delaySeconds == null) return 'delay unknown';
  if (Math.abs(delaySeconds) < 60) return 'on time';
  const min = Math.round(delaySeconds / 60);
  return min > 0 ? `+${min} min` : `${min} min`;
}

function statusText(status: LiveVehicle['status']): string {
  switch (status) {
    case 'at_stop':
      return 'at stop';
    case 'in_transit':
      return 'in transit';
    case 'not_started':
      return 'not started';
    case 'completed':
      return 'completed';
    default:
      return '—';
  }
}

function confidenceText(v: LiveVehicle): string {
  const conf = v.confidence ?? 'low';
  const source =
    v.source === 'measured' ? 'measured' : v.source === 'realtime_inferred' ? 'realtime' : 'planned';
  return `${source} · ${conf}`;
}

/**
 * Compact selection info card (concept §2.4). Fields map 1:1 to LiveVehicle;
 * Follow and Departures compose with existing tools.
 */
export function LiveVehicleCard({
  vehicle,
  following,
  delayObserved = false,
  onToggleFollow,
  onDepartures,
  onClose
}: {
  vehicle: LiveVehicle;
  following: boolean;
  /** False while the backend cannot observe delay — see `delayObservedFor`. */
  delayObserved?: boolean;
  onToggleFollow: () => void;
  onDepartures: () => void;
  onClose: () => void;
}) {
  const color = modeColor(vehicle.mode);
  const delay = delayLevel(vehicle.delaySeconds, delayObserved);
  const planned = vehicle.source === 'schedule';

  return (
    <div className={`lv-card ${planned ? 'planned' : ''}`}>
      <button className="lv-card-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="lv-card-head">
        <span className="lv-card-line" style={{ background: color }}>
          {vehicle.line ?? modeLabel(vehicle.mode)}
        </span>
        <span className="lv-card-dest">→ {vehicle.direction || 'Unknown'}</span>
      </div>
      <div className="lv-card-row">
        <span className={`lv-delay-tag lv-delay-${delay}`}>{delayText(vehicle.delaySeconds, delayObserved)}</span>
        <span className="lv-card-status">{statusText(vehicle.status)}</span>
        <span className="lv-card-conf" title="confidence · source">
          {planned ? '◔' : '●'} {confidenceText(vehicle)}
        </span>
      </div>
      <div className="lv-card-stops">
        <span>
          <em>Prev</em> {vehicle.previousStop || '—'}
        </span>
        <span>
          <em>Next</em> {vehicle.nextStop || '—'}
        </span>
      </div>
      <div className="lv-card-actions">
        <button className={following ? 'active' : ''} onClick={onToggleFollow}>
          {following ? 'Following' : 'Follow'}
        </button>
        <button onClick={onDepartures} disabled={!vehicle.nextStop}>
          Departures at next stop
        </button>
      </div>
    </div>
  );
}
