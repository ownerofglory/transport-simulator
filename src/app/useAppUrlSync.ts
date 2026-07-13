import { useEffect, useRef } from 'react';
import { writeUrlState } from './AppUrlState';
import type { AppState } from './AppState';

/** Mirrors persistable selection state into the URL once bootstrap is ready. */
export function useAppUrlSync(state: AppState, ready: boolean): void {
  const canWrite = useRef(false);
  useEffect(() => {
    if (ready) canWrite.current = true;
  }, [ready]);
  useEffect(() => {
    if (!canWrite.current || !state.selectedRouteId) return;
    writeUrlState(state);
  }, [
    state.selectedCityId,
    state.selectedTransportMode,
    state.selectedRouteId,
    state.selectedStartStation,
    state.selectedMode,
    state.selectedSeason,
    state.selectedTime,
    state.selectedCameraMode,
    state.realtimeJourney
  ]);
}
