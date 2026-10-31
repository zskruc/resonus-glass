import * as Network from 'expo-network';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { MediaCacheStopped, runBulkMediaWorker } from '@/lib/bulkMediaWorker';
import * as Db from '@/lib/mediaCacheDb';
import { MEDIA_CACHE_KINDS, emptyMediaCacheStats, newMediaCacheJob,
  type MediaCacheJob, type MediaCacheKind, type MediaCacheReason, type MediaCacheStats, type MediaCacheStatus } from '@/lib/mediaCacheTypes';
import { makeMediaCacheRuntime } from '@/lib/mediaCacheRuntime';
import { useAuthStore } from './auth';
import { useNetworkType } from './networkType';
import { useSettings } from './settings';

export type { MediaCacheKind } from '@/lib/mediaCacheTypes';
interface BulkMediaCacheState {
  status: MediaCacheStatus; reason: MediaCacheReason; phase: MediaCacheKind | null;
  stats: MediaCacheStats; selected: MediaCacheKind[]; error: string | null; hydrated: boolean;
  load: () => Promise<void>; start: (kinds: MediaCacheKind[]) => Promise<void>;
  pause: () => void; resume: () => Promise<void>; cancel: () => void; retryFailed: () => Promise<void>;
}
let owner: ReturnType<typeof useAuthStore.getState>['auth'] = null;
let profile = '';
let job = newMediaCacheJob();
let worker: Promise<void> | undefined;
let controller: AbortController | undefined;
let requested: 'paused' | 'cancelled' | null = null;
let epoch = 0;
let starting = false;
let operation = 0;

function apply(current: MediaCacheJob, stats: MediaCacheStats) {
  useBulkMediaCache.setState({ status: current.status, reason: current.reason, phase: current.phase,
    selected: [...current.selected], error: current.error, stats, hydrated: true });
}
function stop(reason: MediaCacheReason, status: 'paused' | 'cancelled' = 'paused') {
  if (!starting && (!controller || controller.signal.aborted) && status !== 'cancelled') return;
  requested = status;
  job.status = status; job.reason = reason; controller?.abort();
  useBulkMediaCache.setState({ status, reason });
  if (!worker && profile) void Db.saveMediaCacheJob(profile, job).catch(() => {});
}
const ownsIntent = (preparation: number, auth: typeof owner) => operation === preparation && useAuthStore.getState().auth === auth;
async function launch(preparation: number, intentAuth: typeof owner): Promise<void> {
  if (!ownsIntent(preparation, intentAuth) || requested) return;
  const auth = useAuthStore.getState().auth;
  if (!auth) { useBulkMediaCache.setState({ status: 'paused', reason: 'profile' }); return; }
  if (worker) { await worker; return launch(preparation, intentAuth); }
  if (auth !== owner || Db.mediaCacheProfile(auth) !== profile) return;
  const token = epoch;
  const runJob = job;
  const runProfile = profile;
  const runController = new AbortController(); controller = runController;
  const owned = () => epoch === token && operation === preparation && useAuthStore.getState().auth === auth;
  runJob.status = 'discovering'; runJob.reason = null; runJob.error = null;
  useBulkMediaCache.setState({ status: 'discovering', reason: null, error: null });
  let initialCellular: boolean;
  let initialConnected: boolean;
  try {
    const network = await Network.getNetworkStateAsync();
    initialCellular = network.type === Network.NetworkStateType.CELLULAR;
    initialConnected = network.isConnected !== false && network.isInternetReachable !== false;
  } catch {
    if (owned() && !runController.signal.aborted && !requested) { runJob.status = 'paused'; runJob.reason = 'wifi'; await Db.saveMediaCacheJob(runProfile, runJob).catch(() => {});
      if (owned() && !runController.signal.aborted && !requested) useBulkMediaCache.setState({ status: 'paused', reason: 'wifi' }); }
    if (controller === runController) controller = undefined;
    return;
  }
  if (!owned() || runController.signal.aborted || requested) {
    if (controller === runController) controller = undefined;
    return;
  }
  const policy = (): MediaCacheReason => {
    const state = useAuthStore.getState();
    if (epoch !== token || state.auth !== auth) return 'profile';
    if (state.offline || !initialConnected || !useNetworkType.getState().connected) return 'offline';
    if (useSettings.getState().downloadWifiOnly && (initialCellular || useNetworkType.getState().cellular)) return 'wifi';
    if (AppState.currentState !== 'active') return 'background';
    return null;
  };
  const unsubscribeNetwork = useNetworkType.subscribe((state) => {
    initialCellular = state.cellular; initialConnected = state.connected;
    const reason = policy(); if (reason) stop(reason);
  });
  const unsubscribeAuth = useAuthStore.subscribe(() => { const reason = policy(); if (reason) stop(reason); });
  const unsubscribeSettings = useSettings.subscribe((state, previous) => {
    if (state.downloadWifiOnly !== previous.downloadWifiOnly) { const reason = policy(); if (reason) stop(reason); }
  });
  const appState = AppState.addEventListener('change', (state) => { if (state !== 'active') stop('background'); });
  const runtime = makeMediaCacheRuntime(auth, runProfile, () => !runController.signal.aborted && policy() === null,
    runJob.lyricsSource ?? useSettings.getState().lyricsSource);
  runJob.error = null; runJob.reason = null;
  worker = (async () => {
    try {
      await runBulkMediaWorker({ job: runJob, signal: runController.signal, policy,
        repository: { saveJob: (value) => Db.saveMediaCacheJob(runProfile, value),
          addPage: (tasks) => Db.addMediaCacheTasks(runProfile, tasks), next: (selected) => Db.nextMediaCacheTask(runProfile, selected),
          finish: (task, outcome) => Db.finishMediaCacheTask(runProfile, task, outcome), stats: () => Db.mediaCacheStats(runProfile) },
        page: runtime.page, process: runtime.process,
        update: (value, stats) => { if (epoch === token && useAuthStore.getState().auth === auth) apply(value, stats); },
      });
    } catch (error) {
      runJob.status = requested ?? (error instanceof MediaCacheStopped ? 'paused' : 'error');
      runJob.reason = error instanceof MediaCacheStopped ? error.reason : runJob.reason;
      runJob.error = error instanceof MediaCacheStopped ? null : 'Media cache could not finish';
    } finally {
      unsubscribeNetwork(); unsubscribeAuth(); unsubscribeSettings(); appState.remove();
      await Db.saveMediaCacheJob(runProfile, runJob).catch(() => {});
      const stats = await Db.mediaCacheStats(runProfile).catch(() => emptyMediaCacheStats());
      if (epoch === token && useAuthStore.getState().auth === auth) apply(runJob, stats);
      if (controller === runController) controller = undefined;
    }
  })();
  if (operation === preparation) starting = false;
  try { await worker; } finally { worker = undefined; }
}

