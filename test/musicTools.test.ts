import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Song } from '../src/api/subsonic';
import { createListeningMeter, listeningBars, listeningRange, localDay, type ListeningCredit, type ListeningSample } from '../src/lib/listeningMath';
import { EMPTY_RULE, evaluateSmartRule, findDuplicateCandidates, normalizeSmartRule, type SmartRule } from '../src/lib/smartRules';

function song(id: string, more: Partial<Song> = {}): Song { return { id, title: id, artist: 'Artist', duration: 180, ...more }; }
function rule(more: Partial<SmartRule> = {}): SmartRule { return { ...EMPTY_RULE, id: 'rule', name: 'Rule', ...more }; }

test('listening meters real elapsed playback, excludes seeks, buffers, clock gaps and queued beats', () => {
  const credits: ListeningCredit[] = [];
  const meter = createListeningMeter((credit) => credits.push(credit));
  const track = song('one');
  const sample = (at: number, position: number, more: Partial<ListeningSample> = {}) => meter.sample({ profile: 'a', song: track,
    playing: true, buffering: false, position, speed: 1, at: 100_000 + at * 1000, ...more });
  sample(0, 0); sample(1, 1); sample(2, 90); sample(3, 91);
  sample(4, 91, { buffering: true }); sample(6, 91); sample(7, 92);
  sample(90, 175); sample(90.01, 176); sample(89, 177);
  assert.equal(credits.reduce((sum, row) => sum + row.seconds, 0), 3);
  assert.equal(credits.reduce((sum, row) => sum + row.plays, 0), 0);
});

test('one session qualifies once through pause/resume; 2x media speed does not double listening hours', () => {
  const credits: ListeningCredit[] = [];
  const meter = createListeningMeter((credit) => credits.push(credit));
  const base = { profile: 'a', song: song('one'), playing: true, buffering: false, speed: 2 };
  for (let i = 0; i <= 35; i++) meter.sample({ ...base, position: i * 2, at: 1000 * i });
  meter.sample({ ...base, position: 70, at: 36_000, playing: false });
  meter.sample({ ...base, position: 70, at: 99_000 });
  meter.sample({ ...base, position: 72, at: 100_000 });
  assert.equal(credits.reduce((sum, row) => sum + row.seconds, 0), 36);
  assert.equal(credits.reduce((sum, row) => sum + row.plays, 0), 1);
});

test('profile changes, new songs and live stations cannot leak another session', () => {
  const credits: ListeningCredit[] = [];
  const meter = createListeningMeter((credit) => credits.push(credit));
  const sample = (profile: string, track: Song, position: number, at: number) => meter.sample({ profile, song: track,
    playing: true, buffering: false, position, speed: 1, at });
  const a = song('same', { duration: 4 }), b = song('same', { duration: 4 });
  sample('a', a, 0, 0); sample('a', a, 1, 1000);
  sample('b', b, 2, 2000); sample('b', b, 3, 3000);
  sample('b', song('radio', { url: 'https://station.invalid/live' }), 4, 4000);
  assert.deepEqual(credits.map((row) => [row.profile, row.seconds]), [['a', 1], ['b', 1]]);
  assert.equal(localDay(new Date(2026, 0, 2, 1).getTime()), '2026-01-02');
});

test('seeking near the end and back to zero never fabricates a new qualified listening session', () => {
  const credits: ListeningCredit[] = [];
  const meter = createListeningMeter((credit) => credits.push(credit));
  const track = song('one', { duration: 200 });
  const sample = (at: number, position: number) => meter.sample({ profile: 'a', song: track,
    playing: true, buffering: false, speed: 1, at: at * 1000, position });
  for (let i = 0; i <= 30; i++) sample(i, i);
  sample(31, 198); sample(32, 0);
  for (let i = 1; i <= 30; i++) sample(32 + i, i);
  assert.equal(credits.reduce((sum, credit) => sum + credit.seconds, 0), 60);
  assert.equal(credits.reduce((sum, credit) => sum + credit.plays, 0), 1);
});

