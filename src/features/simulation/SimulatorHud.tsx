import type { SimulatorUiSnapshot } from './SimulatorSnapshotStore';

/** Live line/speed/next-station/doors/driver stat cards. */
export function SimulatorHud({ snapshot }: { snapshot: SimulatorUiSnapshot }) {
  return (
    <div className="meta">
      <div className="card">
        <div className="label">Line</div>
        <div className="value">{snapshot.line ? `${snapshot.line} → ${snapshot.destination}` : '-'}</div>
      </div>
      <div className="card">
        <div className="label">Speed</div>
        <div className="value">{snapshot.line ? `${snapshot.speedKph} km/h` : '-'}</div>
      </div>
      <div className="card next-station-card">
        <div className="next-station-main">
          <div className="label">Next station</div>
          <div className="value">{snapshot.tripComplete ? 'Trip complete' : snapshot.nextStation || '-'}</div>
        </div>
        <div className="doors-status">
          <div className="label">Doors</div>
          <div className="value">{snapshot.doorsOpen ? `Open ${snapshot.dwellRemainingS.toFixed(0)}s` : 'Closed'}</div>
        </div>
      </div>
      <div className="card driver-stat">
        <div className="label">Score</div>
        <div className="value">{snapshot.mode === 'driver' ? snapshot.driverScore : '-'}</div>
      </div>
      <div className="card driver-stat">
        <div className="label">Schedule</div>
        <div className="value">
          {snapshot.mode === 'driver' ? `${snapshot.timetableDeltaS >= 0 ? '+' : ''}${snapshot.timetableDeltaS.toFixed(0)}s` : '-'}
        </div>
      </div>
    </div>
  );
}
