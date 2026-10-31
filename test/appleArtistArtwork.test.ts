import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appleArtworkAssetKey, createAppleArtistArtworkResolver, parseAppleArtistArtwork } from '../src/lib/appleArtistArtwork';

const XU = '11cd50c0-a7d3-11ce-4357-a90ad6a2d170';
const DAO = '2937318e-d25e-eb77-2665-8f48f00a843d';
const photo = (asset = XU, rendition = '1080x1080bb.jpg') =>
  `https://is1-ssl.mzstatic.com/image/thumb/Features211/v4/11/cd/50/${asset}/portrait.jpg/${rendition}`;
const template = (asset = XU) => photo(asset, '{w}x{h}{c}.{f}');
function header(id = '601736777', asset = XU, color = 'd6dbd7') {
  const art = { dictionary: { bgColor: color, width: 1080, height: 1080, url: template(asset),
    recommendedCropCodes: ['va', 'vb', 'vn'] }, cropStyle: 'sr' };
  return { id, title: '许嵩', contentDescriptor: { kind: 'artist', identifiers: { storeAdamID: id } },
    artwork: art, colorBackdropArtwork: art, wideArtwork: null as unknown };
}
function html(item = header()) {
  return `<html><script type="application/json" id="serialized-server-data">${JSON.stringify({ data: [{ data: { sections: [
    { id: 'ArtistDetailHeader', items: [item] },
    { id: 'albums', items: [{ artwork: { dictionary: { bgColor: 'ff0000', url: template() } } }] },
  ] } }] })}</script></html>`;
}
const search = (ids = [601736777]) => JSON.stringify({ results: ids.map((id) => ({ wrapperType: 'artist', artistType: 'Artist', artistId: id })) });
const response = (body: string, status = 200) => new Response(body, { status, headers: { 'content-length': String(body.length) } });