test('calendar report windows have complete local days and yearly bars never invent old events', () => {
  const at = new Date(2026, 0, 7, 12).getTime();
  assert.deepEqual(listeningRange('week', 2026, at), { from: '2026-01-01', until: '2026-01-08' });
  assert.deepEqual(listeningRange('year', 2024, at), { from: '2024-01-01', until: '2025-01-01' });
  const bars = listeningBars([{ day: '2026-01-01', seconds: 10 }, { day: '2026-01-02', seconds: 15 }], 'year', 2026, at);
  assert.equal(bars.length, 12); assert.equal(bars[0].seconds, 25); assert.ok(bars.slice(1).every((row) => row.seconds === 0));
});

test('smart rule validation rejects reversed/invalid years and retains profile-neutral rule definitions', () => {
  assert.equal(normalizeSmartRule(rule({ fromYear: 2025, untilYear: 2000 })), null);
  assert.equal(normalizeSmartRule(rule({ fromYear: 99 })), null);
  assert.equal(normalizeSmartRule({ name: 'Missing id' }), null);
  const value = normalizeSmartRule(rule({ minRating: 99, limit: 999, genre: ' Pop ' }));
  assert.equal(value?.minRating, 5); assert.equal(value?.limit, 100); assert.equal(value?.genre, 'Pop');
});

test('smart conditions are AND, use all genres/local favorites and exclude unknown date/year metadata', async () => {
  const now = new Date(2026, 9, 31).getTime();
  const good = song('good', { artist: 'Beyoncé', genres: [{ name: 'Pop' }], year: 2020, userRating: 4, addedAt: now - 86_400_000 });
  const songs = [good, song('played', { ...good, id: 'played', playCount: 1 }), song('no-date', { ...good, id: 'no-date', addedAt: undefined }),
    song('no-year', { ...good, id: 'no-year', year: undefined }), song('low', { ...good, id: 'low', userRating: 2 })];
  const ids = new Set(songs.map((item) => item.id));
  const result = await evaluateSmartRule(songs, rule({ favorites: true, noPlays: true, minRating: 3, fromYear: 2010, untilYear: 2025, genre: 'pop', artist: 'beyonce', addedDays: 7 }), { now, favoriteIds: ids });
  assert.deepEqual(result.map((item) => item.id), ['good']);
  assert.equal((await evaluateSmartRule([good], rule({ favorites: true }), { favoriteIds: new Set() })).length, 0);
});

test('bounded smart sorting matches a full ranking on a large library and remains cancellable', async () => {
  const songs = Array.from({ length: 12_000 }, (_, i) => song(`id-${String(i).padStart(5, '0')}`, { title: `Track ${12_000 - i}`, playCount: i % 133 }));
  const result = await evaluateSmartRule(songs, rule({ sort: 'most-played', limit: 50 }));
  const expected = songs.slice().sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0) || a.id.localeCompare(b.id)).slice(0, 50);
  assert.deepEqual(result.map((item) => item.id), expected.map((item) => item.id));
  let checks = 0;
  await assert.rejects(evaluateSmartRule(songs, rule(), { current: () => ++checks < 3 }), /cancelled/);
});

test('duplicate suggestions keep versions visible, skip unknown artists, deduplicate IDs and retain quality metadata', async () => {
  const a = song('a', { title: 'Song', duration: 180, bitDepth: 16 }), b = song('b', { title: 'Song', duration: 180.5, bitDepth: 24 });
  const groups = await findDuplicateCandidates([a, b, a, song('c', { title: 'Song (Live)', duration: 210 }),
    song('d', { title: 'Other', artist: '' }), song('e', { title: 'Other', artist: '' })]);
  assert.equal(groups.length, 1); assert.equal(groups[0].versions, true);
  assert.deepEqual(groups[0].songs.map((item) => item.id), ['b', 'a', 'c']);
  const copies = await findDuplicateCandidates([a, b]); assert.equal(copies[0].versions, false);
  assert.equal((await findDuplicateCandidates([song('i', { title: 'Tune (Part I)' }), song('ii', { title: 'Tune (Part II)' })])).length, 0);
});

