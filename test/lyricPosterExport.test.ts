import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

const h = { files: new Map<string, Uint8Array>(), failCopy: false, events: [] as string[] };
Object.assign(globalThis, { __lyricPosterFs: h });
const stub = `
  export const Paths = { cache: 'file:///cache' };
  export class Directory { constructor(...parts) { this.uri = parts.map(x => x.uri ?? x).join('/') } create() {}
    list() { return [...globalThis.__lyricPosterFs.files.keys()].filter(uri => uri.startsWith(this.uri+'/')).map(uri => new File(uri)) }
  }
  export class File {
    constructor(...parts) { this.uri = parts.map(x => x.uri ?? x).join('/') }
    get name() { return this.uri.split('/').pop() }
    get exists() { return globalThis.__lyricPosterFs.files.has(this.uri) }
    get size() { return globalThis.__lyricPosterFs.files.get(this.uri)?.length ?? 0 }
    open() { const uri = this.uri; return { readBytes: n => globalThis.__lyricPosterFs.files.get(uri).slice(0,n), close: () => globalThis.__lyricPosterFs.events.push('close') } }
    copy(target) {
      const h = globalThis.__lyricPosterFs; h.files.set(target.uri,h.files.get(this.uri).slice());
      if (h.failCopy) throw new Error('copy failed'); h.events.push('copy');
    }
    delete() { globalThis.__lyricPosterFs.files.delete(this.uri); globalThis.__lyricPosterFs.events.push('delete:'+this.uri) }
  }
`;
const hook = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'expo-file-system' ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { materializeLyricPoster } = await import('@/lib/lyricPosterExport');
hook.deregister();
beforeEach(() => { h.files.clear(); h.failCopy = false; h.events.length = 0; });
const png = () => {
  const bytes = new Uint8Array(256);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0); bytes.set([73, 72, 68, 82], 12);
  const v = new DataView(bytes.buffer); v.setUint32(16,1080); v.setUint32(20,1620); return bytes;
};

test('actual materializer checks a PNG and copies it to a distinct share cache file', async () => {
  h.files.set('file:///capture.png', png());
  const result = await materializeLyricPoster('file:///capture.png');
  assert.match(result.uri,/^file:\/\/\/cache\/lyric-posters\/lyrics-\d+-[a-z0-9]+\.png$/);
  assert.deepEqual(h.files.get(result.uri), h.files.get('file:///capture.png'));
  assert.deepEqual(h.events, ['close','copy']);
  result.discard(); assert.equal(h.files.has(result.uri),false);
  assert.equal(h.files.has('file:///capture.png'),true,'only its own derived file is discarded');
});

test('invalid capture data/URLs are not copied and partial copies are cleaned up', async () => {
  await assert.rejects(materializeLyricPoster('https://server/cover?token=secret'),/Invalid/);
  h.files.set('file:///capture.png',new Uint8Array(256));
  await assert.rejects(materializeLyricPoster('file:///capture.png'),/Invalid poster image/);
  assert.deepEqual(h.events,['close']);
  h.events.length=0; h.files.set('file:///capture.png',png()); h.failCopy=true;
  await assert.rejects(materializeLyricPoster('file:///capture.png'),/copy failed/);
  assert.equal(h.files.size,1);
  assert.match(h.events.at(-1)!,/^delete:file:\/\/\/cache\/lyric-posters\//);
});

test('cache cleanup is bounded to old generated posters and never removes a recently shared file', async () => {
  const base = 'file:///cache/lyric-posters/';
  const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
  for (let i=0; i<12; i++) h.files.set(`${base}lyrics-${old+i}-aaaaaa.png`,png());
  const recent = `${base}lyrics-${Date.now()-10_000}-bbbbbb.png`;
  h.files.set(recent,png()); h.files.set(base+'user.png',png()); h.files.set('file:///capture.png',png());
  const result = await materializeLyricPoster('file:///capture.png');
  assert.equal(h.events.filter((event) => event.startsWith('delete:')).length,8);
  assert.equal(h.files.has(recent),true);
  assert.equal(h.files.has(base+'user.png'),true);
  assert.equal(h.files.has(result.uri),true);
});
