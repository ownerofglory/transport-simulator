import { useContext, useState } from 'react';
import { useAppState } from '../../app/useAppState';
import { SimulatorCommandsContext } from '../simulation/useSimulatorRuntime';
import { JourneySearchModal } from './JourneySearchModal';
import { StopSearchModal } from './StopSearchModal';
import { DeparturesModal } from './DeparturesModal';
import type { EndpointValue } from './LocationField';

type RealtimeModal = 'journey' | 'stop' | 'departures' | null;

/**
 * Realtime tab body: live TRIAS tools (journey search, stop search, departures)
 * plus the shared camera / photo / time-of-day controls. The heavy search UIs
 * open in modals so the 3D viewport stays visible behind them.
 */
export function RealtimePanel() {
  const { state, dispatch } = useAppState();
  const commands = useContext(SimulatorCommandsContext);
  const [modal, setModal] = useState<RealtimeModal>(null);
  // A station handed from stop search into the departures board.
  const [departuresStation, setDeparturesStation] = useState<EndpointValue | null>(null);

  const openDepartures = (station: EndpointValue | null) => {
    setDeparturesStation(station);
    setModal('departures');
  };

  return (
    <>
      <div className="toolbar realtime-tools">
        <button onClick={() => setModal('journey')}>Journey search</button>
        <button onClick={() => setModal('stop')}>Stop search</button>
        <button onClick={() => openDepartures(null)}>Departures</button>
      </div>

      <div className="toolbar">
        <select
          aria-label="Time of day"
          value={state.selectedTime}
          onChange={(e) => dispatch({ type: 'time-selected', time: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}
        >
          <option value="auto">Local time (auto)</option>
          <option value="6">06:00 · Dawn</option>
          <option value="9">09:00 · Morning</option>
          <option value="13">13:00 · Day</option>
          <option value="18">18:00 · Evening</option>
        </select>
      </div>

      <div className="controls">
        <button
          onClick={() => {
            const mode = commands?.cycleCamera();
            if (mode) dispatch({ type: 'camera-selected', cameraMode: mode });
          }}
        >
          Camera
        </button>
        <button onClick={() => dispatch({ type: 'photo-mode-changed', active: true })}>Photo</button>
      </div>

      {modal === 'journey' && <JourneySearchModal onClose={() => setModal(null)} />}
      {modal === 'stop' && <StopSearchModal onClose={() => setModal(null)} onOpenDepartures={openDepartures} />}
      {modal === 'departures' && <DeparturesModal onClose={() => setModal(null)} initialStation={departuresStation} />}
    </>
  );
}
