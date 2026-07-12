import { createContext, useMemo, useReducer, type Dispatch, type PropsWithChildren } from 'react';
import type { AppAction } from './app-actions';
import { appReducer } from './app-reducer';
import { createInitialAppState, type AppState } from './AppState';

export const AppStateContext = createContext<AppState | null>(null);
export const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

/** Provides the app selection/input state and dispatcher to the React tree. */
export function AppProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(appReducer, undefined, () => createInitialAppState());
  const dispatchValue = useMemo(() => dispatch, []);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatchValue}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