describe('verified public Apple artist artwork parsing', () => {
  it('identifies the same Apple asset across resize/crop filenames, not across hosts or images', () => {
    assert.equal(appleArtworkAssetKey(photo()), XU);
    assert.equal(appleArtworkAssetKey(photo(XU, '600x900sr.webp?l=zh-Hans')), XU);
    assert.equal(appleArtworkAssetKey(`cached-cover:${photo()}`), XU);
    assert.equal(appleArtworkAssetKey(photo(DAO)), DAO);
    for (const uri of [photo().replace('https:', 'http:'), photo().replace('mzstatic.com', 'mzstatic.com.attacker.test'),
      `https://my-music.example/image/${XU}/custom.jpg`, `file:///cache/${XU}.jpg`, 'content://artist/123',
      `https://user:secret@is1-ssl.mzstatic.com/image/${XU}/photo.jpg`]) {
      assert.equal(appleArtworkAssetKey(uri), null);
    }
  });

  it('returns raw metadata only for the verified header and current photograph', () => {
    const result = parseAppleArtistArtwork(html(), '601736777', photo(XU, '480x600bb.png'));
    assert.equal(result?.backgroundColor, '#d6dbd7');
    assert.equal(result?.assetKey, XU);
    assert.equal(result?.cropStyle, 'sr');
    assert.deepEqual(result?.recommendedCropCodes, ['va', 'vb', 'vn']);
    assert.equal(result?.heroUrl.includes('{'), false);
    assert.ok(result?.heroUrl.endsWith('/1080x1080sr.jpg'));
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result?.recommendedCropCodes));
    assert.equal(parseAppleArtistArtwork(html(), '601736777', photo(DAO)), null);
    assert.equal(parseAppleArtistArtwork(html(), '713446908', photo()), null);
  });

  it('recognizes the second real metadata color and reports wide crop without inventing focal coordinates', () => {
    const item = header('713446908', DAO, '374153');
    item.wideArtwork = { dictionary: item.artwork.dictionary, cropStyle: 'vf' };
    const result = parseAppleArtistArtwork(html(item), '713446908', photo(DAO));
    assert.equal(result?.backgroundColor, '#374153');
    assert.equal(result?.cropStyle, 'sr');
    assert.equal(result?.wideCropStyle, 'vf');
    assert.equal(Object.hasOwn(result!, 'focalPoint'), false);
  });

  it('can use the matching normal artwork when a backdrop dictionary belongs to another photo', () => {
    const item = header();
    item.colorBackdropArtwork = { ...item.colorBackdropArtwork, dictionary: { ...item.artwork.dictionary, url: template(DAO), bgColor: '374153' } };
    assert.equal(parseAppleArtistArtwork(html(item), '601736777', photo())?.backgroundColor, '#d6dbd7');
  });

  it('reads only the verified artist header’s official name artwork and preserves its texture-ready PNG', () => {
    const asset = '6d67888b-9e7f-53af-7853-0f91d6fd2332';
    const item = { ...header('159260351', asset, '070706'), title: 'Taylor Swift', artistLogo: {
      dictionary: { width: 4826, height: 1264,
        url: 'https://is1-ssl.mzstatic.com/image/thumb/lPXHgVOK2LRp_AkQZj_K8A/{w}x{h}{c}.{f}' }, cropStyle: 'bb',
    } };
    const result = parseAppleArtistArtwork(html(item), '159260351', photo(asset));
    assert.deepEqual(result?.nameArtwork, { width: 4826, height: 1264,
      uri: 'https://is1-ssl.mzstatic.com/image/thumb/lPXHgVOK2LRp_AkQZj_K8A/1000x262bb.png' });
    assert.ok(Object.isFrozen(result?.nameArtwork));
    assert.equal(parseAppleArtistArtwork(html(item), '137938148', photo(asset)), null);
    assert.equal(parseAppleArtistArtwork(html(item), '159260351', photo(DAO)), null, 'name art cannot weaken current-photo identity validation');
  });

  it('keeps ordinary text when artistLogo is absent, malformed or belongs only to unrelated content', () => {
    assert.equal(parseAppleArtistArtwork(html(), '601736777', photo())?.nameArtwork, undefined);
    for (const artistLogo of [null, { dictionary: { width: 0, height: 20, url: 'https://is1.mzstatic.com/title.png' } },
      { dictionary: { width: 400, height: 100, url: 'https://mzstatic.com.attacker.test/title.png' } },
      { dictionary: { width: 400, height: 100, url: 'https://user:secret@is1.mzstatic.com/title.png' } }]) {
      const item = { ...header(), artistLogo, albumLogo: { dictionary: { width: 400, height: 100, url: 'https://is1.mzstatic.com/album-title.png' } } };
      const result = parseAppleArtistArtwork(html(item), '601736777', photo());
      assert.equal(result?.nameArtwork, undefined);
      assert.equal(result?.backgroundColor, '#d6dbd7', 'a bad optional logo cannot break the verified photo metadata');
    }
  });

  it('rejects malformed/oversized HTML, invalid color, header mismatch, and non-Apple artwork', () => {
    assert.equal(parseAppleArtistArtwork('<script id="serialized-server-data">alert(1)</script>', '601736777', photo()), null);
    assert.equal(parseAppleArtistArtwork('x'.repeat(1_000_001), '601736777', photo()), null);
    assert.equal(parseAppleArtistArtwork(html(header('601736777', XU, 'red')), '601736777', photo()), null);
    const invalid = header(); invalid.contentDescriptor.kind = 'album';
    assert.equal(parseAppleArtistArtwork(html(invalid), '601736777', photo()), null);
    const foreign = header(); foreign.artwork.dictionary.url = template().replace('mzstatic.com', 'example.test');
    assert.equal(parseAppleArtistArtwork(html(foreign), '601736777', photo()), null);
  });
});

