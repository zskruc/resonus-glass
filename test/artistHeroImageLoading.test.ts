import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artistHeroRenderer } from './helpers/artistHeroRenderer';

const photo = { uri: 'https://example.com/full.jpg?size=1200', sourceUri: 'file:///cached/200.jpg',
  textureUri: 'file:///prepared/240.png', width: 411, height: 411, extensionHeight: 144, imageStyle: {} };

test('mounts sharp and field concurrently and reveals the complete composite in either completion order', () => {
  for (const first of ['sharp', 'field'] as const) {
    const h = artistHeroRenderer(); const readiness: boolean[] = []; const displayed: string[] = [];
    const props = { ...photo, fieldTransition: 160, sharpTransition: 120,
      onReadyChange: (ready: boolean) => readiness.push(ready), onLayerDisplay: (layer: string) => displayed.push(layer) };
    let tree = h.render(props); const layers = h.layers(tree);
    assert.ok(layers.sharp); assert.ok(layers.field, 'field decoding must not wait for sharp.onDisplay and another React commit');
    assert.equal(layers.sharp.props.transition, 0); assert.equal(layers.field.props.transition, 0);
    assert.equal(tree.props.style.opacity, 0); assert.deepEqual(readiness, [false]);
    layers[first]!.props.onDisplay(); tree = h.render(props);
    assert.equal(tree.props.style.opacity, 0, 'one completed decoder cannot reveal half of the scene');
    assert.deepEqual(displayed, [first], 'hidden navigation copies still need native completion callbacks');
    layers[first === 'sharp' ? 'field' : 'sharp']!.props.onDisplay(); tree = h.render(props);
    assert.equal(tree.props.style.opacity, 1); assert.deepEqual(readiness, [false, true]);
    h.render(props); assert.deepEqual(readiness, [false, true]); h.unmount();
  }
});

test('waits for field preparation without replacing the logical full-size photo with processing thumbnails', () => {
  const h = artistHeroRenderer(); const readiness: boolean[] = [];
  const notify = (ready: boolean) => readiness.push(ready);
  const pending = { ...photo, prepared: false, sourceUri: undefined, textureUri: undefined, onReadyChange: notify };
  let tree = h.render(pending); const original = h.layers(tree).sharp!;
  assert.equal(original.props.source.uri, photo.uri); assert.equal(original.props.cachePolicy, 'memory-disk');
  assert.equal(original.props.priority, 'high'); original.props.onDisplay(); tree = h.render(pending);
  assert.equal(tree.props.style.opacity, 0, 'sharp decoding cannot bypass unfinished field preparation');
  const props = { ...photo, prepared: true, onReadyChange: notify }; tree = h.render(props);
  assert.equal(h.layers(tree).sharp!.props.source.uri, photo.uri, 'a 200px processing file is not the full photograph');
  assert.ok(h.layers(tree).field); assert.equal(tree.props.style.opacity, 0);
  h.layers(tree).field!.props.onDisplay(); tree = h.render(props);
  assert.equal(tree.props.style.opacity, 1); assert.deepEqual(readiness, [false, false, true]);
  h.remount(); tree = h.render(props);
  assert.equal(h.layers(tree).sharp!.props.transition, 0); assert.ok(h.layers(tree).field);
  assert.equal(tree.props.style.opacity, 0, 'a past cache hit does not certify newly mounted native targets'); h.unmount();
});

test('decoded layers wait for preparation and unavailable art settles to the natural page background', () => {
  const h = artistHeroRenderer(); const props = { ...photo, prepared: false };
  let tree = h.settled(props); assert.equal(tree.props.style.opacity, 0);
  tree = h.render({ ...props, prepared: true }); assert.equal(tree.props.style.opacity, 1);
  tree = h.render({ ...props, uri: undefined, sourceUri: undefined, textureUri: undefined, prepared: true });
  assert.equal(tree.props.style.opacity, 1); assert.deepEqual(h.layers(tree), { field: null, sharp: null }); h.unmount();
});

