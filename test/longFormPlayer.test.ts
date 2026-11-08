import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import { AudiobookProgressTracker } from '../src/lib/audiobookTracking';
import { isAudiobookSong } from '../src/lib/audiobook';
import type { Song } from '../src/api/subsonic';
import { DEFAULT_PODCAST_PLAYBACK, podcastStartPosition, podcastOutroReached } from '../src/lib/podcastPlaybackPolicy';

// Run production source installation and long-form adapters. Native audio,
// database IO and app-state delivery are explicit controlled boundaries.
const text = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', text, ts.ScriptTarget.Latest, true);
const functions = new Set(['loadIndexSource', 'sourceFor', 'currentSong', 'flushPodcastSample', 'beginLongFormTrack',
  'parkLongFormSource', 'currentAudiobookSample', 'observeLongFormState', 'initAudiobookProgressTracking', 'clearFinishedAudiobookProgress']);
const variables = new Set(['longFormOwner', 'resumeSeekGeneration', 'longFormInitialized', 'lastPodcastSample', 'audiobookTracker']);
const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && functions.has(node.name?.text ?? '')
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => variables.has(declaration.name.getText(ast))))
  .map((node) => node.getText(ast)).join('\n');
let seek = '', play = '';
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && ts.isArrowFunction(node.initializer)) {
    if (node.name.getText(ast) === 'seekTo') seek = node.initializer.getText(ast);
    if (node.name.getText(ast) === 'playQueue') play = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(seek && play);
const executable = ts.transpileModule(`${declarations}\nexports.load=loadIndexSource; exports.play=${play}; exports.init=initAudiobookProgressTracking; exports.complete=clearFinishedAudiobookProgress; exports.seek=${seek};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const episode: Song = { id: 'ep', title: 'Episode', albumId: 'show', duration: 200, url: 'https://episode', vod: true, podcastChannelId: 'show' };
  const store = createStore<any>(() => ({ queue: [episode], index: 0, positionSec: 0, durationSec: 200, isPlaying: false, sourceHref: '/podcast/show' }));
  let scope = 'A', version = 0, resolve!: (position: number) => void, appEvent!: (state: string) => void, sourceThrows = false;
  const resumes = new Promise<number>((done) => { resolve = done; });
  const seeks: number[] = [], writes: { song: string; position: number; force: boolean }[] = [], sources: string[] = [], books: unknown[][] = [], cleared: unknown[][] = [];
  const auth = {}, noop = () => {};
  const native = { play: noop, volume: 1, audioSessionId: 1 };
  const settings = { saveAudiobookProgress: true }, podcastPreferences = { ...DEFAULT_PODCAST_PLAYBACK };
  const context: Record<string, any> = { exports: {}, AudiobookProgressTracker,
    profileScopeId: () => scope, audiobookProfileScope: () => `book:${scope}`,
    usePlayerStore: store, useSettings: { getState: () => settings, subscribe: noop },
    useAuthStore: { getState: () => ({ auth, offline: false }), subscribe: noop },
    useAlbumProgress: { getState: () => ({ remember: (...args: unknown[]) => books.push(args), clearAlbum: (...args: unknown[]) => cleared.push(args), flush: async () => {}, hydrate: async () => {} }) },
    queryClient: { getQueryData: () => ({ songs: store.getState().queue }) },
    isAudiobookTrack: isAudiobookSong, podcastProgressVersion: () => version,
    ownsPodcastProgress: (_song: Song, owner: string, epoch: number) => scope === owner && version === epoch,
    readPodcastResume: () => resumes,
    usePodcastPreferences: { getState: () => ({ load: async () => {} }) },
    getPodcastPreferences: () => podcastPreferences, podcastStartPosition, podcastOutroReached, podcastOutroLoad: -1,
    writePodcastProgress: async (song: Song, position: number, _duration: number, owner: string, epoch: number, force = false) => {
      if (scope === owner && version === epoch) writes.push({ song: song.id, position, force });
    },
    podcastFile: () => 'file:///episode.mp3', AppState: { addEventListener: (_name: string, listener: (state: string) => void) => { appEvent = listener; return { remove: noop }; } },
    loadToken: 0, endBootQuiet: noop, cutCrossfade: noop, pendingSeek: null, setStreamOffset: noop,
    sourceHasLength: null, scrobbledThisTrack: false, consumeQueuedOnIndexChange: noop, remoteKind: () => null,
    ensureAudioMode: async () => {}, localSourceFor: () => 'file:///book.mp3', ensurePlayer: () => native, activePlayer: () => native, activeIdx: 0,
    useEqualizer: { getState: () => ({ attach: noop }) }, replaceSource: (_player: unknown, source: { uri: string }) => {
      if (sourceThrows) throw new Error('native source rejected'); sources.push(source.uri);
    },
    itemMetadataFor: () => ({}), applyLoop: noop, effectiveVolume: () => 1, applySpeed: noop,
    applyLockScreen: noop, onTrackChanged: noop, bootQuiet: true,
    seekActive: (position: number) => { seeks.push(position); store.setState({ positionSec: position }); },
    silenceLoopManaged: () => false, silenceTailManaged: () => false, silenceSession: { manualSeek: noop },
    cancelPlaybackRecovery: noop, reportState: noop, get: store.getState, set: store.setState,
    bump: noop, note: noop, errorTag: String, tg: String, useToast: { getState: () => ({ show: noop }) },
    attachAppState: noop, streamWarming: { beginQueue: () => ({}), release: () => false, owns: () => true },
    useLastPlayed: { getState: () => ({ touch: noop }) }, forgetHistoryOf: noop, contextKey: () => null,
    pushHistory: noop, dealt: (songs: Song[]) => songs, dealPlayerSongs: (songs: Song[]) => songs, autoplayFetchedFor: null, autoplayRound: null, artistFill: null,
    queueOrigin: null, warmUpcoming: noop, playableOffline: () => true,
  };
  runInNewContext(executable, context); context.loadIndex = context.exports.load; context.exports.init();
  return { store, episode, seeks, writes, sources, books, cleared, podcastPreferences, complete: () => context.exports.complete(),
    play: (songs: Song[]) => context.exports.play(songs, 0, 'Book', '/album/book') as Promise<boolean>,
    load: () => context.exports.load(0, true) as Promise<boolean>, resolve: async (position: number) => {
      resolve(position); for (let i = 0; i < 8; i++) await Promise.resolve();
    }, seek: (position: number) => context.exports.seek(position), background: () => appEvent('background'),
    profile: () => { scope = 'B'; }, mark: () => { version++; }, failSource: () => { sourceThrows = true; } };
}

test('an episode uses its offline file and does not overwrite a saved resume with initial zero ticks', async () => {
  const h = harness(); assert.equal(await h.load(), true);
  assert.deepEqual(h.sources, ['file:///episode.mp3']);
  h.store.setState({ positionSec: 1 }); h.background();
  assert.equal(h.writes.length, 0, 'the awaited resume owns initial progress until it settles');
  await h.resolve(35); assert.deepEqual(h.seeks, [35]);
  h.store.setState({ positionSec: 40, isPlaying: false });
  assert.equal(h.writes.at(-1)!.position, 40); assert.equal(h.writes.at(-1)!.force, true);
  assert.equal(h.books.length, 0, 'podcast episodes never enter audiobook progress');
});

test('a failed queue reload of the same chapter never persists its optimistic zero', async () => {
  const h = harness(); const book: Song = { id: 'chapter', title: 'Chapter', albumId: 'book', genre: 'Audiobook', duration: 200 };
  h.store.setState({ queue: [book], sourceHref: '/album/book' }); await h.load(); h.store.setState({ positionSec: 45 });
  const count = h.books.length; h.failSource();
  assert.equal(await h.play([book]), false);
  assert.equal(h.store.getState().positionSec, 45);
  assert.equal(h.books.slice(count).some((entry) => entry[3] === 0), false);
  assert.equal(h.books.at(-1)![3], 45);
});

test('book pause/background/profile handoff use their captured owner, and the final chapter stays cleared', async () => {
  const h = harness(); const book: Song = { id: 'chapter', title: 'Chapter', albumId: 'book', genre: 'Audiobook', duration: 200 };
  h.store.setState({ queue: [book], sourceHref: '/album/book' }); await h.load();
  h.store.setState({ positionSec: 45 }); h.background();
  assert.equal(h.books.at(-1)![0], 'book:A'); assert.equal(h.books.at(-1)![3], 45); assert.equal(h.books.at(-1)![4], true);
  h.store.setState({ positionSec: 51, isPlaying: false }); assert.equal(h.books.at(-1)![3], 51);
  h.complete(); const count = h.books.length;
  h.store.setState({ isPlaying: false }); h.background();
  assert.equal(h.books.length, count, 'terminal saves cannot resurrect the completed book');
  assert.deepEqual(h.cleared, [['book:A', 'book']]);
  h.profile(); h.store.setState({ positionSec: 70, isPlaying: true });
  assert.equal(h.books.some((args) => args[0] === 'book:B'), false, 'an old source cannot save into a newly selected account');
});
test('late episode resume cannot beat a manual seek, account switch, played mark or newer source', async () => {
  for (const reason of ['seek', 'profile', 'mark', 'source']) {
    const h = harness(); await h.load();
    if (reason === 'seek') h.seek(15);
    else if (reason === 'profile') h.profile();
    else if (reason === 'mark') h.mark();
    else { h.store.setState({ queue: [{ ...h.episode, id: 'newer' }] }); await h.load(); }
    await h.resolve(35);
    assert.deepEqual(h.seeks, reason === 'seek' ? [15] : reason === 'source' ? [35] : [], reason);
  }
});
test('failed native source installation neither reads resume nor advances saved progress', async () => {
  const h = harness(); h.failSource(); assert.equal(await h.load(), false);
  await h.resolve(45); assert.deepEqual(h.seeks, []); assert.deepEqual(h.writes, []);
});
test('the installed podcast source starts at its intro only when saved listening progress is earlier', async () => {
  const intro = harness(); intro.podcastPreferences.introSec = 60; await intro.load(); await intro.resolve(0);
  assert.deepEqual(intro.seeks, [60]);
  const resume = harness(); resume.podcastPreferences.introSec = 60; await resume.load(); await resume.resolve(90);
  assert.deepEqual(resume.seeks, [90]);
});
