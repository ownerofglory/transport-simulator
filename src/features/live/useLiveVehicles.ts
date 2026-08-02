import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchVehicle, fetchVehicles, openVehicleStream } from './liveApi';
import { LiveVehicleStore } from './LiveVehicleStore';
import type { LiveMode } from './liveTypes';
import {
  bboxContains,
  modesForTier,
  pollIntervalMs,
  requestBBox,
  tierForZoom,
  type BBox,
  type Tier
} from './viewport';

export type LiveSummary = {
  count: number;
  tier: Tier;
  modesRequested: LiveMode[];
  snapshotAgeSeconds: number | null;
  generatedAt: string | null;
  degraded: boolean;
  positionModel: string | null;
  /** wall-clock ms of the last successful fetch, for the freshness clock. */
  lastUpdatedMs: number | null;
  error: string | null;
};

const INITIAL_SUMMARY: LiveSummary = {
  count: 0,
  tier: 'city',
  modesRequested: [],
  snapshotAgeSeconds: null,
  generatedAt: null,
  degraded: false,
  positionModel: null,
  lastUpdatedMs: null,
  error: null
};

const FOLLOW_INTERVAL_MS = 5_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 60_000;

// Newly spawned runs carry no speed and stay unrendered until a second fix (see
// LiveVehicleStore.seeded). After a wave of spawns — entering Live, or a pan that
// pulls in a fresh fleet — following up quickly fills the map in seconds instead of
// a whole city-tier interval. Guarded so it costs at most one extra request per
// wave: it needs a large unseeded share and never fires on consecutive polls.
const SEED_POLL_MS = 3_000;
const SEED_WAVE_RATIO = 0.25;

type Options = {
  enabled: boolean;
  userModes: Set<LiveMode>;
  followRunId: string | null;
  /** RFC3339 replay timestamp; a debugging lever, normally undefined. */
  at?: string;
  onFollowEnded?: () => void;
};

/**
 * Polling state machine for live vehicles (concept §5–§6). Owns a
 * {@link LiveVehicleStore}, drives viewport-bounded snapshot polling with tier
 * cadence + pan hysteresis, follows a single run via the per-run endpoint, and
 * throttles on tab visibility. Positions animate in the renderer, not here, so
 * this hook only re-renders on snapshot boundaries (every 8–30 s).
 */
