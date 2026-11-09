import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import { emptyListeningSource, emptyListeningTools, expandShuffleLinks, savedListeningSong, sessionSpace, shuffleLinkedGroups, validateListeningTools, type ListeningSession, type ShuffleLink } from '../src/lib/listeningTools';
import { chapterAt, chapterEnd, chapterStopReached, parseLocalChapters } from '../src/lib/localChapters';

const song = (id: string) => ({ id, title: id, albumId: 'album' });
const edge = (a: string, b: string, direction: 'next' | 'previous' = 'next'): ShuffleLink => ({ from: song(a), to: song(b), direction });
const session = (at = 10): ListeningSession => ({ space: 'music', songs: [song('a'), song('b')], index: 1, position: 22, shuffle: false, repeat: 'off', speed: 1, savedAt: at });
const backup = () => ({ version: 1 as const, sources: { server: { ...emptyListeningSource(), sessions: { music: session() } } } });

test('backups keep stable IDs and safe metadata, never source credentials or artwork bytes', () => {
  const input = { ...song('a'), url: 'https://server/stream?token=SECRET', localUri: 'file:///private/audio', coverBase64: 'SECRET', auth: { password: 'SECRET' }, coverArt: 'https://server/art?token=SECRET' };
  assert.deepEqual(savedListeningSong(input), song('a'));
  const value = backup(); value.sources.server.sessions.music.songs = [input]; value.sources.server.sessions.music.index = 0;
  const saved = validateListeningTools(value), text = JSON.stringify(saved);
  assert.ok(!text.includes('SECRET') && !text.includes('file:///'));
  assert.throws(() => validateListeningTools({ ...value, version: 2 }));
  assert.throws(() => validateListeningTools({ version: 1, sources: { server: { ...emptyListeningSource(), chapters: { a: { songId: 'b', title: 'x', chapters: [{ start: 0, title: 'x' }] } } } } }));
});
test('chapter TXT/JSON import previews precise increasing starts and validates the actual duration', () => {
  const txt = parseLocalChapters('\uFEFF00:00 Intro\n01:02.500 First\n01:00:00 Finale', 4000);
  assert.deepEqual(txt.map((row) => row.start), [0, 62.5, 3600]);
  assert.deepEqual(parseLocalChapters('{"chapters":[{"title":"Intro","startTime":"00:00","endTime":60},{"title":"Part","startSec":60}]}', 100), [
    { title: 'Intro', start: 0, end: 60 }, { title: 'Part', start: 60 },
  ]);
  for (const text of ['00:00 Intro\n00:00 Duplicate', '01:60 Bad', '[{"title":"x","start":0,"end":"bad"}]', '[{"title":"x","start":0,"end":70},{"title":"y","start":60}]', 'x'.repeat(1024 * 1024 + 1)]) assert.throws(() => parseLocalChapters(text, 100));
  assert.throws(() => parseLocalChapters('02:00 Outside', 100));
  assert.equal(chapterAt(txt, 63), 1); assert.equal(chapterEnd(txt, 1), 3600); assert.equal(chapterEnd(txt, 2), null);
});
test('chapter stop consumes only its own boundary; unknown final duration needs a real end event', () => {
  const lock = { songId: 'a', chapterStart: 10, end: 30, title: 'Part' };
  assert.equal(chapterStopReached(lock, 'a', 29.9, false), false);
  assert.equal(chapterStopReached(lock, 'b', 35, true), false);
  assert.equal(chapterStopReached(lock, 'a', 30, false), true);
  assert.equal(chapterStopReached({ ...lock, end: null }, 'a', 999999, false), false);
  assert.equal(chapterStopReached({ ...lock, end: null }, 'a', 40, true), true);
});
test('linked shuffle moves chains together, rejects cycles, and preserves duplicate occurrences', () => {
  const a = song('a'), b = song('b'), c = song('c'), d = song('d');
  const source = [a, b, c, d, a];
  const result = shuffleLinkedGroups(source, [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')], (items) => items.reverse());
  assert.equal(result.length, source.length); assert.equal(result.filter((item) => item === a).length, 2);
  const at = result.indexOf(b); assert.equal(result[at - 1], a); assert.equal(result[at + 1], c);
  assert.deepEqual(source, [a, b, c, d, a]);
  const lead = shuffleLinkedGroups(source, [edge('a', 'b')], (items) => items.reverse(), a, 4);
  assert.equal(lead[0], a); assert.equal(lead.filter((item) => item === a).length, 2, 'the chosen duplicate is pinned without losing the first linked occurrence');
  assert.equal(lead[lead.indexOf(b) - 1], a);
  assert.equal(shuffleLinkedGroups(source, [], (items) => items, a, 4).length, source.length);
});
test('directional neighbour expansion is finite, unique and never changes an ordered caller input', () => {
  const original = [song('a')];
  assert.deepEqual(expandShuffleLinks(original, [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(expandShuffleLinks([song('b')], [edge('a', 'b', 'previous')]).map((item) => item.id), ['b', 'a']);
  assert.equal(original.length, 1);
  assert.equal(sessionSpace({ ...song('p'), podcastChannelId: 'show' }), 'podcast');
  assert.equal(sessionSpace({ ...song('r'), url: 'https://radio' }), 'radio');
});

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  const a = { username: 'A' }, b = { username: 'B' }, auth = createStore(() => ({ auth: a, offline: false, offlineSource: null as null | { mode: string; uris: string[] }, autoOffline: false }));
  const disk = new Map<string, string>(); let heldRead: (() => void) | undefined, holdRead = false, heldWrite: (() => void) | undefined, holdWrite = false, failRead = false, failWrite = false;
  const module: Record<string, any> = {};
  const imports = { zustand: { create: createStore }, '@/lib/listeningTools': { emptyListeningSource, emptyListeningTools, validateListeningTools },
    '@/lib/localLibrary': { hashKey: (value: string) => value.replace(/[^a-z0-9]/gi, '_'), folderSetKey: (values: string[]) => [...values].sort().join('_') },
    '@/lib/storage': { getItem: async (key: string) => { if (failRead) throw Error('Locked'); const captured = disk.get(key) ?? null; if (holdRead) { holdRead = false; await new Promise<void>((yes) => { heldRead = yes; }); } return captured; },
      setItemStrict: async (key: string, value: string) => { if (holdWrite) { holdWrite = false; await new Promise<void>((yes) => { heldWrite = yes; }); } if (failWrite) throw Error('Full'); disk.set(key, value); },
      deleteItem: async (key: string) => { disk.delete(key); } }, './auth': { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username } };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/listeningTools.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: module, queueMicrotask, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key as keyof typeof imports]; } });
  return { useListeningTools: module.useListeningTools, currentListeningSource: module.currentListeningSource,
    mutateListeningSource: module.mutateListeningSource, importListeningTools: module.importListeningTools, exportListeningTools: module.exportListeningTools,
    clearListeningToolsProfile: module.clearListeningToolsProfile, checkpointListeningSession: module.checkpointListeningSession,
    disk, switchTo: (id: 'A' | 'B') => auth.setState({ auth: id === 'A' ? a : b }),
    holdRead: () => { holdRead = true; }, releaseRead: () => heldRead?.(), holdWrite: () => { holdWrite = true; }, releaseWrite: () => heldWrite?.(),
    failRead: () => { failRead = true; }, failWrite: () => { failWrite = true; }, offline: () => auth.setState({ offline: true }) };
}
test('listening state serializes mutations and survives account round trips with source isolation', async () => {
  const h = harness();
  await Promise.all([h.mutateListeningSource((value: any) => ({ ...value, separateSessions: true })), h.mutateListeningSource((value: any) => ({ ...value, links: [edge('a', 'b')] }))]);
  assert.equal(h.currentListeningSource().separateSessions, true); assert.equal(h.currentListeningSource().links.length, 1);
  h.switchTo('B'); await h.useListeningTools.getState().load(); assert.equal(h.currentListeningSource(), undefined);
  h.switchTo('A'); await h.useListeningTools.getState().load(); assert.equal(h.currentListeningSource().links.length, 1);
  h.offline(); assert.equal(h.useListeningTools.getState().ready, true); assert.equal(h.currentListeningSource().links.length, 1, 'same server source remains active offline without a mounted settings page');
});
test('old hydration and queued saves cannot cross an account ABA', async () => {
  const h = harness(), old = backup(), fresh = backup(); old.sources.server.links = [edge('old', 'stale')]; fresh.sources.server.links = [edge('fresh', 'current')];
  h.disk.set('resonus.listeningTools.A', JSON.stringify(old)); h.holdRead();
  const save = h.mutateListeningSource((value: any) => ({ ...value, links: [edge('a', 'b')] })); await turn();
  h.switchTo('B'); h.switchTo('A'); h.disk.set('resonus.listeningTools.A', JSON.stringify(fresh)); h.releaseRead();
  assert.equal(await save, false); await h.useListeningTools.getState().load();
  assert.equal(h.currentListeningSource().links[0].from.id, 'fresh');
  assert.equal(JSON.parse(h.disk.get('resonus.listeningTools.A')!).sources.server.links[0].from.id, 'fresh');
});
test('accepted writes settle before returning account reads, and deletion cannot resurrect data', async () => {
  const h = harness(); await h.useListeningTools.getState().load(); h.holdWrite();
  const save = h.mutateListeningSource((value: any) => ({ ...value, links: [edge('a', 'b')] })); await turn();
  h.switchTo('B'); h.switchTo('A'); const load = h.useListeningTools.getState().load(); h.releaseWrite(); await save; await load;
  assert.equal(h.currentListeningSource().links.length, 1);
  h.holdWrite(); const second = h.mutateListeningSource((value: any) => ({ ...value, separateSessions: true })); await turn();
  const clear = h.clearListeningToolsProfile('A'); h.releaseWrite(); await second; await clear;
  assert.equal(h.disk.size, 0); await h.useListeningTools.getState().load(); assert.equal(h.currentListeningSource(), undefined);
});
test('failed reads/writes remain failures and never publish defaults over unread state', async () => {
  const h = harness(); h.failRead(); await assert.rejects(h.mutateListeningSource((value: any) => value)); assert.equal(h.disk.size, 0);
  const w = harness(); await w.useListeningTools.getState().load(); w.failWrite(); await assert.rejects(w.mutateListeningSource((value: any) => ({ ...value, separateSessions: true })));
  assert.equal(w.currentListeningSource(), undefined);
});
test('backup restore merges newer sessions while preserving existing chapter/link choices', async () => {
  const h = harness(); await h.importListeningTools(backup());
  const incoming = backup(); incoming.sources.server.sessions.music.savedAt = 1; incoming.sources.server.links = [edge('b', 'c')];
  await h.importListeningTools(incoming); const saved = await h.exportListeningTools();
  assert.equal(saved.sources.server.sessions.music.savedAt, 10); assert.equal(saved.sources.server.links.length, 1);
  incoming.sources.server.sessions.music.savedAt = 20; await h.importListeningTools(incoming);
  assert.equal((await h.exportListeningTools()).sources.server.sessions.music.savedAt, 20);
});
test('enabled checkpoints persist only a tiny position record, hydrate after restart and join portable export', async () => {
  const h = harness(), value = backup(); value.sources.server.separateSessions = true;
  await h.importListeningTools(value); const original = h.disk.get('resonus.listeningTools.A');
  assert.equal(await h.checkpointListeningSession({ ...session(100), position: 55 }), true);
  assert.equal(h.disk.get('resonus.listeningTools.A'), original, 'chapter and queue metadata were not rewritten');
  assert.ok(h.disk.get('resonus.listeningTools.A.positions')!.length < 300);
  h.switchTo('B'); h.switchTo('A'); await h.useListeningTools.getState().load();
  assert.equal(h.currentListeningSource().sessions.music.position, 55);
  assert.equal((await h.exportListeningTools()).sources.server.sessions.music.position, 55);
  assert.equal(await h.checkpointListeningSession({ ...session(101), index: 0 }), false, 'a checkpoint cannot attach to another selected occurrence');
  assert.equal(await h.checkpointListeningSession({ ...session(102), position: 80 }, () => false), false);
  await h.clearListeningToolsProfile('A'); assert.equal(h.disk.size, 0);
});
test('an offline transition during an accepted native checkpoint reads it before a newer edit', async () => {
  const h = harness(), value = backup(); value.sources.server.separateSessions = true; await h.importListeningTools(value);
  h.holdWrite(); const pending = h.checkpointListeningSession({ ...session(100), position: 68 }); await turn();
  h.offline(); const reading = h.useListeningTools.getState().load(); h.releaseWrite(); await pending; await reading;
  assert.equal(h.currentListeningSource().sessions.music.position, 68);
  await h.mutateListeningSource((data: any) => ({ ...data, links: [edge('a', 'b')] }));
  assert.equal((await h.exportListeningTools()).sources.server.sessions.music.position, 68);
});
