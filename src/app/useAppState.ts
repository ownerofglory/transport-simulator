import { useContext } from 'react';
import { AppDispatchContext, AppStateContext } from './AppProvider';

/** Accesses the app state + dispatcher; throws if used outside AppProvider. */
export function useAppState() {
  const state = useContext(AppStateContext);
  const dispatch = useContext(AppDispatchContext);
  if (!state || !dispatch) throw new Error('useAppState must be used inside AppProvider');
  return { state, dispatch };
}
