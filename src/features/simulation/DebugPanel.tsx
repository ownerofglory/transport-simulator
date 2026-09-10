import { useAppState } from '../../app/useAppState';
import type { DebugWeather } from '../../app/types';

// Text-presentation variation selectors (U+FE0E) keep these monochrome instead
// of letting the platform swap in colour emoji, matching the other switches.
const WEATHER_OPTIONS: { weather: DebugWeather; icon: string; label: string }[] = [
  { weather: 'auto', icon: '⟳', label: 'Live weather' },
  { weather: 'clear', icon: '☀︎', label: 'Clear' },
  { weather: 'cloudy', icon: '☁︎', label: 'Cloudy' },
  { weather: 'fog', icon: '≡', label: 'Fog' },
  { weather: 'rain', icon: '☂︎', label: 'Rain' },
  { weather: 'snow', icon: '❄︎', label: 'Snow' },
  { weather: 'thunder', icon: '⚡︎', label: 'Thunderstorm' }
];

/**
 * Debug-mode tools. Only rendered once the hidden HUD-title gesture unlocks
 * debug mode; everything else about the mode is the ordinary simulator.
 */
export function DebugPanel() {
  const { state, dispatch } = useAppState();
  if (!state.debugMode) return null;

  return (
    <div className="debug-panel">
      <div className="label">Debug · weather</div>
      <div className="compact-switch" aria-label="Debug weather">
        {WEATHER_OPTIONS.map((option) => (
          <button
            key={option.weather}
            className={state.debugWeather === option.weather ? 'active' : ''}
            aria-label={option.label}
            aria-pressed={state.debugWeather === option.weather}
            title={option.weather === 'auto' ? 'Follow the live forecast' : `Force ${option.label.toLowerCase()}`}
            onClick={() => dispatch({ type: 'debug-weather-selected', weather: option.weather })}
          >
            {option.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
