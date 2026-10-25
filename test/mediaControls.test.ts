import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canApplyMediaVolumeDrag, mediaVolumeFraction, mediaVolumeLevel, mediaVolumeOutputKey } from '../src/lib/mediaControls';

test('system volume clamps and quantizes to actual hardware steps, including nonzero minimum', () => {
  assert.equal(mediaVolumeLevel(5.7, 1, 15), 6);
  assert.equal(mediaVolumeLevel(-1, 1, 15), 1);
  assert.equal(mediaVolumeLevel(90, 1, 15), 15);
  assert.equal(mediaVolumeLevel(Number.NaN, 1, 15), 1);
  assert.equal(mediaVolumeLevel(Number.POSITIVE_INFINITY, 0, 150), 0);
});

test('fixed and malformed volume ranges remain finite', () => {
  assert.equal(mediaVolumeLevel(4, 5, 5), 5);
  assert.equal(mediaVolumeFraction(5, 5, 5), 0);
  assert.equal(mediaVolumeFraction(9, 10, 5), 0);
  assert.equal(mediaVolumeFraction(12, 0, Number.NaN), 0);
  assert.equal(mediaVolumeFraction(8, 1, 15), 0.5);
  assert.equal(mediaVolumeFraction(99, 1, 15), 1);
});

test('a local drag cannot be replayed onto a remote renderer or a newly connected headset', () => {
  const phone = mediaVolumeOutputKey(null, null, 'speaker', '');
  const headphones = mediaVolumeOutputKey(null, null, 'bluetooth', 'Headphones');
  const remote = mediaVolumeOutputKey('upnp', 'living-room', 'speaker', '');
  assert.equal(canApplyMediaVolumeDrag(phone, phone), true);
  assert.equal(canApplyMediaVolumeDrag(phone, headphones), false);
  assert.equal(canApplyMediaVolumeDrag(phone, remote), false);
  assert.equal(canApplyMediaVolumeDrag(remote, phone), false);
});

test('remote output keys isolate different renderers and ignore irrelevant local route changes', () => {
  const first = mediaVolumeOutputKey('upnp', 'room1', 'speaker', '');
  const second = mediaVolumeOutputKey('upnp', 'room2', 'speaker', '');
  const jukebox = mediaVolumeOutputKey('jukebox', null, 'speaker', '');
  assert.equal(canApplyMediaVolumeDrag(first, second), false);
  assert.equal(canApplyMediaVolumeDrag(first, jukebox), false);
  assert.equal(first, mediaVolumeOutputKey('upnp', 'room1', 'bluetooth', 'Headphones'));
});


test('same-named local headphones still invalidate a drag when the actual device identity changes', () => {
  const first = mediaVolumeOutputKey(null, null, 'headphones', 'USB Headset', 'device:42');
  const second = mediaVolumeOutputKey(null, null, 'headphones', 'USB Headset', 'device:43');
  assert.equal(canApplyMediaVolumeDrag(first, second), false);
});