test('retired leases drop both images and reject late callbacks across same-URI reacquisition', () => {
  const h = artistHeroRenderer(); const errors: string[] = []; const readiness: boolean[] = [];
  const props = { ...photo, onLayerError: (layer: string) => errors.push(layer), onReadyChange: (ready: boolean) => readiness.push(ready) };
  const old = h.layers(h.settled(props)); h.lease(false); assert.equal(h.render(props), null);
  const writes = h.writes(); old.sharp!.props.onDisplay(); old.field!.props.onError(); assert.equal(h.writes(), writes);
  h.lease(true); let tree = h.render(props); assert.ok(h.layers(tree).field); assert.equal(tree.props.style.opacity, 0);
  old.sharp!.props.onDisplay(); old.field!.props.onError(); tree = h.render(props);
  assert.equal(tree.props.style.opacity, 0); assert.deepEqual(errors, []);
  h.layers(tree).sharp!.props.onDisplay(); tree = h.render(props); assert.equal(tree.props.style.opacity, 0);
  h.layers(tree).field!.props.onDisplay(); tree = h.render(props); assert.equal(tree.props.style.opacity, 1);
  assert.deepEqual(readiness, [false, true, false, false, true]); h.unmount();
});

test('cache-only views never request remote sharp art and can use a prepared field fallback', () => {
  const h = artistHeroRenderer();
  for (const props of [{ ...photo, cacheOnly: true }, { ...photo, uri: `cached-cover:${photo.uri}` }, { ...photo, uri: undefined }]) {
    assert.equal(h.layers(h.render(props)).sharp!.props.source.uri, photo.sourceUri);
  }
  const props = { ...photo, cacheOnly: true, sourceUri: photo.uri }; let tree = h.render(props);
  assert.equal(h.layers(tree).sharp, null); assert.equal(h.layers(tree).field!.props.source.uri, photo.textureUri);
  assert.equal(tree.props.style.opacity, 0); h.layers(tree).field!.props.onDisplay(); tree = h.render(props);
  assert.equal(tree.props.style.opacity, 1); h.unmount();
});

test('a new photograph request remounts an unchanged field URI to obtain a real decoder completion', () => {
  const h = artistHeroRenderer(); const original = h.layers(h.settled(photo));
  const props = { ...photo, cacheOnly: true }; let tree = h.render(props); const current = h.layers(tree);
  assert.equal(current.field!.props.source.uri, original.field!.props.source.uri);
  assert.notEqual(current.field!.key, original.field!.key,
    'Glide need not emit onDisplay again when an existing target keeps the same URI');
  assert.notEqual(current.sharp!.key, original.sharp!.key);
  original.field!.props.onDisplay(); current.sharp!.props.onDisplay(); tree = h.render(props);
  assert.equal(tree.props.style.opacity, 0);
  current.field!.props.onDisplay(); tree = h.render(props); assert.equal(tree.props.style.opacity, 1); h.unmount();
});

test('remote failure tries the local photograph once and terminal failures settle without deadlock', () => {
  const h = artistHeroRenderer(); const failures: string[] = [];
  const props = { ...photo, onError: () => failures.push('source'), onLayerError: (layer: string) => failures.push(layer) };
  let tree = h.render(props); const original = h.layers(tree);
  original.field!.props.onDisplay(); original.sharp!.props.onError(); tree = h.render(props);
  assert.equal(h.layers(tree).sharp!.props.source.uri, photo.sourceUri); assert.equal(tree.props.style.opacity, 0);
  assert.deepEqual(failures, [], 'a parent fallback must not discard a valid local copy');
  h.layers(tree).sharp!.props.onError(); tree = h.render(props);
  assert.deepEqual(failures, ['source', 'sharp']); assert.equal(tree.props.style.opacity, 1);
  assert.equal(h.layers(tree).field!.props.source.uri, photo.textureUri);
  h.layers(tree).field!.props.onError(); tree = h.render(props);
  assert.equal(tree.props.style.opacity, 1, 'a terminal field error cannot permanently hide the page'); h.unmount();
});

