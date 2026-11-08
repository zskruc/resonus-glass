import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createShufflePreference, type ShufflePreferenceSnapshot } from '../src/lib/shufflePreference';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const defer = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
function harness() {
  let profile = 'one';
  const files = new Map<string, string>();
  const reads = new Map<string, Promise<void>>(), saves: [string, string][] = [];
  let writeGate: Promise<void> | undefined, failRead = false, failWrite = false;
  let state: ShufflePreferenceSnapshot | undefined;
  const controller = createShufflePreference({ profile: () => profile,
    read: async (key) => { await reads.get(key); if (failRead) throw Error('Locked'); return files.get(key) ?? null; },
    write: async (key, value) => { saves.push([key, value]); await writeGate; if (failWrite) throw Error('Save failed'); files.set(key, value); },
    publish: (next) => { state = next; },
  });
  return { controller, files, reads, saves, state: () => state!, profile: (value: string) => { profile = value; },
    gate: (value?: Promise<void>) => { writeGate = value; }, failRead: (value: boolean) => { failRead = value; }, failWrite: (value: boolean) => { failWrite = value; } };
}

test('shuffle preferences default safely, persist explicitly per profile, and restore after hydration', async () => {
  const h = harness(); assert.equal(h.controller.getMode(), 'uniform');
  await h.controller.hydrate(); assert.equal(h.saves.length, 0);
  await h.controller.setMode('frequentSongs'); assert.equal(h.controller.getMode(), 'frequentSongs');
  h.profile('two'); assert.equal(h.controller.getMode(), 'uniform');
  await h.controller.hydrate(); await h.controller.setMode('rareArtists');
  h.profile('one'); await h.controller.hydrate(); assert.equal(h.controller.getMode(), 'frequentSongs');
  assert.equal(JSON.parse(h.files.get('resonus.shufflePolicy.two')!).mode, 'rareArtists');
});

test('a late old-profile read cannot restore old preferences after a newer profile has hydrated', async () => {
  const h = harness(), gate = defer();
  h.files.set('resonus.shufflePolicy.one', JSON.stringify({ mode: 'frequentArtists' }));
  h.files.set('resonus.shufflePolicy.two', JSON.stringify({ mode: 'rareSongs' }));
  h.reads.set('resonus.shufflePolicy.one', gate.promise);
  const old = h.controller.hydrate();
  h.profile('two'); await h.controller.hydrate(); gate.resolve(); await old;
  assert.equal(h.controller.getMode(), 'rareSongs'); assert.equal(h.state().profile, 'two');
});

test('serialized saves keep the newest choice and never write an old account choice under a new key', async () => {
  const h = harness(); await h.controller.hydrate(); const gate = defer(); h.gate(gate.promise);
  const first = h.controller.setMode('frequentSongs'), last = h.controller.setMode('rareSongs');
  await turn(); assert.equal(h.saves.length, 1);
  h.profile('two'); const switched = h.controller.hydrate(); gate.resolve(); await Promise.all([first, last, switched]);
  assert.equal(JSON.parse(h.files.get('resonus.shufflePolicy.one')!).mode, 'rareSongs');
  assert.equal(h.files.has('resonus.shufflePolicy.two'), false);
  assert.equal(h.controller.getMode(), 'uniform'); assert.equal(h.state().profile, 'two');
});

test('failed reads cannot overwrite an existing preference and failed writes retain the last saved mode', async () => {
  const h = harness(); h.files.set('resonus.shufflePolicy.one', JSON.stringify({ mode: 'frequentSongs' }));
  h.failRead(true); await h.controller.hydrate();
  await assert.rejects(h.controller.setMode('rareSongs'), /unavailable/); assert.equal(h.saves.length, 0);
  h.failRead(false); await h.controller.hydrate(); h.failWrite(true);
  await assert.rejects(h.controller.setMode('rareArtists'), /Save failed/);
  assert.equal(h.controller.getMode(), 'frequentSongs'); assert.equal(h.state().error, true);
  assert.equal(JSON.parse(h.files.get('resonus.shufflePolicy.one')!).mode, 'frequentSongs');
});

test('repeated shuffle actions reuse a hydrated mode and wait for an accepted save without flashing uniform', async () => {
  const h = harness(); await h.controller.hydrate(); await h.controller.setMode('frequentArtists');
  const gate = defer(); h.gate(gate.promise);
  const save = h.controller.setMode('rareArtists'); await turn();
  const ready = h.controller.hydrate();
  assert.equal(h.controller.getMode(), 'frequentArtists'); assert.equal(h.state().hydrated, true);
  gate.resolve(); await Promise.all([save, ready]);
  assert.equal(h.controller.getMode(), 'rareArtists');
  await h.controller.hydrate(); assert.equal(h.controller.getMode(), 'rareArtists');
});

test('a fast A to B to A switch reads only after an accepted A save settles', async () => {
  const h = harness(); await h.controller.hydrate(); await h.controller.setMode('frequentSongs');
  const gate = defer(); h.gate(gate.promise);
  const save = h.controller.setMode('rareSongs'); await turn();
  h.profile('two'); const two = h.controller.hydrate();
  h.profile('one'); const one = h.controller.hydrate();
  gate.resolve(); await Promise.all([save, two, one]);
  assert.equal(h.state().profile, 'one'); assert.equal(h.controller.getMode(), 'rareSongs');
  assert.equal(JSON.parse(h.files.get('resonus.shufflePolicy.one')!).mode, 'rareSongs');
});