export const useBulkMediaCache = create<BulkMediaCacheState>(() => ({
  status: 'idle', reason: null, phase: null, stats: emptyMediaCacheStats(), selected: [...MEDIA_CACHE_KINDS], error: null, hydrated: false,
  load: async () => {
    const auth = useAuthStore.getState().auth;
    if (auth === owner && profile) return;
    if (controller || worker) stop('profile');
    const token = ++epoch;
    owner = auth; profile = auth ? Db.mediaCacheProfile(auth) : '';
    if (!auth) { job = newMediaCacheJob(); apply(job, emptyMediaCacheStats()); return; }
    const currentProfile = profile;
    try {
      const [saved, stats] = await Promise.all([Db.readMediaCacheJob(currentProfile), Db.mediaCacheStats(currentProfile)]);
      if (token !== epoch || useAuthStore.getState().auth !== auth) return;
      job = saved; apply(job, stats);
    } catch {
      if (token === epoch && useAuthStore.getState().auth === auth) useBulkMediaCache.setState({ status: 'error', error: 'Media cache could not finish', hydrated: true });
    }
  },
  start: async (kinds) => {
    if (starting || worker) return;
    const intentAuth = useAuthStore.getState().auth;
    if (!intentAuth) return;
    const selected = (['artistCovers', 'albumCovers', 'lyrics'] as MediaCacheKind[]).filter((kind) => kinds.includes(kind));
    if (!selected.length) return;
    const preparation = ++operation;
    starting = true; requested = null;
    let activeOwner: typeof owner = owner;
    let activeEpoch = epoch;
    try {
      await useBulkMediaCache.getState().load();
      if (!ownsIntent(preparation, intentAuth) || !owner || !profile || requested) return;
      const auth = owner; const currentProfile = profile;
      activeOwner = auth; activeEpoch = epoch;
      job = newMediaCacheJob(selected);
      job.lyricsSource = useSettings.getState().lyricsSource;
      job.status = 'discovering';
      apply(job, emptyMediaCacheStats());
      const scanJob = job;
      await Db.beginMediaCacheJob(currentProfile, scanJob);
      if (useAuthStore.getState().auth !== auth || epoch !== activeEpoch || requested) {
        await Db.saveMediaCacheJob(currentProfile, scanJob).catch(() => {});
        return;
      }
      apply(job, emptyMediaCacheStats());
      await launch(preparation, intentAuth);
    } catch { if (ownsIntent(preparation, activeOwner) && activeEpoch === epoch && !requested)
      useBulkMediaCache.setState({ status: 'error', error: 'Media cache could not finish' }); }
    finally { if (operation === preparation) starting = false; }
  },
  pause: () => stop('user'), cancel: () => stop('user', 'cancelled'),
  resume: async () => {
    if (starting) return;
    const intentAuth = useAuthStore.getState().auth;
    if (!intentAuth) return;
    const preparation = ++operation;
    starting = true; requested = null;
    try {
      if (worker) await worker;
      if (!ownsIntent(preparation, intentAuth)) return;
      await useBulkMediaCache.getState().load();
      if (!ownsIntent(preparation, intentAuth)) return;
      await launch(preparation, intentAuth);
    }
    finally { if (operation === preparation) starting = false; }
  },
  retryFailed: async () => {
    if (starting || worker) return;
    const intentAuth = useAuthStore.getState().auth;
    if (!intentAuth) return;
    const preparation = ++operation;
    starting = true; requested = null;
    try {
      await useBulkMediaCache.getState().load();
      if (!ownsIntent(preparation, intentAuth) || !owner || !profile) return;
      const runProfile = profile;
      await Db.retryMediaCacheFailures(runProfile);
      if (!ownsIntent(preparation, intentAuth)) return;
      job.error = null; await launch(preparation, intentAuth);
    } finally { if (operation === preparation) starting = false; }
  },
}));