describe('optional Apple artist metadata networking', () => {
  it('accepts opaque proxy photos only after content verification and binds cache to the fingerprint', async () => {
    const fingerprint = '102030'.repeat(256);
    const checked: { uri: string; assetKey: string; width: number; height: number }[] = [];
    const resolver = createAppleArtistArtworkResolver({ fetch: async (url) => response(url.includes('itunes.apple.com') ? search() : html()) });
    const result = await resolver.resolve('https://music.example/share/img/opaque?size=1200', '许嵩', false, () => true,
      { sourceFingerprint: fingerprint, async verify(candidate, mayContinue) { checked.push(candidate); return mayContinue(); } });
    assert.equal(result?.artistId, '601736777');
    assert.equal(checked.length, 1); assert.equal(checked[0].assetKey, XU);
    assert.equal(Math.max(checked[0].width, checked[0].height), 600);
    assert.ok(checked[0].uri.endsWith('/600x600bb.jpg'));
    assert.equal(resolver.peek('https://music.example/share/img/another-token', '许嵩', fingerprint), result);
    assert.equal(resolver.peek('https://music.example/share/img/opaque', '许嵩', '203040'.repeat(256)), null);
    assert.equal(resolver.peek('https://music.example/share/img/opaque', '许嵩'), null);
  });

  it('never turns an exact name into identity and checks no more than three official photos', async () => {
    let verified = 0;
    const resolver = createAppleArtistArtworkResolver({ fetch: async (url) => {
      if (url.includes('itunes.apple.com')) return response(search([1, 2, 3, 4, 5]));
      return response(html(header(url.split('/').pop()!, XU)));
    } });
    const result = await resolver.resolve('https://proxy.example/image', 'same name', false, () => true,
      { sourceFingerprint: '102030'.repeat(256), async verify() { verified++; return false; } });
    assert.equal(result, null); assert.equal(verified, 3);
  });

  it('does not verify or fetch opaque candidates offline and cancels a verifier’s budget gate on timeout', async () => {
    const fingerprint = '102030'.repeat(256);
    let requests = 0; let comparisons = 0; let gate: (() => boolean) | undefined;
    const resolver = createAppleArtistArtworkResolver({ timeoutMs: 8, fetch: async (url) => {
      requests++; return response(url.includes('itunes.apple.com') ? search() : html());
    } });
    const verification = { sourceFingerprint: fingerprint, async verify(_candidate: unknown, mayContinue: () => boolean) {
      comparisons++; gate = mayContinue; return new Promise<boolean>(() => {});
    } };
    assert.equal(await resolver.resolve('https://proxy.example/image', '许嵩', true, () => true, verification), null);
    assert.equal(requests, 0); assert.equal(comparisons, 0);
    assert.equal(await resolver.resolve('https://proxy.example/image', '许嵩', false, () => true, verification), null);
    assert.equal(comparisons, 1); assert.equal(gate?.(), false);
  });

  it('uses no credentials and reads iTunes candidate then public page without authentication', async () => {
    const calls: string[] = [];
    const resolver = createAppleArtistArtworkResolver({ fetch: async (url, options) => {
      calls.push(url);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.method, 'GET');
      assert.equal(new Headers(options.headers).has('authorization'), false);
      return response(url.includes('itunes.apple.com') ? search() : html());
    } });
    assert.equal((await resolver.resolve(photo(), '许嵩'))?.backgroundColor, '#d6dbd7');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('entity=musicArtist&country=CN'));
    assert.equal(calls[1], 'https://music.apple.com/cn/artist/601736777');
    assert.equal(resolver.peek(photo(XU, '90x90sr.jpg'), '许嵩')?.assetKey, XU);
    assert.equal((await resolver.resolve(`cached-cover:${photo()}`, '许嵩', true))?.assetKey, XU);
    assert.equal(calls.length, 2);
  });

  it('does no network for offline/cache-only misses, unknown server images or absent names', async () => {
    let calls = 0;
    const resolver = createAppleArtistArtworkResolver({ fetch: async () => { calls++; throw new Error('forbidden'); } });
    assert.equal(await resolver.resolve(photo(), '许嵩', true), null);
    assert.equal(await resolver.resolve(`cached-cover:${photo()}`, '许嵩'), null);
    assert.equal(await resolver.resolve('https://my-music.example/getCoverArt?id=artist', '许嵩'), null);
    assert.equal(await resolver.resolve(photo(), ''), null);
    assert.equal(calls, 0);
  });

  it('tries at most three candidates and never trusts name/artistLinkUrl as photo verification', async () => {
    const calls: string[] = [];
    const resolver = createAppleArtistArtworkResolver({ fetch: async (url) => {
      calls.push(url);
      if (url.includes('itunes.apple.com')) return response(search([1, 2, 3, 4, 5]));
      return response(html(header(url.split('/').at(-1), DAO)));
    } });
    assert.equal(await resolver.resolve(photo(), '许嵩'), null);
    assert.equal(calls.length, 4);
    assert.equal(calls.at(-1), 'https://music.apple.com/cn/artist/3');
  });

  it('selects an exact asset match from a later candidate rather than a same-name first result', async () => {
    const resolver = createAppleArtistArtworkResolver({ fetch: async (url) => {
      if (url.includes('itunes.apple.com')) return response(search([1, 2]));
      const id = url.split('/').at(-1)!;
      return response(html(header(id, id === '2' ? XU : DAO)));
    } });
    assert.equal((await resolver.resolve(photo(), '许嵩'))?.artistId, '2');
  });

  it('does not refetch duplicate candidate IDs', async () => {
    const pages: string[] = [];
    const resolver = createAppleArtistArtworkResolver({ fetch: async (url) => {
      if (url.includes('itunes.apple.com')) return response(search([1, 1, 2, 2, 3]));
      pages.push(url);
      return response(html(header(url.split('/').at(-1), DAO)));
    } });
    assert.equal(await resolver.resolve(photo(), '许嵩'), null);
    assert.equal(pages.length, 3);
    assert.equal(new Set(pages).size, 3);
  });

  it('rechecks network permission after an await and does not cache a policy cancellation', async () => {
    let online = true;
    let calls = 0;
    const resolver = createAppleArtistArtworkResolver({ fetch: async () => { calls++; online = false; return response(search()); } });
    assert.equal(await resolver.resolve(photo(), '许嵩', false, () => online), null);
    assert.equal(calls, 1);
    assert.equal(resolver.cacheSize, 0);
  });

  it('coalesces online work while an offline consumer cannot join an in-flight network miss', async () => {
    let release: (value: Response) => void = () => {};
    let calls = 0;
    const resolver = createAppleArtistArtworkResolver({ fetch: async (url) => {
      calls++;
      return url.includes('itunes.apple.com') ? await new Promise<Response>((done) => { release = done; }) : response(html());
    } });
    const first = resolver.resolve(photo(), '许嵩');
    const second = resolver.resolve(photo(XU, '32x32sr.jpg'), '许嵩');
    assert.equal(await resolver.resolve(photo(), '许嵩', true), null);
    assert.equal(calls, 1);
    release(response(search()));
    const values = await Promise.all([first, second]);
    assert.equal(values[0], values[1]);
    assert.equal(calls, 2);
    assert.equal(resolver.pendingCount, 0);
  });

  it('bounds concurrent requests and aborts a fetch that never settles without retrying', async () => {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const resolver = createAppleArtistArtworkResolver({ maxPending: 1, timeoutMs: 5, fetch: async (_url, options) => {
      calls++; signal = options.signal as AbortSignal;
      return await new Promise<Response>(() => {});
    } });
    const first = resolver.resolve(photo(), '许嵩');
    assert.equal(await resolver.resolve(photo(), '另一个艺人'), null);
    assert.equal(await first, null);
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, true);
    assert.equal(resolver.pendingCount, 0);
  });

  it('keeps an LRU bound and expiration, with short-lived negative matches', async () => {
    let time = 0;
    let calls = 0;
    const resolver = createAppleArtistArtworkResolver({ capacity: 2, now: () => time, fetch: async (url) => {
      calls++; return response(url.includes('itunes.apple.com') ? search() : html());
    } });
    await resolver.resolve(photo(), 'one');
    await resolver.resolve(photo(), 'two');
    resolver.peek(photo(), 'one');
    await resolver.resolve(photo(), 'three');
    assert.equal(resolver.cacheSize, 2);
    assert.equal(resolver.peek(photo(), 'two'), null);
    assert.ok(resolver.peek(photo(), 'one'));
    time += 7 * 24 * 60 * 60 * 1000 + 1;
    assert.equal(await resolver.resolve(photo(), 'one', true), null);
    assert.equal(calls, 6);
    const missing = createAppleArtistArtworkResolver({ now: () => time, fetch: async () => { calls++; return response(search([])); } });
    await missing.resolve(photo(), 'none'); await missing.resolve(photo(), 'none');
    assert.equal(calls, 7);
    time += 5 * 60 * 1000 + 1;
    await missing.resolve(photo(), 'none');
    assert.equal(calls, 8);
  });

  it('rejects HTTP errors, redirected content and oversized declared bodies without retries', async () => {
    for (const type of ['status', 'redirect', 'length']) {
      let calls = 0;
      const resolver = createAppleArtistArtworkResolver({ fetch: async () => {
        calls++;
        const result = response(search(), type === 'status' ? 503 : 200);
        if (type === 'redirect') Object.defineProperty(result, 'url', { value: 'https://example.test/not-apple' });
        if (type === 'length') result.headers.set('content-length', '1000001');
        return result;
      } });
      assert.equal(await resolver.resolve(photo(), '许嵩'), null);
      assert.equal(calls, 1);
    }
  });
});
