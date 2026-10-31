import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artistHeroRenderer } from './helpers/artistHeroRenderer';

const photo = { uri: 'https://example.com/full.jpg?size=1200', sourceUri: 'file:///cached/200.jpg',
  textureUri: 'file:///prepared/240.png', width: 411, height: 411, extensionHeight: 144, imageStyle: {} };

test('an online full-size image remains the source when processing files arrive, and the low-resolution field waits for its actual display', () => {
  const h = artistHeroRenderer();
  let tree = h.render({ ...photo, sourceUri: undefined, textureUri: undefined });
  const original = h.layers(tree).sharp!;
  assert.equal(original.props.source.uri, photo.uri);
  assert.equal(original.props.cachePolicy, 'memory-disk');
  assert.equal(original.props.priority, 'high');
  assert.equal(original.props.transition, 120);
  tree = h.render(photo);
  assert.equal(h.layers(tree).sharp!.props.source.uri, photo.uri, 'a 200px processing cache cannot replace the full-size photograph');
  assert.equal(h.layers(tree).field, null, 'a ready 240px field is not presented as the whole photo');
  original.props.onDisplay();
  tree = h.render(photo);
  assert.equal(h.layers(tree).field!.props.source.uri, photo.textureUri);
  assert.equal(h.layers(tree).field!.props.transition, 160);
  assert.equal(h.layers(tree).sharp!.props.transition, 120, 'onDisplay cannot change the current request\'s in-flight fade');
  h.remount();
  tree = h.render(photo);
  assert.equal(h.layers(tree).sharp!.props.transition, 0, 'revisits can use Glide memory without an artificial entry delay');
  assert.equal(h.layers(tree).field, null, 'revisits still wait for actual display, not a guessed cache hit');
});

test('cache-only and offline views never send a remote address to the sharp loader', () => {
  const h = artistHeroRenderer();
  for (const props of [{ ...photo, cacheOnly: true }, { ...photo, uri: `cached-cover:${photo.uri}` }, { ...photo, uri: undefined }]) {
    const tree = h.render(props);
    assert.equal(h.layers(tree).sharp!.props.source.uri, photo.sourceUri);
  }
  const tree = h.render({ ...photo, cacheOnly: true, sourceUri: photo.uri });
  assert.equal(h.layers(tree).sharp, null, 'an unavailable local photograph does not become an offline network request');
  assert.equal(h.layers(tree).field!.props.source.uri, photo.textureUri, 'an offline prepared field remains a safe last resort');
});

test('remote failure tries its local photograph once, and terminal failure can show the field rather than remain blank', () => {
  const h = artistHeroRenderer(); const failures: string[] = [];
  const props = { ...photo, onError: () => failures.push('source'), onLayerError: (layer: string) => failures.push(layer) };
  let tree = h.render(props); h.layers(tree).sharp!.props.onError();
  tree = h.render(props);
  assert.equal(h.layers(tree).sharp!.props.source.uri, photo.sourceUri);
  assert.equal(h.layers(tree).field, null);
  assert.deepEqual(failures, [], 'the parent fallback does not discard a valid same-photo local copy');
  h.layers(tree).sharp!.props.onError(); tree = h.render(props);
  assert.deepEqual(failures, ['source', 'sharp']);
  assert.equal(h.layers(tree).field!.props.source.uri, photo.textureUri);
});

test('field failure leaves a successfully displayed sharp photograph visible', () => {
  const h = artistHeroRenderer(); const failures: string[] = [];
  const props = { ...photo, onLayerError: (layer: string) => failures.push(layer) };
  let tree = h.settled(props); h.layers(tree).field!.props.onError(); tree = h.render(props);
  assert.equal(h.layers(tree).sharp!.props.source.uri, photo.uri);
  assert.deepEqual(failures, ['field']);
});

test('a late local photograph can recover a failed request without waiting for another network attempt', () => {
  const h = artistHeroRenderer();
  let tree = h.render({ ...photo, sourceUri: undefined, textureUri: undefined });
  h.layers(tree).sharp!.props.onError();
  tree = h.render(photo);
  assert.equal(h.layers(tree).sharp!.props.source.uri, photo.sourceUri);
  assert.equal(h.layers(tree).field, null, 'the local recovery still gets its own display barrier');
  h.layers(tree).sharp!.props.onDisplay(); tree = h.render(photo);
  assert.equal(h.layers(tree).field!.props.source.uri, photo.textureUri);
});

test('late display, load and error events cannot reveal another artist, contaminate A→B→A, or update an unmounted view', () => {
  const h = artistHeroRenderer(true); const events: string[] = [];
  const props = { ...photo, onLayerDisplay: (layer: string) => events.push(layer), onError: () => events.push('error') };
  const first = h.layers(h.render(props)).sharp!;
  const secondProps = { ...props, uri: 'https://example.com/B.jpg', textureUri: 'file:///B.png' };
  const second = h.layers(h.render(secondProps)).sharp!;
  let tree = h.render(props);
  const writes = h.writes(), logs = h.logs.length;
  for (const previous of [first, second]) {
    previous.props.onDisplay(); previous.props.onError();
    previous.props.onLoad({ source: { width: 200, height: 200 }, cacheType: 'disk' });
  }
  assert.equal(h.writes(), writes); assert.equal(h.logs.length, logs); assert.deepEqual(events, []);
  assert.equal(h.layers(tree).field, null);
  h.layers(tree).sharp!.props.onDisplay(); tree = h.render(props);
  const field = h.layers(tree).field!, sharp = h.layers(tree).sharp!;
  h.render({ ...props, textureUri: 'file:///new-field.png' });
  const latestWrites = h.writes(), latestLogs = h.logs.length;
  field.props.onDisplay(); field.props.onError();
  assert.equal(h.writes(), latestWrites); assert.equal(h.logs.length, latestLogs);
  h.unmount(); sharp.props.onDisplay(); sharp.props.onError();
  assert.equal(h.writes(), latestWrites);
});

test('the hidden navigation copy can decode sharp then field without a readiness deadlock or an entry fade', () => {
  const h = artistHeroRenderer(); const displayed: string[] = [];
  const props = { ...photo, uri: undefined, sharpTransition: 0, fieldTransition: 0,
    onLayerDisplay: (layer: string) => displayed.push(layer) };
  let tree = h.render(props);
  assert.equal(h.layers(tree).field, null);
  assert.equal(h.layers(tree).sharp!.props.transition, 0);
  h.layers(tree).sharp!.props.onDisplay(); tree = h.render(props);
  h.layers(tree).field!.props.onDisplay();
  assert.deepEqual(displayed, ['sharp', 'field']);
  assert.equal(h.layers(tree).field!.props.transition, 0);
});

test('opt-in image diagnostics contain dimensions and real cache type without photo URLs or user data', () => {
  const h = artistHeroRenderer(true); const tree = h.render(photo);
  const sharp = h.layers(tree).sharp!;
  sharp.props.onLoad({ source: { width: 1440, height: 1440 }, cacheType: 'memory' });
  sharp.props.onDisplay();
  assert.ok(h.logs.some((line) => line.includes('width=1440 height=1440 cache=memory')));
  assert.ok(h.logs.some((line) => line.includes('sharp displayed')));
  assert.ok(h.logs.every((line) => !line.includes('http') && !line.includes('file:') && !line.includes('example.com')));
});