export function useLiveVehicles({ enabled, userModes, followRunId, at, onFollowEnded }: Options) {
  const store = useMemo(() => new LiveVehicleStore(), []);
  const [summary, setSummary] = useState<LiveSummary>(INITIAL_SUMMARY);

  const visibleRef = useRef<{ bbox: BBox; zoom: number } | null>(null);
  const fetchedBBoxRef = useRef<BBox | null>(null);
  const tierRef = useRef<Tier>('city');
  const userModesRef = useRef(userModes);
  userModesRef.current = userModes;
  const atRef = useRef(at);
  atRef.current = at;

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const backoffRef = useRef(0);
  const lastWasSeedPollRef = useRef(false);
  const onFollowEndedRef = useRef(onFollowEnded);
  onFollowEndedRef.current = onFollowEnded;

  const clearPoll = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const scheduleNext = useCallback(
    (delayMs: number, run: () => void) => {
      clearPoll();
      pollTimer.current = setTimeout(run, delayMs);
    },
    [clearPoll]
  );

  const doFetch = useCallback(
    async function fetchLoop() {
      const visible = visibleRef.current;
      if (!enabled || !visible) return;
      const tier = tierForZoom(visible.zoom);
      const reqBBox = requestBBox(visible.bbox);
      const modes = modesForTier(tier, visible.bbox, userModesRef.current);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const snapshot = await fetchVehicles(reqBBox, modes, { at: atRef.current }, controller.signal);
        if (controller.signal.aborted) return;
        store.applySnapshot(snapshot.vehicles);
        fetchedBBoxRef.current = reqBBox;
        tierRef.current = tier;
        backoffRef.current = 0;
        setSummary({
          count: store.size,
          tier,
          modesRequested: modes,
          snapshotAgeSeconds: snapshot.snapshotAgeSeconds ?? null,
          generatedAt: snapshot.generatedAt ?? null,
          degraded: snapshot.degraded ?? false,
          positionModel: snapshot.positionModel ?? null,
          lastUpdatedMs: Date.now(),
          error: null
        });
        const unseeded = store.trackedSize - store.size;
        const seedWave =
          !lastWasSeedPollRef.current && unseeded > 0 && unseeded >= store.trackedSize * SEED_WAVE_RATIO;
        lastWasSeedPollRef.current = seedWave;
        scheduleNext(seedWave ? SEED_POLL_MS : pollIntervalMs(tier), fetchLoop);
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
        backoffRef.current += 1;
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (backoffRef.current - 1), BACKOFF_CAP_MS);
        setSummary((prev) => ({ ...prev, error: (err as Error)?.message ?? 'Live traffic request failed' }));
        scheduleNext(delay, fetchLoop);
      }
    },
    [enabled, store, scheduleNext]
  );

  // Called by the map on move/zoom end. Applies pan hysteresis: only refetch when
  // the tier changes or the visible footprint escapes the last fetched bbox.
  const onViewportChange = useCallback(
    (bbox: BBox, zoom: number) => {
      visibleRef.current = { bbox, zoom };
      if (!enabled) return;
      const tier = tierForZoom(zoom);
      const escaped = !fetchedBBoxRef.current || !bboxContains(fetchedBBoxRef.current, bbox);
      if (tier !== tierRef.current || escaped) {
        tierRef.current = tier;
        void doFetch();
      }
    },
    [enabled, doFetch]
  );

  // Enable/disable lifecycle: reset everything on teardown.
  useEffect(() => {
    if (!enabled) {
      clearPoll();
      abortRef.current?.abort();
      store.clear();
      lastWasSeedPollRef.current = false;
      setSummary(INITIAL_SUMMARY);
      return;
    }
    // Kick off immediately if the map already reported a viewport.
    if (visibleRef.current) void doFetch();
    return () => {
      clearPoll();
      abortRef.current?.abort();
    };
  }, [enabled, store, doFetch, clearPoll]);

  // User mode-filter changes narrow the request set: refetch now.
  const modeKey = useMemo(() => [...userModes].sort().join(','), [userModes]);
  useEffect(() => {
    if (enabled && visibleRef.current) void doFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);

  // Incremental push updates between polls. The stream is not viewport- or
  // mode-filtered, so it may only *refresh* runs the poll loop already selected —
  // spawning from it would bypass the bbox and the user's mode filter and drag the
  // whole network into the store. `patchOne` touches one run and drops fixes older
  // than the one held, so a stream event can never rewind a newer poll or per-run
  // sample, whichever order they arrive in.
  useEffect(() => {
    if (!enabled) return;
    return openVehicleStream({
      onVehicle: (v) => {
        if (v.runId && store.get(v.runId)) store.patchOne(v);
      }
    });
  }, [enabled, store]);

  // Pause polling while the tab is hidden; refetch once on return (§5.4).
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.hidden) {
        clearPoll();
        abortRef.current?.abort();
      } else {
        void doFetch();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled, doFetch, clearPoll]);

  // Follow a single run via the per-run endpoint at a fixed 5 s cadence (§6.2).
  useEffect(() => {
    if (!enabled || !followRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const refresh = async () => {
      try {
        const v = await fetchVehicle(followRunId, { at: atRef.current }, controller.signal);
        if (cancelled) return;
        store.patchOne(v);
        timer = setTimeout(refresh, FOLLOW_INTERVAL_MS);
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        if ((err as Error & { status?: number })?.status === 404) {
          onFollowEndedRef.current?.(); // run ended — exit follow gracefully
          return;
        }
        timer = setTimeout(refresh, FOLLOW_INTERVAL_MS);
      }
    };
    void refresh();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, followRunId, store]);

  return { store, summary, onViewportChange };
}
