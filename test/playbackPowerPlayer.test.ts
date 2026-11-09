import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['activePlayer', 'definitelyLocalPlayback', 'syncPlaybackPowerPolicy', 'playbackPowerDiagnostics', 'backgroundPlaybackPowerDiagnostics']);
const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? '')
  || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ['lastPowerPolicy', 'lastBackgroundPowerStatus', 'expectedAudioBeatIntervalMs'].includes(item.name.getText(ast))))
  .map((node) => node.getText(ast)).join('\n');
const code = ts.transpileModule(`${declarations}\nexports.sync=syncPlaybackPowerPolicy;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const state: any = { queue: [{ id: 'one' }, { id: 'two' }], index: 0, speed: 1, repeat: 'off', radioMode: false };
  const settings: any = { crossfadeSec: 0, replayGain: 'off', autoplaySimilar: false };
  const app = { currentState: 'active' }, eq = { enabled: false }, silence = { enabled: false }, preferences = { outroSec: 0 };
  const files = new Map([['one', 'file:///one.mp3'], ['two', 'file:///two.mp3']]);
  const calls: any[][][] = [[], []], players = calls.map((events) => ({ setPlaybackPowerPolicy: (...args: any[]) => events.push(args), powerStatus: { wakeMode: 'local' } }));
  const api: any = {};
  const globals: any = { exports: api, players, activeIdx: 0, usePlayerStore: { getState: () => state },
    useSettings: { getState: () => settings }, AppState: app, currentSong: () => state.queue[state.index],
    nextIndex: () => state.index + 1 < state.queue.length ? state.index + 1 : null,
    useAuthStore: { getState: () => ({ offline: false, auth: {} }) },
    localSourceFor: (song: any) => files.get(song.id), podcastFile: (song: any) => files.get(song.id),
    useEqualizer: { getState: () => eq }, useSilenceTrim: { getState: () => silence }, getPodcastPreferences: () => preferences,
    isAudiobookTrack: () => false,
    fadeState: null, pauseFadeTimer: null, sleepFadeTimer: null, remoteKind: () => null };
  globals.setExpectedPlaybackBeatInterval = () => {};
  runInNewContext(code, globals);
  return { api, state, settings, app, eq, silence, preferences, files, calls, globals, players,
    sync: () => api.sync(), last: () => calls[0].at(-1)! };
}

test('the actual player policy keeps foreground precision and avoids repeated native calls for unchanged ticks', () => {
  const h = harness(); h.sync(); assert.deepEqual(h.last(), [false, false, false, false]);
  for (let i = 0; i < 100; i++) { h.state.positionSec = i; h.sync(); }
  assert.deepEqual(h.calls.map((items) => items.length), [1, 1]);
  h.app.currentState = 'background'; h.sync(); assert.deepEqual(h.last(), [true, false, false, false]);
  assert.deepEqual(h.api.backgroundPlaybackPowerDiagnostics(), { wakeMode: 'local' });
  h.app.currentState = 'active'; h.sync(); assert.equal(h.last()[0], false);
});

test('local-to-network, cloud provider, download preference and future mix all retain network protection', () => {
  const h = harness(); h.app.currentState = 'background'; h.sync(); assert.equal(h.last()[3], false);
  h.files.delete('two'); h.sync(); assert.equal(h.last()[3], true, 'a JS-owned next stream is protected before native preload');
  h.files.set('two', 'content://cloud-provider/song'); h.sync(); assert.equal(h.last()[3], true);
  h.files.set('two', 'file:///two.mp3'); h.sync(); assert.equal(h.last()[3], false);
  h.state.index = 1; h.settings.autoplaySimilar = true; h.sync(); assert.equal(h.last()[3], true);
  h.state.repeat = 'one'; h.sync(); assert.equal(h.last()[3], false, 'native local repeat does not need a speculative streamed next');
});

test('chapter, silence, podcast outro, sleep and fade boundaries retain precise native timing', () => {
  const h = harness(); h.app.currentState = 'background';
  for (const change of [() => { h.state.chapterStop = {}; }, () => { h.state.sleepEndsAt = 100; },
    () => { h.silence.enabled = true; }, () => { h.settings.crossfadeSec = 5; },
    () => { h.state.queue[0].podcastChannelId = 'show'; h.preferences.outroSec = 20; },
    () => { h.globals.pauseFadeTimer = 1; }]) {
    change(); h.sync(); assert.equal(h.last()[1], true); assert.equal(h.last()[2], false);
    h.state.chapterStop = null; h.state.sleepEndsAt = null; h.silence.enabled = false; h.settings.crossfadeSec = 0;
    delete h.state.queue[0].podcastChannelId; h.preferences.outroSec = 0; h.globals.pauseFadeTimer = null;
    h.sync(); assert.equal(h.last()[1], false);
  }
});

test('a cached podcast does not retain Wi-Fi for music autoplay that cannot extend it', () => {
  const h = harness(); h.app.currentState = 'background'; h.settings.autoplaySimilar = true;
  h.state.queue = [{ id: 'one', podcastChannelId: 'show', url: 'https://episode', vod: true }];
  h.sync(); assert.equal(h.last()[3], false);
  h.state.queue = [{ id: 'one' }]; h.settings.autoplaySimilar = false; h.state.sourceHref = '/artist/artist-a';
  h.sync(); assert.equal(h.last()[3], true, 'artist catalog continuation still needs network protection');
});

test('compressed offload is opt-in only for a finite single item with compatible processing', () => {
  const h = harness(); h.app.currentState = 'background'; h.state.queue = [h.state.queue[0]];
  h.sync(); assert.equal(h.last()[2], true); assert.equal(h.calls[1].at(-1)![2], false, 'reserve player never opts in');
  for (const change of [() => { h.eq.enabled = true; }, () => { h.state.speed = 1.25; },
    () => { h.settings.replayGain = 'track'; }, () => { h.state.repeat = 'all'; },
    () => { h.state.radioMode = true; }, () => { h.state.queue[0].url = 'https://radio'; }]) {
    change(); h.sync(); assert.equal(h.last()[2], false);
    h.eq.enabled = false; h.state.speed = 1; h.settings.replayGain = 'off'; h.state.repeat = 'off';
    h.state.radioMode = false; delete h.state.queue[0].url; h.sync();
  }
});

test('older or non-Android players without the extension remain usable', () => {
  const h = harness(); h.players[0].setPlaybackPowerPolicy = undefined as any;
  assert.doesNotThrow(h.sync); assert.deepEqual(h.api.playbackPowerDiagnostics(), { wakeMode: 'local' });
});
