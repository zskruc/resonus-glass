import { create } from 'zustand';
import { emptyListeningSource, emptyListeningTools, validateListeningTools, type ListeningSession, type ListeningSourceData, type ListeningToolsBackup } from '@/lib/listeningTools';
import { folderSetKey, hashKey } from '@/lib/localLibrary';
import { deleteItem, getItem, setItemStrict } from '@/lib/storage';
import { profileScopeId, useAuthStore } from './auth';

const storageKey = (profile: string) => `resonus.listeningTools.${hashKey(profile)}`;
const positionKey = (profile: string) => `${storageKey(profile)}.positions`;
interface Position { queue: string; index: number; id: string; position: number; at: number }
type Positions = Record<string, Record<string, Position>>;
export const listeningSessionQueueKey = (session: ListeningSession) => hashKey(JSON.stringify(session.songs.map((song) => song.id)));
function positionRecords(raw: string | null): Positions {
  if (!raw) return {}; if (raw.length > 256 * 1024) throw new Error('Invalid session checkpoints');
  const value = JSON.parse(raw) as Positions;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16) throw new Error('Invalid session checkpoints');
  for (const [source, positions] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(source) || !positions || typeof positions !== 'object' || Object.keys(positions).length > 4) throw new Error('Invalid session checkpoints');
    for (const [space, entry] of Object.entries(positions)) if (!['music', 'podcast', 'radio', 'audiobook'].includes(space) || !entry || typeof entry.queue !== 'string'
      || entry.queue.length > 120 || typeof entry.id !== 'string' || entry.id.length > 2048 || !Number.isInteger(entry.index) || entry.index < 0 || entry.index > 499
      || !Number.isFinite(entry.position) || entry.position < 0 || entry.position > 604800 || !Number.isFinite(entry.at) || entry.at < 0 || entry.at > 9e15) throw new Error('Invalid session checkpoint');
  }
  return value;
}
function applyPositions(value: ListeningToolsBackup, positions: Positions): ListeningToolsBackup {
  for (const [source, entries] of Object.entries(positions)) for (const [space, entry] of Object.entries(entries)) {
    const session = value.sources[source]?.sessions[space as ListeningSession['space']];
    if (session && entry.at > session.savedAt && entry.index === session.index && entry.id === session.songs[session.index]?.id && entry.queue === listeningSessionQueueKey(session)) {
      session.position = entry.position; session.savedAt = entry.at;
    }
  }
  return value;
}
export function listeningSourceKey(): string {
  const state = useAuthStore.getState(), source = state.auth ? null : state.offlineSource;
  return hashKey(source ? `local:${source.mode}:${source.mode === 'folder' ? folderSetKey(source.uris) : ''}` : 'server');
}
let installed = false, epoch = 0, sequence = 0, pendingWrites = 0;
let writes: Promise<unknown> = Promise.resolve();
let pending: { profile: string; promise: Promise<void> } | undefined;
const removed = new Map<string, number>();
interface State { profile: string; ready: boolean; value: ListeningToolsBackup; positions: Positions; error: string | null; load(): Promise<void> }
export const useListeningTools = create<State>((set, get) => ({
  profile: '', ready: false, value: emptyListeningTools(), positions: {}, error: null,
  load: () => {
    initListeningTools(); const profile = profileScopeId();
    if (get().profile === profile && get().ready && !get().error) return Promise.resolve();
    if (pending?.profile === profile) return pending.promise;
    const generation = ++sequence, barrier = writes;
    set({ profile, ready: false, value: emptyListeningTools(), positions: {}, error: null });
    const promise = (async () => {
      await barrier.catch(() => {});
      const raw = await getItem(storageKey(profile));
      if (raw && raw.length > 8 * 1024 * 1024) throw new Error('Listening backup is too large');
      const value = raw ? validateListeningTools(JSON.parse(raw)) : emptyListeningTools();
      // New/default users have no session file to read. Checkpoints are tiny,
      // independent of potentially large chapter imports and queue metadata.
      const positions = Object.values(value.sources).some((source) => Object.keys(source.sessions).length)
        ? positionRecords(await getItem(positionKey(profile))) : {};
      if (generation === sequence && profileScopeId() === profile) set({ ready: true, value: applyPositions(value, positions), positions, error: null });
    })().catch((error: unknown) => {
      if (generation === sequence && profileScopeId() === profile) set({ error: 'Listening preferences could not be loaded' });
      throw error;
    }).finally(() => { if (pending?.promise === promise) pending = undefined; });
    pending = { profile, promise }; return promise;
  },
}));
/** Lazy initialization avoids auth → player → preferences startup cycles. */
export function initListeningTools(): void {
  if (installed) return; installed = true;
  useAuthStore.subscribe((state, before) => {
    if (state.auth === before.auth && state.offlineSource === before.offlineSource && state.offline === before.offline && state.autoOffline === before.autoOffline) return;
    epoch++;
    // This file contains safe IDs for every source in one account. Offline
    // transitions need new async tickets, not an empty preference store.
    const previous = useListeningTools.getState(), resume = previous.ready || !!pending;
    if (previous.ready && previous.profile === profileScopeId() && pendingWrites === 0) return;
    sequence++; pending = undefined;
    useListeningTools.setState({ profile: '', ready: false, value: emptyListeningTools(), positions: {}, error: null });
    if (resume) queueMicrotask(() => { void useListeningTools.getState().load().catch(() => {}); });
  });
}
export function currentListeningSource(): ListeningSourceData | undefined {
  const state = useListeningTools.getState();
  return state.ready && state.profile === profileScopeId() ? state.value.sources[listeningSourceKey()] : undefined;
}
export async function mutateListeningSource(change: (value: ListeningSourceData) => ListeningSourceData): Promise<boolean> {
  initListeningTools();
  const profile = profileScopeId(), source = listeningSourceKey(), ticket = epoch, deletion = removed.get(profile) ?? 0;
  const prepared = useListeningTools.getState().load(); void prepared.catch(() => {});
  const run = async () => {
    await prepared;
    const state = useListeningTools.getState();
    if (ticket !== epoch || deletion !== (removed.get(profile) ?? 0) || profileScopeId() !== profile || listeningSourceKey() !== source || state.profile !== profile || !state.ready) return false;
    const changed = change(state.value.sources[source] ?? emptyListeningSource());
    const value = validateListeningTools({ version: 1, sources: { ...state.value.sources, [source]: changed } });
    await setItemStrict(storageKey(profile), JSON.stringify(value));
    if (ticket !== epoch || deletion !== (removed.get(profile) ?? 0) || profileScopeId() !== profile || state.profile !== useListeningTools.getState().profile) return false;
    useListeningTools.setState({ value, error: null }); return true;
  };
  pendingWrites++; const operation = writes.then(run, run); writes = operation.catch(() => {}); return operation.finally(() => { pendingWrites--; });
}
export async function exportListeningTools(): Promise<ListeningToolsBackup> {
  initListeningTools(); const profile = profileScopeId(), ticket = epoch;
  await useListeningTools.getState().load(); const barrier = writes; await barrier.catch(() => {});
  const state = useListeningTools.getState();
  if (ticket !== epoch || state.profile !== profile || profileScopeId() !== profile || !state.ready) throw new Error('Listening profile changed');
  return validateListeningTools(state.value);
}
/** Enabled-only 30s playback checkpoint. Never rewrites the chapter/queue blob. */
export async function checkpointListeningSession(snapshot: ListeningSession, stillCurrent: () => boolean = () => true): Promise<boolean> {
  const state = useListeningTools.getState(), profile = profileScopeId(), source = listeningSourceKey(), ticket = epoch, deletion = removed.get(profile) ?? 0;
  if (!stillCurrent() || !state.ready || state.profile !== profile || !state.value.sources[source]?.separateSessions) return false;
  const run = async () => {
    const current = useListeningTools.getState(), data = current.value.sources[source], saved = data?.sessions[snapshot.space];
    if (!stillCurrent() || ticket !== epoch || deletion !== (removed.get(profile) ?? 0) || profileScopeId() !== profile || listeningSourceKey() !== source || !current.ready || current.profile !== profile
      || !data?.separateSessions || !saved || saved.index !== snapshot.index || saved.songs[saved.index]?.id !== snapshot.songs[snapshot.index]?.id
      || listeningSessionQueueKey(saved) !== listeningSessionQueueKey(snapshot)) return false;
    const positions = positionRecords(JSON.stringify({ ...current.positions, [source]: { ...current.positions[source], [snapshot.space]: {
      queue: listeningSessionQueueKey(snapshot), index: snapshot.index, id: snapshot.songs[snapshot.index].id, position: snapshot.position, at: snapshot.savedAt,
    } } }));
    await setItemStrict(positionKey(profile), JSON.stringify(positions));
    if (!stillCurrent() || ticket !== epoch || deletion !== (removed.get(profile) ?? 0) || profileScopeId() !== profile) return false;
    const value = { version: 1 as const, sources: { ...current.value.sources, [source]: { ...data, sessions: { ...data.sessions,
      [snapshot.space]: { ...saved, position: snapshot.position, savedAt: snapshot.savedAt } } } } };
    useListeningTools.setState({ value, positions, error: null }); return true;
  };
  pendingWrites++; const operation = writes.then(run, run); writes = operation.catch(() => {}); return operation.finally(() => { pendingWrites--; });
}
export async function importListeningTools(input: unknown, merge = true): Promise<boolean> {
  const value = validateListeningTools(input); initListeningTools();
  const profile = profileScopeId(), ticket = epoch, deletion = removed.get(profile) ?? 0;
  const prepared = useListeningTools.getState().load(); void prepared.catch(() => {});
  const run = async () => {
    await prepared;
    if (ticket !== epoch || deletion !== (removed.get(profile) ?? 0) || profileScopeId() !== profile) return false;
    const incoming = value;
    let valueToSave = incoming;
    if (merge) {
      const sources = { ...useListeningTools.getState().value.sources };
      for (const [source, data] of Object.entries(incoming.sources)) {
        const existing = sources[source];
        if (!existing) { sources[source] = data; continue; }
        const sessions = { ...data.sessions, ...existing.sessions };
        for (const [space, session] of Object.entries(data.sessions)) { const old = existing.sessions[space as keyof typeof sessions];
          if (session && (!old || session.savedAt > old.savedAt)) sessions[space as keyof typeof sessions] = session; }
        const links = [...existing.links];
        for (const link of data.links) if (!links.some((old) => old.direction === link.direction && (link.direction === 'next' ? old.from.id === link.from.id : old.to.id === link.to.id))) links.push(link);
        sources[source] = { separateSessions: existing.separateSessions, sessions, links,
          chapters: { ...data.chapters, ...existing.chapters } };
      }
      valueToSave = validateListeningTools({ version: 1, sources });
    }
    await setItemStrict(storageKey(profile), JSON.stringify(valueToSave));
    if (!merge) await deleteItem(positionKey(profile));
    if (ticket !== epoch || deletion !== (removed.get(profile) ?? 0) || profileScopeId() !== profile) return false;
    sequence++; useListeningTools.setState({ profile, ready: true, value: valueToSave, ...(!merge ? { positions: {} } : {}), error: null }); return true;
  };
  pendingWrites++; const operation = writes.then(run, run); writes = operation.catch(() => {}); return operation.finally(() => { pendingWrites--; });
}
export async function clearListeningToolsProfile(profile: string): Promise<void> {
  removed.set(profile, (removed.get(profile) ?? 0) + 1);
  if (useListeningTools.getState().profile === profile || pending?.profile === profile) {
    sequence++; pending = undefined; useListeningTools.setState({ profile: '', ready: false, value: emptyListeningTools(), positions: {}, error: null });
  }
  const erase = async () => { await deleteItem(storageKey(profile)); await deleteItem(positionKey(profile)); };
  pendingWrites++; const operation = writes.then(erase, erase);
  writes = operation.catch(() => {}); try { await operation; } finally { pendingWrites--; }
}
