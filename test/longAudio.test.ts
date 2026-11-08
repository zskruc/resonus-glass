import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LongAudioRepository, canRememberLongAudio, longAudioEntry, longAudioResumePosition, parseLongAudioEntries } from '../src/lib/longAudio';

const song = { id: 'asmr', title: 'ASMR recording', artist: 'Artist', duration: 7200 };
function harness() {
  let profile = 'A', now = 100000;
  const disk = new Map<string, string>(), writes: { profile: string; value: string }[] = [];
  const repository = new LongAudioRepository({ currentProfile: () => profile, now: () => now,
    read: async (scope) => disk.get(scope) ?? null,
    write: async (scope, value) => { disk.set(scope, value); writes.push({ profile: scope, value }); },
    remove: async (scope) => { disk.delete(scope); },
  });
  return { repository, disk, writes, profile: (next: string) => { profile = next; }, tick: (ms: number) => { now += ms; },
    enable: () => repository.change(profile, song.id, (old) => ({ ...longAudioEntry(song, old, now), enabled: true })) };
}
test('long audio is explicit, excludes live/podcast sources and strips playable paths from saved metadata', () => {
  assert.equal(canRememberLongAudio(song), true);
  for (const extra of [{ url: 'https://radio' }, { vod: true }, { podcastChannelId: 'show' }]) assert.equal(canRememberLongAudio({ ...song, ...extra }), false);
  const saved = longAudioEntry({ ...song, localUri: 'file:///private', coverArt: 'https://host?token=secret' });
  assert.equal(saved.enabled, false);
  assert.ok(!JSON.stringify(saved).includes('private') && !JSON.stringify(saved).includes('secret'));
});
test('resume rewinds ten seconds, never restarts an item near its end or an opted-out item', () => {
  const entry = { ...longAudioEntry(song), enabled: true, positionSec: 120, durationSec: 7200 };
  assert.equal(longAudioResumePosition(entry), 110);
  assert.equal(longAudioResumePosition({ ...entry, positionSec: 3 }), 0);
  assert.equal(longAudioResumePosition({ ...entry, enabled: false }), 0);
  assert.equal(longAudioResumePosition({ ...entry, positionSec: 7198 }), 0);
});
test('validated parsing retains real bookmark notes, rejects invalid values and survives special IDs safely', () => {
  const entry = { ...longAudioEntry(song), enabled: true, bookmarks: [
    { id: 'x', seconds: 12, note: 'At the river', createdAt: 1 },
    { id: 'x', seconds: 17, note: 'duplicate', createdAt: 1 }, { id: 'bad', seconds: -1, note: 'bad', createdAt: 1 },
  ] };
  const parsed = parseLongAudioEntries(JSON.stringify({ [song.id]: entry }));
  assert.deepEqual(parsed[song.id].bookmarks.map((mark) => mark.note), ['At the river']);
  assert.throws(() => parseLongAudioEntries('[]'));
  const special = parseLongAudioEntries(JSON.stringify({ ['__proto__']: { ...entry, song: { ...song, id: '__proto__' } } }));
  assert.ok(Object.hasOwn(special, '__proto__'));
});
test('progress writes are throttled, terminal saves are immediate, and disabled tracks never advance', async () => {
  const h = harness(); await h.repository.load(); await h.enable();
  assert.equal(h.writes.length, 1);
  await h.repository.remember('A', song, 130, 7200); assert.equal(h.writes.length, 1);
  h.tick(30001); await h.repository.remember('A', song, 160, 7200);
  assert.equal(h.writes.length, 2); assert.equal(h.repository.getSnapshot().entries.asmr.positionSec, 160);
  await h.repository.remember('A', song, 170, 7200, true); assert.equal(h.writes.length, 3);
  assert.equal(await h.repository.remember('A', song, NaN, 7200, true), false);
  await h.repository.change('A', song.id, (old) => ({ ...old!, enabled: false }));
  assert.equal(await h.repository.remember('A', song, 180, 7200, true), false);
  assert.equal(h.repository.getSnapshot().entries.asmr.positionSec, 170);
});
test('failed reads remain errors and cannot overwrite an existing bookmark document', async () => {
  let writes = 0;
  const repository = new LongAudioRepository({ currentProfile: () => 'A', read: async () => { throw new Error('locked'); },
    write: async () => { writes++; }, remove: async () => {} });
  await repository.load();
  assert.equal(repository.getSnapshot().hydrated, false); assert.equal(repository.getSnapshot().error, true);
  assert.equal(await repository.change('A', song.id, () => longAudioEntry(song)), false); assert.equal(writes, 0);
});
test('a late A read cannot paint over B; returning to A reads its own persisted position', async () => {
  let profile = 'A', resolve!: (value: string) => void;
  const saved = JSON.stringify({ asmr: { ...longAudioEntry(song), enabled: true, positionSec: 123 } });
  let first = true;
  const repository = new LongAudioRepository({ currentProfile: () => profile,
    read: async (scope) => scope === 'A' ? first ? (first = false, new Promise<string>((done) => { resolve = done; })) : saved : null,
    write: async () => {}, remove: async () => {} });
  const a = repository.load(); await Promise.resolve(); profile = 'B'; await repository.load(); resolve(saved); await a;
  assert.equal(repository.getSnapshot().profile, 'B'); assert.deepEqual(repository.getSnapshot().entries, {});
  profile = 'A'; await repository.load(); assert.equal(repository.getSnapshot().entries.asmr.positionSec, 123);
});
test('accepted writes keep their captured account and removal wins over an in-flight save', async () => {
  let profile = 'A', release!: () => void;
  const disk = new Map<string, string>();
  const repository = new LongAudioRepository({ currentProfile: () => profile, read: async () => null,
    write: async (owner, value) => { await new Promise<void>((done) => { release = done; }); disk.set(owner, value); },
    remove: async (owner) => { disk.delete(owner); } });
  await repository.load();
  const save = repository.change('A', song.id, () => ({ ...longAudioEntry(song), enabled: true }));
  await Promise.resolve(); await Promise.resolve();
  profile = 'B'; await repository.load();
  const removed = repository.removeProfile('A'); release(); await save; await removed;
  assert.equal(disk.has('A'), false); assert.equal(disk.has('B'), false); assert.equal(repository.getSnapshot().profile, 'B');
});
test('new track admission at the bound never silently drops an existing bookmark', async () => {
  const h = harness();
  const entries = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [String(i), longAudioEntry({ id: String(i), title: String(i) })]));
  h.disk.set('A', JSON.stringify(entries)); await h.repository.load();
  assert.equal(await h.repository.change('A', song.id, () => longAudioEntry(song)), false);
  assert.equal(Object.keys(h.repository.getSnapshot().entries).length, 300); assert.equal(h.writes.length, 0);
});
test('a synchronous tracker save during enable is persisted after the older enable snapshot', async () => {
  const h = harness(); await h.repository.load();
  let enabled = false, newer: Promise<boolean> | undefined;
  const unsubscribe = h.repository.subscribe(() => {
    const entry = h.repository.getSnapshot().entries[song.id];
    if (entry?.enabled && !enabled) {
      enabled = true;
      // The real tracker forces the accepted position immediately on opt-in.
      newer = h.repository.remember('A', song, 125, 7200, true);
    }
  });
  await h.enable(); await newer; unsubscribe();
  assert.equal(h.writes.length, 2);
  assert.equal(JSON.parse(h.writes[0].value).asmr.positionSec, 0);
  assert.equal(JSON.parse(h.writes[1].value).asmr.positionSec, 125);
  assert.equal(JSON.parse(h.disk.get('A')!).asmr.positionSec, 125);
  assert.equal(h.repository.getSnapshot().entries.asmr.positionSec, 125);
});