function loadModule(path: string, imports: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const out: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports: out, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Missing mock ${name}`);
    return imports[name];
  }, setTimeout, clearTimeout, console, ...extra });
  return out;
}

function catalogModule() {
  const owner = { auth: {}, offline: false, offlineSource: null, hydrating: false };
  const disabled = {};
  const state = { ...owner };
  let profile = 'account-a';
  const module = loadModule('../src/lib/musicToolsCatalog.ts', {
    '@/api/data': { getCatalogSongPage: async () => ({ songs: [], sourceCount: 1 }) },
    '@/store/auth': { profileScopeId: () => profile, useAuthStore: { getState: () => state } },
    '@/store/libraries': { useLibraries: { getState: () => ({ disabled }) } },
  });
  return { module, state, switchProfile: () => { profile = 'account-b'; } };
}

test('catalogue collection exhausts capped short pages and every folder, preserving IDs', async () => {
  const { module } = catalogModule();
  const calls: number[][] = [];
  const result: Song[] = await module.collectCatalogPages(async (count: number, offset: number, source: number) => {
    calls.push([count, offset, source]);
    const lists = [[song('one'), song('two')], [song('two'), song('three')]];
    return { songs: lists[source].slice(offset, offset + 1), sourceCount: 2 };
  }, () => true);
  assert.deepEqual(Array.from(result, (item) => item.id), ['one', 'two', 'three']);
  assert.deepEqual(calls.map((call) => call.slice(1)), [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
});

test('catalogue collection rejects repeated pages, source changes and cancelled late reads', async () => {
  const { module } = catalogModule();
  await assert.rejects(module.collectCatalogPages(async () => ({ songs: [song('same')], sourceCount: 1 }), () => true), /repeated/);
  let calls = 0;
  await assert.rejects(module.collectCatalogPages(async () => ({ songs: [song(String(++calls))], sourceCount: calls }), () => true), /sources changed/);
  let current = true;
  await assert.rejects(module.collectCatalogPages(async () => { current = false; return { songs: [song('old')], sourceCount: 1 }; }, () => current), /cancelled/);
});

function databaseModule() {
  const sqlite = new DatabaseSync(':memory:');
  let failOpen = false;
  const args = (values: any[]) => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  const adapter = {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, ...values: any[]) => sqlite.prepare(sql).run(...args(values)),
    getFirstAsync: async (sql: string, ...values: any[]) => sqlite.prepare(sql).get(...args(values)),
    getAllAsync: async (sql: string, ...values: any[]) => sqlite.prepare(sql).all(...args(values)),
    withTransactionAsync: async (work: () => Promise<void>) => {
      sqlite.exec('BEGIN'); try { await work(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const module = loadModule('../src/lib/listeningDb.ts', {
    'expo-sqlite': { openDatabaseAsync: async () => { if (failOpen) throw new Error('database unavailable'); return adapter; } },
    './smartRules': { normalizeSmartRule },
  });
  return { module, sqlite, failOpening: (value: boolean) => { failOpen = value; } };
}

test('real ledger SQL partitions accounts/dates, preserves opt-out and removes URLs/private song fields', async () => {
  const { module, sqlite } = databaseModule();
  const at = new Date(2026, 9, 31, 12).getTime();
  await module.setListeningEnabled('a', false);
  for (const profile of ['a', 'b']) module.queueListeningCredit({ profile, day: '2026-10-31', song: song('same', {
    url: 'https://private.invalid/?token=secret', localUri: 'file:///private/location', comment: 'private note', coverArt: 'https://private.invalid/cover?password=secret',
  }), seconds: profile === 'a' ? 30 : 80, plays: 1, at });
  await module.flushListeningCredits();
  const a = await module.listeningSummary('a', '2026-01-01', '2027-01-01');
  const b = await module.listeningSummary('b', '2026-01-01', '2027-01-01');
  assert.equal(a.seconds, 30); assert.equal(b.seconds, 80); assert.equal(a.plays, 1);
  assert.equal((await module.listeningPreferences('a')).enabled, false, 'flushing old samples cannot undo disabling collection');
  assert.equal(a.top[0].song.url, undefined); assert.equal(a.top[0].song.localUri, undefined);
  assert.equal(a.top[0].song.comment, undefined); assert.equal(a.top[0].song.coverArt, undefined);
  assert.equal((await module.listeningSummary('a', '2025-01-01', '2026-01-01')).seconds, 0);
  sqlite.close();
});

test('failed SQLite opens retain pending credits for a bounded later flush instead of dropping them', async () => {
  const { module, sqlite, failOpening } = databaseModule();
  failOpening(true);
  module.queueListeningCredit({ profile: 'a', day: '2026-10-31', song: song('one'), seconds: 4, plays: 0, at: 123 });
  await assert.rejects(module.flushListeningCredits(), /unavailable/);
  failOpening(false);
  await module.flushListeningCredits();
  assert.equal((await module.listeningSummary('a', '2026-01-01', '2027-01-01')).seconds, 4);
  sqlite.close();
});

test('smart rule persistence uses captured account keys, validates input and preserves another account on deletion', async () => {
  const { module, sqlite } = databaseModule();
  await Promise.all([module.saveSmartRule('a', rule({ name: 'A' })), module.saveSmartRule('b', rule({ name: 'B' }))]);
  assert.equal((await module.savedSmartRules('a'))[0].name, 'A');
  assert.equal((await module.savedSmartRules('b'))[0].name, 'B');
  await module.deleteSmartRule('a', 'rule');
  assert.equal((await module.savedSmartRules('a')).length, 0);
  assert.equal((await module.savedSmartRules('b')).length, 1);
  await assert.rejects(module.saveSmartRule('a', {}), /Invalid/);
  sqlite.close();
});

test('removing a profile clears queued/in-flight credits and rules without deleting another account', async () => {
  const { module, sqlite } = databaseModule();
  await module.saveSmartRule('a', rule()); await module.saveSmartRule('b', rule());
  const credit = (profile: string) => ({ profile, day: '2026-10-31', song: song('one'), seconds: 4, plays: 0, at: 123 });
  module.queueListeningCredit(credit('a')); module.queueListeningCredit(credit('b'));
  const flushing = module.flushListeningCredits();
  const clearing = module.clearMusicToolsProfile('a');
  await Promise.all([flushing, clearing]);
  await module.flushListeningCredits();
  assert.equal((await module.listeningSummary('a', '2026-01-01', '2027-01-01')).seconds, 0);
  assert.equal((await module.savedSmartRules('a')).length, 0);
  assert.equal((await module.listeningSummary('b', '2026-01-01', '2027-01-01')).seconds, 4);
  assert.equal((await module.savedSmartRules('b')).length, 1);
  // Signing in again is a new ledger, not permanently disabled by a tombstone.
  module.queueListeningCredit(credit('a')); await module.flushListeningCredits();
  assert.equal((await module.listeningSummary('a', '2026-01-01', '2027-01-01')).seconds, 4);
  sqlite.close();
});

test('global tracker blocks the previous account queue and stops immediately on opt-out', () => {
  function store(initial: Record<string, any>) {
    let state = initial;
    const listeners = new Set<(state: any, previous: any) => void>();
    return { getState: () => state, subscribe: (listener: (state: any, previous: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      update: (value: Record<string, any>) => { const previous = state; state = { ...state, ...value }; for (const listener of listeners) listener(state, previous); } };
  }
  let profile = 'a', now = 0, cleanup = () => {}, flushes = 0;
  const credits: ListeningCredit[] = [];
  const auth = store({ auth: {}, offline: false, hydrating: false });
  const player = store({ queue: [song('one')], index: 0, positionSec: 0, speed: 1, isPlaying: true, isBuffering: false });
  const prefs = store({ profile: 'a', hydrated: true, enabled: true, load: async () => { prefs.update({ profile, hydrated: true, enabled: true }); } });
  const module = loadModule('../src/components/ListeningStatsTracker.tsx', {
    react: { useEffect: (work: () => () => void) => { cleanup = work(); } },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    '@/lib/listeningMath': { createListeningMeter },
    '@/lib/listeningDb': { queueListeningCredit: (credit: ListeningCredit) => credits.push(credit), flushListeningCredits: async () => { flushes++; } },
    '@/store/auth': { profileScopeId: () => profile, useAuthStore: auth },
    '@/store/listeningStats': { useListeningStats: prefs },
    '@/store/player': { currentSong: (state: any) => state.queue[state.index], usePlayerStore: player },
  }, { Date: class extends Date { static now() { return now; } } });
  module.ListeningStatsTracker();
  now = 1000; player.update({ positionSec: 1 });
  profile = 'b'; auth.update({ auth: {} });
  now = 2000; player.update({ positionSec: 2 });
  now = 3000; player.update({ queue: [song('one')], positionSec: 0 });
  now = 4000; player.update({ positionSec: 1 });
  prefs.update({ enabled: false });
  now = 5000; player.update({ positionSec: 2 });
  cleanup();
  assert.deepEqual(credits.map((credit) => [credit.profile, credit.seconds]), [['a', 1], ['b', 1]]);
  assert.ok(flushes >= 3);
});
