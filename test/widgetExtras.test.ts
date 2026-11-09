import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { widgetLyricIndex, widgetLyricRows } from '../src/lib/widgetExtras';
test('widget lyrics use milliseconds, publish a bounded line window and do not invent an early lyric', () => {
  const lyrics = { synced: true, lines: [{ value: 'One', start: 1000 }, { value: 'Two', start: 5000 }, { value: 'Three', start: 10000 }, { value: 'Four', start: 15000 }] };
  assert.equal(widgetLyricIndex(lyrics, 0), -1); assert.deepEqual(widgetLyricRows(lyrics, -1), []);
  assert.equal(widgetLyricIndex(lyrics, 5), 1); assert.deepEqual(widgetLyricRows(lyrics, 1), ['One', 'Two', 'Three']);
  assert.equal(widgetLyricIndex(lyrics, 5.4), 1, 'same lyric line yields the same subscription selection');
  assert.deepEqual(widgetLyricRows(lyrics, 3), ['Three', 'Four']);
  assert.equal(widgetLyricIndex({ ...lyrics, synced: false }, 99), 0);
});
test('widget deep links follow both actual app flavours and resolve only this package before publishing an intent', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const configSource = readFileSync(new URL('../app.config.js', import.meta.url), 'utf8');
  function scheme(preview: boolean): string {
    const module = { exports: null as unknown as (input: { config: object }) => { scheme: string } };
    runInNewContext(configSource, { module, process: { env: { RESONUS_GLASS_PREVIEW: preview ? '1' : '0' } } });
    return module.exports({ config }).scheme;
  }
  const native = readFileSync(new URL('../modules/home-widget/android/src/main/java/expo/modules/homewidget/ListeningExtrasWidget.kt', import.meta.url), 'utf8');
  const probe = native.slice(native.indexOf('private fun registeredScheme'), native.indexOf('fun installed('));
  const candidates = [...probe.matchAll(/"(resonus(?:-glass)?)"/g)].map((match) => match[1]);
  assert.equal(candidates[0], scheme(true), 'preview prefers its registered scheme even with both apps installed');
  assert.ok(candidates.includes(scheme(false)), 'normal builds retain their original registered scheme');
  assert.match(probe, /Intent\(Intent\.ACTION_VIEW,/);
  assert.match(probe, /addCategory\(Intent\.CATEGORY_BROWSABLE\)/);
  assert.match(probe, /setPackage\(packageName\)/);
  assert.match(probe, /resolveActivity\(probe, PackageManager\.MATCH_DEFAULT_ONLY\).*activityInfo\?\.packageName == packageName/);
  assert.doesNotMatch(probe, /setComponent|getLaunchIntentForPackage/,'explicit intents cannot validate registered schemes');
  assert.match(native, /registeredScheme\(context\)\?\.let/);
  assert.doesNotMatch(native, /Uri\.Builder\(\)\.scheme\("resonus"\)/);
  assert.match(native, /if \(uri != null\) \{ launch\.action = Intent\.ACTION_VIEW; launch\.data = uri/);
});
