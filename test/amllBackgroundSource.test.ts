import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveArtworkLocalUri } from '../modules/amll-background/artworkSource';

const prefix = 'cached-cover:';

describe('AMLL background local artwork policy', () => {
  it('passes local and content artwork without cache or network work', async () => {
    const forbidden = async (): Promise<never> => { throw new Error('unexpected image-loader access'); };
    const access = { cachePath: forbidden, prefetch: forbidden, allowNetwork: () => false };
    for (const uri of ['file:///cache/cover.jpg', 'content://media/cover/1']) {
      assert.equal(await resolveArtworkLocalUri(uri, prefix, access), uri);
    }
    assert.equal(await resolveArtworkLocalUri('/cache/art', prefix, access), 'file:///cache/art');
  });

  it('looks up marked offline artwork at historic sizes and never downloads a miss', async () => {
    let downloads = 0;
    const access = {
      cachePath: async (key: string) => key.includes('size=300') ? '/cache/older-cover' : null,
      prefetch: async () => { downloads++; return true; },
      allowNetwork: () => true,
    };
    assert.equal(await resolveArtworkLocalUri(`${prefix}https://music/cover?size=1200`, prefix, access),
      'file:///cache/older-cover');
    access.cachePath = async () => null;
    assert.equal(await resolveArtworkLocalUri(`${prefix}https://music/cover`, prefix, access), undefined);
    assert.equal(downloads, 0);
  });

  it('uses Expo disk prefetch only after a miss and looks up the resulting local path', async () => {
    let downloaded = false;
    const events: string[] = [];
    const uri = 'https://music/cover';
    const result = await resolveArtworkLocalUri(uri, prefix, {
      cachePath: async () => { events.push('cache'); return downloaded ? '/cache/new-cover' : null; },
      prefetch: async (key) => { assert.equal(key, uri); events.push('prefetch'); downloaded = true; return true; },
      allowNetwork: () => true,
    });
    assert.equal(result, 'file:///cache/new-cover');
    assert.deepEqual(events, ['cache', 'prefetch', 'cache']);
  });

  it('rechecks offline policy after asynchronous cache lookup', async () => {
    let online = true;
    let downloads = 0;
    assert.equal(await resolveArtworkLocalUri('https://music/cover', prefix, {
      cachePath: async () => { online = false; return null; },
      prefetch: async () => { downloads++; return true; },
      allowNetwork: () => online,
    }), undefined);
    assert.equal(downloads, 0);
  });

  it('rejects network paths returned as cache paths and handles a failed prefetch', async () => {
    assert.equal(await resolveArtworkLocalUri('https://music/cover', prefix, {
      cachePath: async () => 'https://not-a-local-file',
      prefetch: async () => false,
      allowNetwork: () => true,
    }), undefined);
    assert.equal(await resolveArtworkLocalUri('data:artwork', prefix, {
      cachePath: async () => { throw new Error('unexpected cache lookup'); },
      prefetch: async () => { throw new Error('unexpected network'); },
      allowNetwork: () => true,
    }), undefined);
  });
});
