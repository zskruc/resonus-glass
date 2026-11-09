import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultDiscoveryPreferences, DiscoveryRepository, parseDiscoveryPreferences, resolvedSearchFilter } from '../src/lib/discoveryPreferences';
function harness() {
  let profile = 'A', epoch = 0;
  const disk = new Map<string, string>(), writes: string[] = [];
  const repository = new DiscoveryRepository({ current: () => profile, owner: () => { const at = epoch; return () => at === epoch; }, read: async (key) => disk.get(key) ?? null,
    write: async (key, value) => { writes.push(key); disk.set(key, value); }, remove: async (key) => { disk.delete(key); } });
  return { repository, disk, writes, switch(value: string) { profile = value; epoch++; } };
}
test('profile presentation, local stations and many-to-many tags survive persistence without changing subscriptions', async () => {
  const h = harness(); await h.repository.load();
  const data = defaultDiscoveryPreferences();
  data.search.sections.reverse(); data.search.sections.find((row) => row.key === 'lyrics')!.enabled = false;
  data.shelves.randomAlbums = { layout: 'rows', size: 'small', limit: 8 };
  data.stations = [{ id: 'localradio:one', name: 'Local', streamUrl: 'https://stream.test/live' }];
  data.folders = [{ id: 'folder:one', name: 'Morning' }]; data.tags = ['news', 'language'];
  data.assignments['radio:localradio:one'] = { folder: 'folder:one', tags: ['news', 'language'] };
  await h.repository.change('A', () => data);
  const backup = await h.repository.exportProfile('A'); assert.deepEqual(backup, parseDiscoveryPreferences(data));
  h.switch('B'); await h.repository.load(); assert.equal(h.repository.getSnapshot().data.stations.length, 0);
  assert.equal(await h.repository.change('A', () => data), false);
  await h.repository.importProfile('B', backup); assert.equal(h.repository.getSnapshot().data.stations[0].name, 'Local');
  await h.repository.clearProfile('B'); assert.equal(h.disk.has('B'), false); assert.ok(h.disk.has('A'));
});
test('a failed read never becomes an empty save and a delayed A → B → A read cannot publish', async () => {
  let epoch = 0, resolve!: (value: string) => void, writes = 0;
  const repository = new DiscoveryRepository({ current: () => 'A', owner: () => { const token = epoch; return () => token === epoch; },
    read: () => new Promise((done) => { resolve = done; }), write: async () => { writes++; }, remove: async () => {} });
  const load = repository.load(); await Promise.resolve(); epoch += 2; resolve(JSON.stringify(defaultDiscoveryPreferences())); await load;
  assert.equal(repository.getSnapshot().loaded, false); assert.equal(await repository.change('A', defaultDiscoveryPreferences), false); assert.equal(writes, 0);
  const failed = new DiscoveryRepository({ current: () => 'A', owner: () => () => true, read: async () => { throw new Error('Keystore'); }, write: async () => { writes++; }, remove: async () => {} });
  await failed.load(); assert.equal(failed.getSnapshot().error, true); assert.equal(await failed.change('A', defaultDiscoveryPreferences), false); assert.equal(writes, 0);
});
test('parser rejects credential URLs, duplicate identities and orphan assignments; at least one result section stays visible', () => {
  const source = defaultDiscoveryPreferences(); source.search.sections.forEach((row) => { row.enabled = false; });
  source.stations = [{ id: 'localradio:one', name: 'secret', streamUrl: 'https://user:pass@host.test/live' }];
  source.assignments['podcast:show'] = { folder: 'gone', tags: ['gone'] };
  const result = parseDiscoveryPreferences(source); assert.equal(result.stations.length, 0); assert.equal(result.search.sections.filter((row) => row.enabled).length, 1);
  assert.deepEqual(result.assignments['podcast:show'], { folder: undefined, tags: [] });
});
test('reentrant changes reserve disk writes before notification and deletion cannot resurrect queued data', async () => {
  const h = harness(); await h.repository.load(); let nested = false;
  const off = h.repository.subscribe(() => { if (!nested) { nested = true; void h.repository.change('A', (data) => ({ ...data, tags: ['later'] })); } });
  await h.repository.change('A', (data) => ({ ...data, tags: ['older'] })); await h.repository.exportProfile('A'); off();
  assert.deepEqual(JSON.parse(h.disk.get('A')!).tags, ['later']);
  await h.repository.clearProfile('A'); assert.equal(h.disk.has('A'), false);
});

test('hiding the selected search category safely returns to All while keeping saved order and the remaining categories', () => {
  const data = defaultDiscoveryPreferences(); data.search.sections.reverse();
  assert.equal(resolvedSearchFilter(data.search, 'albums'), 'albums');
  data.search.sections.find((row) => row.key === 'albums')!.enabled = false;
  assert.equal(resolvedSearchFilter(data.search, 'albums'), 'all');
  assert.equal(resolvedSearchFilter(data.search, 'songs'), 'songs');
  assert.equal(resolvedSearchFilter(data.search, 'all'), 'all');
  assert.deepEqual(parseDiscoveryPreferences(data).search.sections.map((row) => row.key), ['radio', 'playlists', 'songs', 'albums', 'artists', 'lyrics']);
});