test('field failure reveals a displayed sharp photograph through the same shared gate', () => {
  const h = artistHeroRenderer(); const failures: string[] = [];
  const props = { ...photo, onLayerError: (layer: string) => failures.push(layer) };
  let tree = h.render(props); h.layers(tree).sharp!.props.onDisplay(); tree = h.render(props);
  assert.equal(tree.props.style.opacity, 0); h.layers(tree).field!.props.onError(); tree = h.render(props);
  assert.equal(tree.props.style.opacity, 1); assert.equal(h.layers(tree).sharp!.props.source.uri, photo.uri);
  assert.deepEqual(failures, ['field']); h.unmount();
});

test('late local source recovery waits for its own display while the field remains mounted', () => {
  const h = artistHeroRenderer(); let tree = h.render({ ...photo, prepared: false, sourceUri: undefined, textureUri: undefined });
  h.layers(tree).sharp!.props.onError(); tree = h.render(photo);
  assert.equal(h.layers(tree).sharp!.props.source.uri, photo.sourceUri); assert.ok(h.layers(tree).field);
  h.layers(tree).field!.props.onDisplay(); tree = h.render(photo); assert.equal(tree.props.style.opacity, 0);
  h.layers(tree).sharp!.props.onDisplay(); tree = h.render(photo); assert.equal(tree.props.style.opacity, 1); h.unmount();
});

test('stale events cannot reveal another artist, contaminate A→B→A, or update an unmounted view', () => {
  const h = artistHeroRenderer(true); const events: string[] = [];
  const props = { ...photo, onLayerDisplay: (layer: string) => events.push(layer), onError: () => events.push('error') };
  const first = h.layers(h.render(props));
  const second = h.layers(h.render({ ...props, uri: 'https://example.com/B.jpg', textureUri: 'file:///B.png' }));
  let tree = h.render(props); const writes = h.writes(), logs = h.logs.length;
  for (const previous of [first, second]) {
    previous.sharp!.props.onDisplay(); previous.sharp!.props.onError();
    previous.sharp!.props.onLoad({ source: { width: 200, height: 200 }, cacheType: 'disk' });
    previous.field!.props.onDisplay(); previous.field!.props.onError();
  }
  assert.equal(h.writes(), writes); assert.equal(h.logs.length, logs); assert.deepEqual(events, []);
  assert.equal(tree.props.style.opacity, 0); const current = h.layers(tree);
  current.sharp!.props.onDisplay(); current.field!.props.onDisplay(); tree = h.render(props); assert.equal(tree.props.style.opacity, 1);
  tree = h.render({ ...props, textureUri: 'file:///new-field.png' }); assert.equal(tree.props.style.opacity, 0);
  const latestWrites = h.writes(), latestLogs = h.logs.length;
  current.field!.props.onDisplay(); current.field!.props.onError();
  assert.equal(h.writes(), latestWrites); assert.equal(h.logs.length, latestLogs);
  h.unmount(); current.sharp!.props.onDisplay(); current.sharp!.props.onError(); assert.equal(h.writes(), latestWrites);
});

test('hidden navigation copies report both layers without requiring a visible draw', () => {
  const h = artistHeroRenderer(); const displayed: string[] = [];
  const props = { ...photo, uri: undefined, sharpTransition: 0, fieldTransition: 0,
    onLayerDisplay: (layer: string) => displayed.push(layer) };
  let tree = h.render(props); assert.ok(h.layers(tree).field); assert.equal(tree.props.style.opacity, 0);
  h.layers(tree).field!.props.onDisplay(); tree = h.render(props); assert.equal(tree.props.style.opacity, 0);
  h.layers(tree).sharp!.props.onDisplay(); tree = h.render(props);
  assert.deepEqual(displayed, ['field', 'sharp']); assert.equal(tree.props.style.opacity, 1); h.unmount();
});

test('opt-in diagnostics contain dimensions/cache type without photo URLs or user data', () => {
  const h = artistHeroRenderer(true); const sharp = h.layers(h.render(photo)).sharp!;
  sharp.props.onLoad({ source: { width: 1440, height: 1440 }, cacheType: 'memory' }); sharp.props.onDisplay();
  assert.ok(h.logs.some((line) => line.includes('width=1440 height=1440 cache=memory')));
  assert.ok(h.logs.some((line) => line.includes('sharp displayed')));
  assert.ok(h.logs.every((line) => !line.includes('http') && !line.includes('file:') && !line.includes('example.com'))); h.unmount();
});
