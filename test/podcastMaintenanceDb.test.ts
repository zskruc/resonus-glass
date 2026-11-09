/** Actual isolated SQLite tests for durable retention, never the phone's database. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const DAY = 24 * 60 * 60 * 1000;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function harness(legacy = false) {
  let now = 20 * DAY;
  const handles = new Map<string, DatabaseSync>();
  let gate: { matches(sql: string): boolean; run(): Promise<void> } | undefined;
  const raw = (scope = 'A') => {
    const path = `/sandbox/podcasts/${scope}/`;
    let db = handles.get(path); if (!db) { db = new DatabaseSync(':memory:'); handles.set(path, db); }
    return db;
  };
  if (legacy) {
    const db = raw();
    db.exec(`CREATE TABLE podcast_channels(id TEXT PRIMARY KEY,feed_url TEXT NOT NULL,title TEXT NOT NULL,last_published_at INTEGER,refreshed_at INTEGER,data TEXT NOT NULL);
      CREATE TABLE podcast_downloads(episode_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,file TEXT NOT NULL,bytes INTEGER,downloaded_at INTEGER NOT NULL);
      CREATE TABLE podcast_progress(episode_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,position_sec REAL NOT NULL,duration_sec REAL NOT NULL,updated_at INTEGER NOT NULL);
      INSERT INTO podcast_downloads VALUES('show/old','show','file:///old.mp3',42,1);
      INSERT INTO podcast_progress VALUES('show/old','show',300,300,1);
      INSERT INTO podcast_progress VALUES('show/unfinished','show',100,300,1);
      PRAGMA user_version=1;`);
    db.prepare('INSERT INTO podcast_channels VALUES(?,?,?,?,?,?)').run('show', 'https://feed.test/rss', 'Legacy', 1, 1,
      JSON.stringify({ id: 'show', title: 'Legacy', feedUrl: 'https://feed.test/rss', syncComplete: true }));
  }
  const args = (values: unknown[]) => values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  const imports: Record<string, unknown> = {
    'expo-file-system/legacy': { documentDirectory: 'file:///sandbox/', makeDirectoryAsync: async () => {}, deleteAsync: async () => {} },
    '@/lib/localLibrary': { hashKey: (value: string) => value }, './podcastMedia': {}, '@/api/netGate': {},
    'expo-sqlite': { openDatabaseAsync: async (_name: string, _options: unknown, path: string) => {
      const db = raw(path.split('/').filter(Boolean).at(-1));
      return { execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, ...values: unknown[]) => {
          const result = db.prepare(sql).run(...args(values));
          if (gate?.matches(sql)) { const work = gate.run; gate = undefined; await work(); }
          return result;
        },
        getFirstAsync: async (sql: string, ...values: unknown[]) => db.prepare(sql).get(...args(values)),
        getAllAsync: async (sql: string, ...values: unknown[]) => db.prepare(sql).all(...args(values)),
        withTransactionAsync: async (work: () => Promise<void>) => {
          db.exec('BEGIN'); try { await work(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
        }, closeAsync: async () => {},
      };
    } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/podcastDb.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date: { now: () => now }, setTimeout, clearTimeout, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), name); return imports[name];
  } });
  return { Db: exports, raw, time: () => now, setTime: (value: number) => { now = value; },
    gate: (matches: (sql: string) => boolean, run: () => Promise<void>) => { gate = { matches, run }; },
    close: () => { for (const db of handles.values()) db.close(); } };
}
const channel = (id = 'show') => ({ id, title: id, feedUrl: `https://feed.test/${id}`, syncComplete: true,
  imageUrl: `https://art.test/${id}.jpg`, artFile: `file:///art/${id}.jpg`, refreshedAt: 1, etag: 'tag', episodeCount: 3,
  descriptionHtml: '<p>' + 'show notes '.repeat(200) + '</p>' });
const episode = (id = 'show/one', channelId = 'show') => ({ id, channelId, title: id,
  url: `https://audio.test/${id}.mp3`, duration: 300, descriptionHtml: '<p>' + 'episode notes '.repeat(200) + '</p>',
  chapters: [{ startSec: 30, title: 'Offline chapter' }], transcripts: [{ url: 'https://text.test/transcript.vtt', type: 'text/vtt' }] });

test('migration protects old downloads and grants legacy completed progress and previews a fresh grace period', async () => {
  const h = harness(true);
  try {
    const rows = await h.Db.listPodcastDownloadRecords('A');
    assert.equal(rows[0].automatic, false); assert.equal(rows[0].finishedAt, h.time());
    assert.equal(h.raw().prepare('PRAGMA user_version').get()!.user_version, 2);
    assert.equal(h.raw().prepare('SELECT finished_at FROM podcast_progress WHERE episode_id=?').get('show/unfinished')!.finished_at, null);
    assert.equal(h.raw().prepare('SELECT last_accessed_at FROM podcast_access WHERE channel_id=?').get('show')!.last_accessed_at, h.time());
    assert.equal((await h.Db.eligibleAutoDownloads('A', h.time() + 2 * DAY)).length, 0, 'legacy audio never becomes automatic');
    assert.equal((await h.Db.prunePreviewCatalog('A', h.time() - 3 * DAY)).removedChannels, 0);
  } finally { h.close(); }
});

test('manual intent wins before, during and after an automatic commit, and never replaces source identity', async () => {
  const h = harness();
  try {
    await h.Db.markDownloadsManual('A', ['show/one']);
    await h.Db.saveDownload('A', episode(), 'file:///automatic.mp3', 20, () => true, true);
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].automatic, false);
    await h.Db.saveDownload('A', episode('show/two'), 'file:///two.mp3', 30, () => true, true);
    assert.equal((await h.Db.listPodcastDownloadRecords('A')).find((row: any) => row.episodeId === 'show/two').automatic, true);
    await h.Db.markDownloadsManual('A', ['show/two']);
    await h.Db.saveDownload('A', episode('show/two'), 'file:///two-new.mp3', 31, () => true, true);
    const row = (await h.Db.listPodcastDownloadRecords('A')).find((value: any) => value.episodeId === 'show/two');
    assert.equal(row.automatic, false); assert.equal(row.file, 'file:///two-new.mp3'); assert.equal(row.channelId, 'show');
    assert.equal((await h.Db.listPodcastDownloadRecords('B')).length, 0);
  } finally { h.close(); }
});

test('completion stays fixed across completed heartbeats but a replay receives a new24-hour grace period', async () => {
  const h = harness();
  try {
    await h.Db.saveDownload('A', episode(), 'file:///one.mp3', 20, () => true, true);
    await h.Db.saveEpisodeProgress('A', { id: 'show/one', channelId: 'show', positionSec: 269, durationSec: 300 });
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].finishedAt, null);
    await h.Db.saveEpisodeProgress('A', { id: 'show/one', channelId: 'show', positionSec: 270, durationSec: 300 });
    const finished = h.time(); h.setTime(h.time() + 2 * DAY);
    await h.Db.saveEpisodeProgress('A', { id: 'show/one', channelId: 'show', positionSec: 299, durationSec: 300 });
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].finishedAt, finished);
    assert.equal((await h.Db.eligibleAutoDownloads('A', finished + DAY - 1)).length, 0);
    assert.equal((await h.Db.eligibleAutoDownloads('A', finished + DAY)).length, 1);
    assert.equal((await h.Db.eligibleAutoDownloads('A', h.time(), ['show/one'])).length, 0);
    await h.Db.saveEpisodeProgress('A', { id: 'show/one', channelId: 'show', positionSec: 50, durationSec: 300 });
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].finishedAt, null);
    assert.equal((await h.Db.eligibleAutoDownloads('A', h.time())).length, 0, 'a replay currently in progress is protected');
    await h.Db.saveEpisodeProgress('A', { id: 'show/one', channelId: 'show', positionSec: 299, durationSec: 300 });
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].finishedAt, h.time());
    assert.equal((await h.Db.eligibleAutoDownloads('A', h.time())).length, 0, 'old completion cannot delete a newly finished replay');
    assert.equal((await h.Db.eligibleAutoDownloads('A', h.time() + DAY - 1)).length, 0);
    assert.equal((await h.Db.eligibleAutoDownloads('A', h.time() + DAY)).length, 1);
    await h.Db.clearEpisodeProgress('A', 'show/one');
    await h.Db.markManyPlayed('A', [{ id: 'show/one', channelId: 'show', durationSec: 300 }], () => true);
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].finishedAt, h.time());
    assert.equal((await h.Db.eligibleAutoDownloads('A', h.time())).length, 0);
    let current = true;
    h.gate((sql) => sql.startsWith('DELETE FROM podcast_progress'), async () => { current = false; });
    await assert.rejects(h.Db.clearEpisodeProgress('A', 'show/one', () => current), /scope changed/);
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].finishedAt, h.time(), 'a cancelled unplayed mark rolls back its completion reset');
  } finally { h.close(); }
});

test('automatic removal atomically rechecks manual intent, file identity, completion and account ownership', async () => {
  const h = harness();
  try {
    await h.Db.saveDownload('A', episode(), 'file:///one.mp3', 20, () => true, true);
    await h.Db.markManyPlayed('A', [{ id: 'show/one', channelId: 'show', durationSec: 300 }], () => true);
    h.setTime(h.time() + DAY);
    const [entry] = await h.Db.eligibleAutoDownloads('A', h.time());
    await h.Db.markDownloadsManual('A', ['show/one']);
    assert.equal(await h.Db.claimAutoDownloadRemoval('A', entry, () => true, h.time()), false);
    await h.Db.dropDownloads('A', ['show/one']);
    await h.Db.saveDownload('A', episode(), 'file:///replacement.mp3', 21, () => true, true);
    assert.equal(await h.Db.claimAutoDownloadRemoval('A', entry, () => true, h.time()), false);
    const [next] = await h.Db.eligibleAutoDownloads('A', h.time()); let current = true;
    h.gate((sql) => sql.startsWith('DELETE FROM podcast_downloads'), async () => { current = false; });
    await assert.rejects(h.Db.claimAutoDownloadRemoval('A', next, () => current, h.time()), /scope changed/);
    assert.equal((await h.Db.getDownload('A', 'show/one')).file, 'file:///replacement.mp3');
  } finally { h.close(); }
});

test('failed filesystem removals restore only an absent record and keep new manual downloads authoritative', async () => {
  const h = harness();
  try {
    await h.Db.saveFeedSnapshot('A', channel(), [episode()]);
    await h.Db.saveDownload('A', episode(), 'file:///old.mp3', 20, () => true, true);
    const [old] = await h.Db.listPodcastDownloadRecords('A');
    assert.equal(await h.Db.claimPodcastDownloadRemoval('A', old), true);
    await h.Db.markDownloadsManual('A', ['show/one']);
    await h.Db.restoreClaimedPodcastDownload('A', old);
    assert.equal((await h.Db.listPodcastDownloadRecords('A'))[0].automatic, false);
    assert.equal(await h.Db.claimPodcastDownloadRemoval('A', old), true);
    await h.Db.saveDownload('A', episode(), 'file:///new.mp3', 99);
    await h.Db.restoreClaimedPodcastDownload('A', old);
    const [fresh] = await h.Db.listPodcastDownloadRecords('A');
    assert.equal(fresh.file, 'file:///new.mp3'); assert.equal(fresh.bytes, 99); assert.equal(fresh.automatic, false);
  } finally { h.close(); }
});

test('unlink compensation cannot resurrect downloads after unsubscribe or loss of either owning metadata row', async () => {
  for (const missing of ['unsubscribe', 'episode', 'channel']) {
    const h = harness();
    try {
      await h.Db.saveFeedSnapshot('A', { ...channel(), imageUrl: undefined, artFile: undefined }, [episode()]);
      await h.Db.saveDownload('A', episode(), 'file:///old.mp3', 20, () => true, true);
      const [entry] = await h.Db.listPodcastDownloadRecords('A');
      assert.equal(await h.Db.claimPodcastDownloadRemoval('A', entry), true);
      if (missing === 'unsubscribe') await h.Db.removeChannel('A', 'show');
      else if (missing === 'episode') h.raw().prepare('DELETE FROM podcast_episodes WHERE id=?').run(entry.episodeId);
      else h.raw().prepare('DELETE FROM podcast_channels WHERE id=?').run(entry.channelId);
      await h.Db.restoreClaimedPodcastDownload('A', entry);
      assert.equal((await h.Db.listPodcastDownloadRecords('A')).length, 0, missing);
      assert.equal(await h.Db.getDownload('A', entry.episodeId), undefined, missing);
    } finally { h.close(); }
  }
});

test('download lookup cannot observe an uncommitted cleanup claim on the shared SQLite connection', async () => {
  const h = harness(); let release!: () => void, entered!: () => void;
  const paused = new Promise<void>((resolve) => { entered = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  try {
    await h.Db.saveDownload('A', episode(), 'file:///one.mp3', 40);
    const [entry] = await h.Db.listPodcastDownloadRecords('A');
    h.gate((sql) => sql.startsWith('DELETE FROM podcast_downloads'), async () => { entered(); await resume; });
    const claim = h.Db.claimPodcastDownloadRemoval('A', entry); await paused;
    let returned = false;
    const read = h.Db.getDownload('A', entry.episodeId).then((value: unknown) => { returned = true; return value; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(returned, false, 'a worker must wait until the claim commits or rolls back');
    release(); assert.equal(await claim, true); assert.equal(await read, undefined);
  } finally { release?.(); h.close(); }
});

test('preview pruning keeps every user reference and subscription, strips only rebuildable data, and protects active/recent shows', async () => {
  const h = harness();
  try {
    for (const id of ['unused', 'kept', 'subscribed', 'active', 'recent', 'favorite', 'preference'])
      await h.Db.saveFeedSnapshot('A', channel(id), Array.from({ length: id === 'kept' ? 5 : 3 }, (_, index) => episode(`${id}/${index}`, id)));
    await h.Db.addChannel('A', 'subscribed');
    await h.Db.saveDownload('A', episode('kept/0', 'kept'), 'file:///kept.mp3', 40);
    await h.Db.saveEpisodeProgress('A', { id: 'kept/1', channelId: 'kept', positionSec: 50, durationSec: 300 });
    await h.Db.toggleFavorite('A', 'kept/2', 'episode', 'kept');
    await h.Db.setAutoDownload('A', 'kept', true);
    await h.Db.markDownloadsManual('A', ['kept/4']);
    await h.Db.toggleFavorite('A', 'favorite', 'channel', 'favorite');
    await h.Db.setAutoDownload('A', 'preference', true);
    h.setTime(h.time() + 4 * DAY); await h.Db.touchChannel('A', 'recent', h.time());
    const pruned = await h.Db.prunePreviewCatalog('A', h.time() - 3 * DAY, ['active']);
    assert.equal(pruned.removedChannels, 1); assert.equal(pruned.removedEpisodes, 10);
    assert.deepEqual(Array.from(pruned.removedArtFiles), ['file:///art/unused.jpg']);
    assert.equal(await h.Db.getChannel('A', 'unused'), undefined);
    const kept = await h.Db.getChannel('A', 'kept');
    assert.equal(kept.syncComplete, false); assert.equal(kept.etag, undefined); assert.equal(kept.episodeCount, undefined);
    assert.equal(kept.descriptionHtml, undefined); assert.equal(kept.title, 'kept'); assert.equal(kept.feedUrl, channel('kept').feedUrl);
    for (const retained of await h.Db.listAllEpisodes('A', 'kept')) {
      assert.ok(retained.url);
      if (retained.id === 'kept/0' || retained.id === 'kept/4') {
        assert.equal(retained.descriptionHtml, episode().descriptionHtml, 'intentional offline/manual assets keep their notes');
        assert.equal(retained.chapters[0].title, 'Offline chapter');
        assert.equal(retained.transcripts[0].url, 'https://text.test/transcript.vtt');
      } else {
        assert.equal(retained.descriptionHtml, undefined); assert.equal(retained.chapters, undefined); assert.equal(retained.transcripts, undefined);
      }
    }
    assert.equal((await h.Db.listDownloads('A'))['kept/0'], 'file:///kept.mp3');
    assert.equal((await h.Db.getEpisodeProgress('A', 'kept/1')).positionSec, 50);
    assert.equal((await h.Db.favoriteIds('A')).has('kept/2'), true); assert.equal((await h.Db.autoDownloadIds('A')).has('kept'), true);
    assert.equal((await h.Db.listAllEpisodes('A', 'kept')).length, 4, 'only the unreferenced fourth episode is removed');
    for (const id of ['favorite', 'preference']) {
      assert.equal((await h.Db.getChannel('A', id)).syncComplete, false);
      assert.equal((await h.Db.listAllEpisodes('A', id)).length, 0);
    }
    assert.equal((await h.Db.favoriteIds('A')).has('favorite'), true);
    assert.equal((await h.Db.autoDownloadIds('A')).has('preference'), true);
    for (const id of ['subscribed', 'active', 'recent']) {
      assert.equal((await h.Db.getChannel('A', id)).syncComplete, true);
      assert.ok((await h.Db.getChannel('A', id)).descriptionHtml);
      assert.equal((await h.Db.listAllEpisodes('A', id)).length, 3);
    }
  } finally { h.close(); }
});

test('preview prune cancels atomically when a new route/account owner invalidates its lease snapshot', async () => {
  const h = harness();
  try {
    await h.Db.saveFeedSnapshot('A', channel(), [episode()]); h.setTime(h.time() + 4 * DAY);
    let current = true;
    h.gate((sql) => sql.startsWith('DELETE FROM podcast_episodes'), async () => { current = false; });
    await assert.rejects(h.Db.prunePreviewCatalog('A', h.time() - 3 * DAY, [], () => current), /scope changed/);
    assert.equal((await h.Db.getChannel('A', 'show')).syncComplete, true);
    assert.equal((await h.Db.listAllEpisodes('A', 'show')).length, 1);
  } finally { h.close(); }
});

test('the three-day cutoff is inclusive and an older queued touch cannot move access backwards', async () => {
  const h = harness();
  try {
    await h.Db.saveFeedSnapshot('A', channel(), [episode()]); const initial = h.time();
    await h.Db.touchChannel('A', 'show', initial - DAY);
    assert.equal((await h.Db.prunePreviewCatalog('A', initial - 1)).removedChannels, 0);
    h.setTime(initial + 3 * DAY);
    assert.equal((await h.Db.prunePreviewCatalog('A', h.time() - 3 * DAY)).removedChannels, 1);
  } finally { h.close(); }
});

test('daily maintenance claims persist, serialize racing callers and cannot be completed by an older claim', async () => {
  const h = harness();
  try {
    const now = h.time();
    assert.deepEqual(plain(await h.Db.getMaintenanceState('A')), { lastStartedAt: null, lastCompletedAt: null });
    assert.deepEqual(await Promise.all([h.Db.claimMaintenance('A', now), h.Db.claimMaintenance('A', now)]), [true, false]);
    await h.Db.completeMaintenance('A', now, now + 50);
    assert.equal((await h.Db.getMaintenanceState('A')).lastCompletedAt, now + 50);
    assert.equal(await h.Db.claimMaintenance('A', now + DAY - 1), false);
    assert.equal(await h.Db.claimMaintenance('A', now + DAY), true);
    await h.Db.completeMaintenance('A', now, now + DAY + 100);
    assert.equal((await h.Db.getMaintenanceState('A')).lastCompletedAt, now + 50);
    assert.equal(await h.Db.claimMaintenance('B', now), true);
    let current = true;
    h.gate((sql) => sql.startsWith('INSERT INTO podcast_maintenance'), async () => { current = false; });
    await assert.rejects(h.Db.claimMaintenance('A', now + 2 * DAY, () => current), /scope changed/);
    assert.equal((await h.Db.getMaintenanceState('A')).lastStartedAt, now + DAY);
  } finally { h.close(); }
});

test('art reference cleanup leaves newer pointers and publisher URLs intact, and storage reports reusable pages separately', async () => {
  const h = harness();
  try {
    await h.Db.saveFeedSnapshot('A', channel(), [episode()]);
    assert.deepEqual(plain(await h.Db.listPodcastArtReferences('A')), [{ channelId: 'show', file: channel().artFile }]);
    await h.Db.clearPodcastArtReferences('A', ['file:///already-replaced.jpg']);
    assert.equal((await h.Db.getChannel('A', 'show')).artFile, channel().artFile);
    await h.Db.clearPodcastArtReferences('A', [channel().artFile]);
    assert.equal((await h.Db.getChannel('A', 'show')).artFile, undefined);
    assert.equal((await h.Db.getChannel('A', 'show')).imageUrl, channel().imageUrl);
    await h.Db.saveDownload('A', episode(), 'file:///manual.mp3', 40);
    await h.Db.saveDownload('A', episode('show/auto'), 'file:///auto.mp3', 20, () => true, true);
    const stats = await h.Db.podcastStorageStats('A');
    assert.equal(stats.downloadsBytes, 60); assert.equal(stats.manualDownloadsBytes, 40); assert.equal(stats.automaticDownloadsBytes, 20);
    assert.equal(stats.databaseLiveBytes + stats.databaseFreeBytes, stats.databaseAllocatedBytes);
    assert.ok(stats.databaseAllocatedBytes > 0); assert.equal(stats.channelCount, 1); assert.equal(stats.episodeCount, 1);
  } finally { h.close(); }
});

test('explicit catalog compaction releases reusable pages without changing retained business rows', async () => {
  const h = harness();
  try {
    await h.Db.saveFeedSnapshot('A', channel('unused'), Array.from({ length: 350 }, (_, index) =>
      episode(`unused/${index}`, 'unused')));
    await h.Db.saveFeedSnapshot('A', channel('user'), [episode('user/one', 'user')]);
    await h.Db.addChannel('A', 'user');
    await h.Db.saveDownload('A', episode('user/one', 'user'), 'file:///manual.mp3', 42);
    await h.Db.markManyPlayed('A', [{ id: 'user/one', channelId: 'user', durationSec: 300 }], () => true);
    h.setTime(h.time() + 4 * DAY);
    await h.Db.prunePreviewCatalog('A', h.time() - 3 * DAY);
    const before = await h.Db.podcastStorageStats('A'); assert.ok(before.databaseFreeBytes > 0);
    const snapshot = () => ['podcast_channels', 'podcast_episodes', 'podcast_added', 'podcast_favorites', 'podcast_downloads',
      'podcast_progress', 'podcast_auto_download', 'podcast_manual_downloads', 'podcast_access'].map((table) =>
      h.raw().prepare(`SELECT * FROM ${table}`).all().map((row) => JSON.stringify(row)).sort());
    const expected = snapshot();
    await assert.rejects(h.Db.compactPodcastCatalog('A', () => false), /scope changed/);
    assert.deepEqual(snapshot(), expected);
    await h.Db.compactPodcastCatalog('A');
    const after = await h.Db.podcastStorageStats('A');
    assert.ok(after.databaseAllocatedBytes < before.databaseAllocatedBytes);
    assert.equal(after.databaseFreeBytes, 0); assert.deepEqual(snapshot(), expected);
  } finally { h.close(); }
});
