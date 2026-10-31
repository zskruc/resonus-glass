import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectArtistPortrait } from '../src/lib/artistPortrait';

const full = 'https://server.test/art/ar-hash?size=1200';
const small = 'https://images.test/signed?size=300';
const native = { serverType: 'navidrome', coverArt: 'ar-hash', serverUri: full };

test('late Navidrome artistInfo cannot replace the selected full native hero with its smaller largeImageUrl', () => {
  const first = selectArtistPortrait(native);
  const later = selectArtistPortrait({ ...native, infoUri: small });
  assert.equal(first.uri, full); assert.equal(later.uri, full);
  assert.equal(later.preferredUri, full); assert.equal(later.fallbackUri, small);
});

test('a verified managed full hero is stable before metadata, with a real full network fallback if it disappears', () => {
  const verifiedFullUri = 'file:///managed/full.jpg';
  for (const infoUri of [undefined, small, verifiedFullUri]) {
    const source = { ...native, verifiedFullUri, infoUri };
    assert.equal(selectArtistPortrait(source).uri, verifiedFullUri);
    assert.equal(selectArtistPortrait({ ...source, failedUri: verifiedFullUri }).uri, full);
  }
  assert.equal(selectArtistPortrait({ ...native, verifiedFullUri: small }).uri, full,
    'an unverified remote string is not a local full-quality cache entry');
});

test('failed native art falls back to the external portrait and absent native artwork keeps external providers', () => {
  assert.equal(selectArtistPortrait({ ...native, infoUri: small, failedUri: full }).uri, small);
  for (const serverType of ['jellyfin', 'subsonic', undefined]) {
    const source = { serverType, coverArt: 'some-cover', serverUri: full, infoUri: small };
    assert.equal(selectArtistPortrait(source).uri, small);
    assert.equal(selectArtistPortrait({ ...source, failedUri: small }).uri, full);
  }
  assert.equal(selectArtistPortrait({ ...native, coverArt: undefined, infoUri: small }).uri, small);
  assert.equal(selectArtistPortrait({ ...native, coverArt: 'https://external.test/art', infoUri: small }).uri, small);
  assert.equal(selectArtistPortrait({ serverType: 'navidrome' }).uri, undefined);
});

test('a failed primary remains remembered when optional metadata and its fallback arrive later', () => {
  assert.equal(selectArtistPortrait({ ...native, failedUri: full }).uri, undefined);
  assert.equal(selectArtistPortrait({ ...native, failedUri: full, infoUri: small }).uri, small);
});

test('offline source selection keeps a verified full file first, then locally available portraits', () => {
  const cached = 'cached-cover:' + full;
  const localInfo = 'file:///downloads/artist.jpg';
  const localServer = 'file:///mirror/artist.jpg';
  assert.equal(selectArtistPortrait({ ...native, serverUri: cached, infoUri: localInfo, offline: true }).uri, localInfo);
  assert.equal(selectArtistPortrait({ ...native, serverUri: localServer, infoUri: small, offline: true }).uri, localServer);
  assert.equal(selectArtistPortrait({ ...native, serverUri: cached, offline: true }).uri, cached);
  assert.equal(selectArtistPortrait({ ...native, serverUri: localServer, infoUri: localInfo,
    verifiedFullUri: 'file:///managed/full.jpg', offline: true }).uri, 'file:///managed/full.jpg');
});
