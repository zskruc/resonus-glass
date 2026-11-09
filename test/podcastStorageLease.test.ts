import assert from 'node:assert/strict';
import { test } from 'node:test';
import { podcastStorageLeaseVersion, protectPodcastStorageChannel, protectedPodcastStorageChannels } from '../src/lib/podcastStorageLease';

test('storage protection is profile-scoped, reference-counted and idempotently released', () => {
  const a = protectPodcastStorageChannel('accountA', 'show'), second = protectPodcastStorageChannel('accountA', 'show');
  const b = protectPodcastStorageChannel('accountB', 'other');
  try {
    assert.deepEqual([...protectedPodcastStorageChannels('accountA')], ['show']);
    assert.deepEqual([...protectedPodcastStorageChannels('accountB')], ['other']);
    const copy = protectedPodcastStorageChannels('accountA'); copy.clear();
    assert.equal(protectedPodcastStorageChannels('accountA').has('show'), true);
    a(); a(); assert.equal(protectedPodcastStorageChannels('accountA').has('show'), true);
    second(); assert.equal(protectedPodcastStorageChannels('accountA').size, 0);
    assert.equal(protectedPodcastStorageChannels('accountB').has('other'), true);
  } finally { a(); second(); b(); }
});

test('an acquire-release round trip invalidates a previous maintenance generation', () => {
  const before = podcastStorageLeaseVersion('round-trip'), release = protectPodcastStorageChannel('round-trip', 'show');
  assert.notEqual(podcastStorageLeaseVersion('round-trip'), before);
  release(); const after = podcastStorageLeaseVersion('round-trip');
  assert.notEqual(after, before);
  assert.equal(protectedPodcastStorageChannels('round-trip').size, 0);
  release(); assert.equal(podcastStorageLeaseVersion('round-trip'), after);
});
