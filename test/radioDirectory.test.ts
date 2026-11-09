import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { publicStreamUrl } from '../src/lib/discoveryPreferences';
function harness(fetch: (url: string, init: any) => Promise<unknown>) {
  let offline = false; const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/radioDirectory.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch, require(name: string) { if (name === '@/api/netGate') return { isManualOffline: () => offline }; if (name === '@/lib/discoveryPreferences') return { publicStreamUrl }; throw new Error(name); } });
  return { mod: exports, offline() { offline = true; } };
}
const raw = { stationuuid: '0b613a27-aa1a-11e8-92aa-52543be04c81', name: 'Station', url_resolved: 'https://stream.test/live', homepage: 'https://station.test/', country: 'China', tags: 'news,language', codec: 'MP3', bitrate: 128 };
test('directory query paginates with literal search and country; sanitised identity saves locally without server writes', async () => {
  const calls: string[] = [];
  const h = harness(async (url) => { calls.push(url); return { ok: true, json: async () => [raw, raw, { ...raw, stationuuid: 'bad', url: 'javascript:alert(1)' }] }; });
  const rows = await h.mod.readRadioDirectory({ query: 'Jazz & soul', country: 'CN', offset: 50 });
  assert.equal(calls.length, 1); const url = new URL(calls[0]); assert.equal(url.searchParams.get('name'), 'Jazz & soul'); assert.equal(url.searchParams.get('offset'), '50'); assert.equal(url.searchParams.get('countrycode'), 'CN'); assert.equal(url.searchParams.get('hidebroken'), 'true');
  assert.equal(rows.length, 1); assert.equal(rows[0].id, `localradio:${raw.stationuuid}`); assert.equal(rows[0].streamUrl, raw.url_resolved);
});
test('manual offline never starts discovery; rate limits are not retried and account cancellation never returns late rows', async () => {
  let requests = 0;
  const h = harness(async () => { requests++; return { ok: false, status: 429 }; }); h.offline();
  await assert.rejects(h.mod.readRadioDirectory({}), /Offline/); assert.equal(requests, 0);
  const limited = harness(async () => { requests++; return { ok: false, status: 429 }; });
  await assert.rejects(limited.mod.readRadioDirectory({}), /429/); assert.equal(requests, 1);
  let finish!: (value: unknown) => void;
  const slow = harness(async () => new Promise((resolve) => { finish = resolve; })); const controller = new AbortController();
  const pending = slow.mod.readRadioDirectory({ signal: controller.signal }); controller.abort(); finish({ ok: true, json: async () => [raw] });
  await assert.rejects(pending, /cancelled/);
});
