import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function harness() {
  let now = 1000;
  let listener!: (state: string) => void;
  const app = { currentState: 'background', addEventListener: (_name: string, callback: typeof listener) => { listener = callback; return { remove() {} }; } }, exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/perfLog.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Date: { now: () => now }, __DEV__: false,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, performance: { now: () => now },
    require: (name: string) => { assert.equal(name, 'react-native'); return { AppState: app }; } });
  return { api: exports, advance: (ms: number) => { now += ms; }, foreground: () => { app.currentState = 'active'; listener('active'); } };
}

test('adaptive background beats and the first slower policy transition never report normal5s as a stall', () => {
  const h = harness(); h.api.beat(true, 500);
  for (let i = 0; i < 5; i++) { h.advance(5000); h.api.beat(true, 5000); }
  assert.equal(h.api.perfAway().length, 0);
  h.advance(7000); h.api.beat(true, 5000);
  assert.equal(h.api.perfAway()[0].maxMs, 7000);
});

test('precision-mode gaps still report a missed500ms heartbeat and pauses do not create false stalls', () => {
  const h = harness(); h.api.beat(true, 500); h.advance(2100); h.api.beat(true, 500);
  assert.equal(h.api.perfAway()[0].maxMs, 2100);
  h.api.beat(false, 500); h.advance(60_000); h.api.beat(false, 500);
  assert.equal(h.api.perfAway()[0].count, 1);
});

test('a quick foreground return before the first slower beat respects the requested background interval', () => {
  const h = harness(); h.api.beat(true, 500); h.api.setExpectedPlaybackBeatInterval(5000); h.advance(3000);
  h.api.setExpectedPlaybackBeatInterval(500); h.foreground();
  assert.equal(h.api.perfAway().length, 0);
});
