import type { WeatherKind } from '../world/weather';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Mode = 'ride' | 'driver';
// Top-level HUD tab: the built-in simulator selectors vs. the live TRIAS realtime tools.
export type HudTab = 'simulator' | 'realtime';
// Ambient traffic population: how many cars, pedestrians and riders share the
// world. Higher settings reuse the routes already fetched — see
// `trafficDensityScale` — so they never cost extra routing requests.
export type TrafficDensity = 'few' | 'medium' | 'many';
// Debug-mode weather selection: a forced condition, or the live provider.
export type DebugWeather = WeatherKind | 'auto';
