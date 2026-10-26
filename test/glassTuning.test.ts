import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, describe, it } from 'node:test';

// Exercise the real store with only the device storage boundary replaced.
const storage = {
  items: new Map<string, string>(),
  writes: [] as { key: string; value: string }[],
  failedReads: new Set<string>(),
  failedWrites: new Set<string>(),
  readGate: null as Promise<void> | null,
  writeGate: null as Promise<void> | null,
};
Object.assign(globalThis, { __glassTuningTestStorage: storage, __DEV__: false });
const storageModule = `
  export async function getItem(key) {
    const storage = globalThis.__glassTuningTestStorage;
    const value = storage.items.get(key) ?? null;
    if (storage.readGate) await storage.readGate;
    if (storage.failedReads.has(key)) throw new Error('Read failed');
    return value;
  }
  export async function setItemStrict(key, value) {
    const storage = globalThis.__glassTuningTestStorage;
    storage.writes.push({ key, value });
    if (storage.writeGate) await storage.writeGate;
    if (storage.failedWrites.has(key)) throw new Error('Write failed');
    storage.items.set(key, value);
  }
`;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/storage') {
      return { url: `data:text/javascript,${encodeURIComponent(storageModule)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { useGlassTuning, getGlassProfile, getGlassDefaults, resolveGlassProfile, exportGlassTuning, sanitizeGlassOverrides } = await import('@/store/glassTuning');
const { getKyantGlassProfile } = await import('@/theme/glassDefaults');
hook.deregister();

const PARAMETERS_KEY = 'resonus.glass-tuning.v1';
const MODE_KEY = 'resonus.glass-appearance.v3';
const AM_PLUS_KEY = 'resonus.glass-amplus-tuning.v1';
const saved = {
  schemaVersion: 1,
  overrides: {
    miniPlayer: { refraction: 21, tintColor: '#123456' },
    navigation: { refractionHeight: 19, highlightOpacity: 0.73 },
    controls: { blur: 3, depthEffect: false },
  },
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

beforeEach(async () => {
  storage.items.clear();
  storage.writes = [];
  storage.failedReads.clear();
  storage.failedWrites.clear();
  storage.readGate = null;
  storage.writeGate = null;
  useGlassTuning.setState({ overrides: { miniPlayer: {}, navigation: {}, controls: {} }, amPlusOverrides: { miniPlayer: {}, navigation: {}, controls: {} }, mode: 'amPlus', hydrated: false });
  // Clear any failed-read/retry state from the preceding case.
  await useGlassTuning.getState().hydrate();
  useGlassTuning.setState({ hydrated: false });
});

describe('glass appearance modes and saved custom profiles', () => {
  it('defaults to AM++ when no preview mode was saved and preserves all legacy profiles', async () => {
    const original = JSON.stringify(saved);
    storage.items.set(PARAMETERS_KEY, original);
    await useGlassTuning.getState().hydrate();
    assert.equal(useGlassTuning.getState().mode, 'amPlus');
    assert.deepEqual(useGlassTuning.getState().overrides, saved.overrides);
    assert.equal(getGlassProfile('miniPlayer', false).refraction, 16.125);
    assert.equal(getGlassProfile('navigation', false).refractionHeight, 24);
    assert.equal(storage.items.get(PARAMETERS_KEY), original);
    assert.equal(storage.items.has(MODE_KEY), false);
    assert.deepEqual(storage.writes, []);
  });

  it('restores a saved custom mode and the original values', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    storage.items.set(MODE_KEY, JSON.stringify({ schemaVersion: 1, mode: 'custom' }));
    await useGlassTuning.getState().hydrate();
    assert.equal(useGlassTuning.getState().mode, 'custom');
    assert.equal(getGlassProfile('miniPlayer', true).refraction, 21);
    assert.equal(getGlassProfile('navigation', true).refractionHeight, 19);
    assert.equal(getGlassProfile('controls', false).blur, 3);
  });

  it('selects the new preview despite a legacy mode without rewriting the previous APK settings', async () => {
    const legacyMode = JSON.stringify({ schemaVersion: 1, mode: 'custom' });
    const legacyProfiles = JSON.stringify(saved);
    storage.items.set('resonus.glass-appearance.v1', legacyMode);
    storage.items.set('resonus.glass-appearance.v2', JSON.stringify({ schemaVersion: 1, mode: 'kyantDefault' }));
    storage.items.set(PARAMETERS_KEY, legacyProfiles);
    await useGlassTuning.getState().hydrate();
    assert.equal(useGlassTuning.getState().mode, 'amPlus');
    assert.equal(getGlassProfile('miniPlayer', false).blur, 4);
    assert.equal(storage.items.get('resonus.glass-appearance.v1'), legacyMode);
    assert.equal(storage.items.get(PARAMETERS_KEY), legacyProfiles);
    assert.deepEqual(storage.writes, []);
  });

  it('uses component materials across themes without saved tints leaking into the upstream preview', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    storage.items.set(MODE_KEY, JSON.stringify({ schemaVersion: 1, mode: 'custom' }));
    await useGlassTuning.getState().hydrate();
    const original = exportGlassTuning();
    useGlassTuning.getState().setMode('kyantDefault');
    assert.equal(getGlassProfile('miniPlayer', false).tintColor, 'transparent');
    assert.equal(getGlassProfile('miniPlayer', false).tintOpacity, 0);
    assert.equal(getGlassProfile('miniPlayer', true).refractionHeight, 12);
    assert.equal(getGlassProfile('navigation', false).tintColor, '#FAFAFA');
    assert.equal(getGlassProfile('navigation', true).tintColor, '#121212');
    assert.equal(getKyantGlassProfile('dialog', false).blur, 16);
    assert.equal(getKyantGlassProfile('dialog', true).blur, 8);
    useGlassTuning.getState().update('navigation', { tintColor: '#FF0000', blur: 40 });
    useGlassTuning.getState().reset('miniPlayer');
    assert.equal(exportGlassTuning(), original);
    useGlassTuning.getState().setMode('custom');
    assert.equal(getGlassProfile('miniPlayer', true).refraction, 21);
    assert.equal(getGlassProfile('navigation', true).refractionHeight, 19);
    assert.equal(exportGlassTuning(), original);
  });

  it('matches AM++ theme tint for the dock while retaining Kyant controls and saved custom values', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    await useGlassTuning.getState().hydrate();
    const original = JSON.stringify(useGlassTuning.getState().overrides);
    for (const dark of [false, true]) {
      const mini = getGlassProfile('miniPlayer', dark);
      const navigation = getGlassProfile('navigation', dark);
      assert.equal(mini.blur, 4);
      assert.equal(navigation.blur, 4);
      assert.equal(mini.refraction, 16.125);
      assert.equal(navigation.refraction, 24);
      assert.equal(mini.tintOpacity, .4);
      assert.equal(mini.tintColor, dark ? '#121212' : '#FAFAFA');
      assert.equal(navigation.tintColor, mini.tintColor);
      assert.deepEqual(getGlassProfile('controls', dark), getKyantGlassProfile('button', dark));
    }
    useGlassTuning.getState().update('miniPlayer', { blur: 40 });
    useGlassTuning.getState().reset('navigation');
    assert.equal(getGlassProfile('miniPlayer', false).blur, 40);
    assert.equal(JSON.stringify(useGlassTuning.getState().overrides), original);
    useGlassTuning.getState().setMode('kyantDefault');
    assert.equal(getGlassProfile('miniPlayer', false).tintOpacity, 0);
    assert.equal(getGlassProfile('miniPlayer', false).blur, 2);
    await useGlassTuning.getState().save();
    useGlassTuning.setState({ mode: 'amPlus', hydrated: false });
    await useGlassTuning.getState().hydrate();
    assert.equal(useGlassTuning.getState().mode, 'kyantDefault');
    assert.equal(JSON.stringify(useGlassTuning.getState().overrides), original);
  });

  it('blocks fixed-mode edits and reset, then restores custom values immediately on switching back', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    await useGlassTuning.getState().hydrate();
    const store = useGlassTuning.getState();
    store.setMode('iphoneReference');
    store.update('miniPlayer', { refraction: 48 });
    store.reset('controls');
    assert.deepEqual(useGlassTuning.getState().overrides, saved.overrides);
    store.setMode('custom');
    assert.equal(getGlassProfile('miniPlayer', false).refraction, 21);
    store.update('miniPlayer', { refraction: 22 });
    assert.equal(getGlassProfile('miniPlayer', false).refraction, 22);
    store.reset('controls');
    assert.deepEqual(useGlassTuning.getState().overrides.controls, {});
    assert.deepEqual(useGlassTuning.getState().overrides.navigation, saved.overrides.navigation);
    assert.deepEqual(storage.writes, []);
  });

  it('keeps mode changes, custom edits and resets made during a delayed hydration', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    storage.items.set(MODE_KEY, JSON.stringify({ schemaVersion: 1, mode: 'iphoneReference' }));
    const gate = deferred();
    storage.readGate = gate.promise;
    const hydration = useGlassTuning.getState().hydrate();
    useGlassTuning.getState().setMode('custom');
    useGlassTuning.getState().update('miniPlayer', { refraction: 31 });
    useGlassTuning.getState().reset('navigation');
    gate.release();
    await hydration;
    assert.equal(useGlassTuning.getState().mode, 'custom');
    assert.deepEqual(useGlassTuning.getState().overrides.miniPlayer, { refraction: 31, tintColor: '#123456' });
    assert.deepEqual(useGlassTuning.getState().overrides.navigation, {});
    assert.deepEqual(useGlassTuning.getState().overrides.controls, saved.overrides.controls);
  });

  it('keeps a reference selection made before a stored custom mode finishes loading', async () => {
    storage.items.set(MODE_KEY, JSON.stringify({ schemaVersion: 1, mode: 'custom' }));
    const gate = deferred();
    storage.readGate = gate.promise;
    const hydration = useGlassTuning.getState().hydrate();
    useGlassTuning.getState().setMode('iphoneReference');
    gate.release();
    await hydration;
    assert.equal(useGlassTuning.getState().mode, 'iphoneReference');
  });

  it('saves AM++ separately and exports its resolved profiles without overwriting legacy custom data', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    await useGlassTuning.getState().hydrate();
    await useGlassTuning.getState().save();
    assert.deepEqual(JSON.parse(storage.items.get(PARAMETERS_KEY)!), saved);
    const exported = JSON.parse(exportGlassTuning());
    assert.equal(exported.schemaVersion, 2);
    assert.equal(exported.mode, 'amPlus');
    assert.equal(exported.profiles.light.miniPlayer.blur, 4);
    assert.equal(exported.profiles.dark.navigation.tintColor, '#121212');
    assert.deepEqual(JSON.parse(storage.items.get(AM_PLUS_KEY)!).overrides, { miniPlayer: {}, navigation: {}, controls: {} });
    assert.deepEqual(JSON.parse(storage.items.get(MODE_KEY)!), { schemaVersion: 1, mode: 'amPlus' });
    useGlassTuning.getState().setMode('custom');
    assert.deepEqual(JSON.parse(exportGlassTuning()), saved);
    useGlassTuning.setState({ mode: 'custom', overrides: { miniPlayer: {}, navigation: {}, controls: {} }, hydrated: false });
    await useGlassTuning.getState().hydrate();
    assert.equal(useGlassTuning.getState().mode, 'amPlus');
    assert.deepEqual(useGlassTuning.getState().overrides, saved.overrides);
  });

  it('serializes overlapping saves with each mode paired to its parameter snapshot', async () => {
    await useGlassTuning.getState().hydrate();
    useGlassTuning.getState().setMode('custom');
    useGlassTuning.getState().update('miniPlayer', { refraction: 20 });
    const gate = deferred();
    storage.writeGate = gate.promise;
    const first = useGlassTuning.getState().save();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(storage.writes.length, 1);
    useGlassTuning.getState().update('miniPlayer', { refraction: 30 });
    useGlassTuning.getState().setMode('iphoneReference');
    const second = useGlassTuning.getState().save();
    gate.release();
    await Promise.all([first, second]);
    assert.deepEqual(storage.writes.map((write) => write.key), [PARAMETERS_KEY, AM_PLUS_KEY, MODE_KEY, PARAMETERS_KEY, AM_PLUS_KEY, MODE_KEY]);
    assert.equal(JSON.parse(storage.writes[0].value).overrides.miniPlayer.refraction, 20);
    assert.equal(JSON.parse(storage.writes[2].value).mode, 'custom');
    assert.equal(JSON.parse(storage.writes[3].value).overrides.miniPlayer.refraction, 30);
    assert.equal(JSON.parse(storage.writes[5].value).mode, 'iphoneReference');
  });

  it('does not overwrite unread custom data, retries the failed read and saves only after recovery', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    storage.failedReads.add(PARAMETERS_KEY);
    await useGlassTuning.getState().hydrate();
    assert.deepEqual(storage.writes, []);
    await assert.rejects(useGlassTuning.getState().save(), /could not be read/);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(JSON.parse(storage.items.get(PARAMETERS_KEY)!), saved);
    storage.failedReads.clear();
    await useGlassTuning.getState().save();
    assert.deepEqual(JSON.parse(storage.items.get(PARAMETERS_KEY)!), saved);
  });

  it('reports mode write failures and permits a later explicit save', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    await useGlassTuning.getState().hydrate();
    storage.failedWrites.add(MODE_KEY);
    await assert.rejects(useGlassTuning.getState().save(), /Write failed/);
    assert.deepEqual(JSON.parse(storage.items.get(PARAMETERS_KEY)!), saved);
    assert.equal(storage.items.has(MODE_KEY), false);
    storage.failedWrites.clear();
    await useGlassTuning.getState().save();
    assert.equal(JSON.parse(storage.items.get(MODE_KEY)!).mode, 'amPlus');
  });

  it('rejects unknown persisted modes and sanitizes custom fields without mutating the input', async () => {
    storage.items.set(MODE_KEY, JSON.stringify({ schemaVersion: 1, mode: 'unknown' }));
    await useGlassTuning.getState().hydrate();
    assert.equal(useGlassTuning.getState().mode, 'amPlus');
    const input = { blur: Infinity, refraction: 99, refractionHeight: -10, tintColor: '#abcDEF', depthEffect: true, other: 'discard' };
    assert.deepEqual(sanitizeGlassOverrides(input), { refraction: 48, refractionHeight: 0, tintColor: '#ABCDEF', depthEffect: true });
    assert.equal(input.refraction, 99);
    const defaults = getGlassDefaults('navigation', false, 'iphoneReference');
    defaults.refractionHeight = 48;
    assert.equal(resolveGlassProfile('navigation', false, { refractionHeight: 40 }, 'iphoneReference').refractionHeight, 8);
  });

  it('persists AM++ edits independently and restores their exact theme-aware profile after reload', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    await useGlassTuning.getState().hydrate();
    useGlassTuning.getState().update('miniPlayer', { blur: 7, refraction: 22, tintColor: '#12ABCD', tintOpacity: .25 });
    useGlassTuning.getState().update('navigation', { highlightOpacity: .45, chromaticAberration: true });
    useGlassTuning.getState().update('controls', { depthEffect: true });
    const expected = useGlassTuning.getState().amPlusOverrides;
    assert.equal(getGlassProfile('miniPlayer', false).blur, 7);
    assert.equal(getGlassProfile('miniPlayer', true).tintColor, '#12ABCD');
    useGlassTuning.getState().setMode('custom');
    assert.deepEqual(useGlassTuning.getState().overrides, saved.overrides);
    assert.equal(getGlassProfile('miniPlayer', false).refraction, 21);
    useGlassTuning.getState().setMode('amPlus');
    await useGlassTuning.getState().save();
    assert.deepEqual(JSON.parse(storage.items.get(PARAMETERS_KEY)!), saved);
    useGlassTuning.setState({ amPlusOverrides: { miniPlayer: {}, navigation: {}, controls: {} }, overrides: { miniPlayer: {}, navigation: {}, controls: {} }, hydrated: false });
    await useGlassTuning.getState().hydrate();
    assert.deepEqual(useGlassTuning.getState().amPlusOverrides, expected);
    assert.deepEqual(useGlassTuning.getState().overrides, saved.overrides);
    assert.equal(getGlassProfile('navigation', true).chromaticAberration, true);
  });

  it('resets all AM++ targets without changing another selected mode or any custom parameter', async () => {
    storage.items.set(PARAMETERS_KEY, JSON.stringify(saved));
    await useGlassTuning.getState().hydrate();
    for (const target of ['miniPlayer', 'navigation', 'controls'] as const) useGlassTuning.getState().update(target, { blur: 18 });
    await useGlassTuning.getState().save();
    const storedBeforeReset = storage.items.get(AM_PLUS_KEY);
    useGlassTuning.getState().setMode('custom');
    useGlassTuning.getState().resetAmPlusDefaults();
    assert.equal(useGlassTuning.getState().mode, 'custom');
    assert.deepEqual(useGlassTuning.getState().overrides, saved.overrides);
    assert.deepEqual(useGlassTuning.getState().amPlusOverrides, { miniPlayer: {}, navigation: {}, controls: {} });
    assert.equal(storage.items.get(AM_PLUS_KEY), storedBeforeReset); // reset is live until Save.
    useGlassTuning.getState().setMode('amPlus');
    for (const target of ['miniPlayer', 'navigation', 'controls'] as const) for (const dark of [false, true]) {
      assert.deepEqual(getGlassProfile(target, dark), getGlassDefaults(target, dark, 'amPlus'));
    }
    await useGlassTuning.getState().save();
    assert.deepEqual(JSON.parse(storage.items.get(AM_PLUS_KEY)!).overrides, { miniPlayer: {}, navigation: {}, controls: {} });
    assert.deepEqual(JSON.parse(storage.items.get(PARAMETERS_KEY)!), saved);
  });

  it('keeps AM++ edits and single/all-target resets made before delayed storage hydration', async () => {
    storage.items.set(AM_PLUS_KEY, JSON.stringify({ schemaVersion: 1, overrides: {
      miniPlayer: { blur: 12, refraction: 28 }, navigation: { blur: 9 }, controls: { tintOpacity: .5 },
    } }));
    const gate = deferred(); storage.readGate = gate.promise;
    const hydration = useGlassTuning.getState().hydrate();
    useGlassTuning.getState().update('miniPlayer', { refraction: 32 });
    useGlassTuning.getState().reset('navigation');
    gate.release(); await hydration;
    assert.deepEqual(useGlassTuning.getState().amPlusOverrides.miniPlayer, { blur: 12, refraction: 32 });
    assert.deepEqual(useGlassTuning.getState().amPlusOverrides.navigation, {});
    assert.deepEqual(useGlassTuning.getState().amPlusOverrides.controls, { tintOpacity: .5 });
    useGlassTuning.setState({ hydrated: false });
    const gate2 = deferred(); storage.readGate = gate2.promise;
    const hydration2 = useGlassTuning.getState().hydrate();
    useGlassTuning.getState().resetAmPlusDefaults();
    useGlassTuning.getState().update('controls', { blur: 3 });
    gate2.release(); await hydration2;
    assert.deepEqual(useGlassTuning.getState().amPlusOverrides, { miniPlayer: {}, navigation: {}, controls: { blur: 3 } });
  });

  it('blocks saves if AM++ data could not be read and recovers without deleting its stored values', async () => {
    const amSaved = { schemaVersion: 1, overrides: { miniPlayer: { blur: 9 }, navigation: {}, controls: {} } };
    storage.items.set(AM_PLUS_KEY, JSON.stringify(amSaved));
    storage.failedReads.add(AM_PLUS_KEY);
    await useGlassTuning.getState().hydrate();
    useGlassTuning.getState().update('navigation', { refraction: 31 });
    await assert.rejects(useGlassTuning.getState().save(), /could not be read/);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(JSON.parse(storage.items.get(AM_PLUS_KEY)!), amSaved);
    storage.failedReads.clear();
    await useGlassTuning.getState().save();
    assert.deepEqual(JSON.parse(storage.items.get(AM_PLUS_KEY)!).overrides,
      { miniPlayer: { blur: 9 }, navigation: { refraction: 31 }, controls: {} });
  });

  it('restores Automatic AM++ tint from the current theme without changing the stored override', () => {
    useGlassTuning.getState().update('miniPlayer', { tintColor: null });
    assert.equal(getGlassProfile('miniPlayer', false).tintColor, '#FAFAFA');
    assert.equal(getGlassProfile('miniPlayer', true).tintColor, '#121212');
    assert.deepEqual(useGlassTuning.getState().amPlusOverrides.miniPlayer, { tintColor: null });
  });

  it('reports AM++ save failures and retries the complete independent snapshot', async () => {
    await useGlassTuning.getState().hydrate();
    useGlassTuning.getState().update('navigation', { blur: 5 });
    storage.failedWrites.add(AM_PLUS_KEY);
    await assert.rejects(useGlassTuning.getState().save(), /Write failed/);
    assert.equal(storage.items.has(MODE_KEY), false);
    storage.failedWrites.clear();
    await useGlassTuning.getState().save();
    assert.equal(JSON.parse(storage.items.get(AM_PLUS_KEY)!).overrides.navigation.blur, 5);
    assert.equal(JSON.parse(storage.items.get(MODE_KEY)!).mode, 'amPlus');
  });

  it('keeps reference profiles within the existing capture padding and avoids extra blur/dispersion work', () => {
    for (const target of ['miniPlayer', 'navigation', 'controls'] as const) {
      const custom = getGlassDefaults(target, false);
      const reference = getGlassDefaults(target, false, 'iphoneReference');
      const padding = (profile: typeof reference) => 2 * profile.blur + Math.abs(profile.refraction) + Math.abs(profile.refractionHeight);
      assert.ok(padding(reference) <= padding(custom));
      assert.equal(reference.blur, 0);
      assert.equal(reference.chromaticAberration, false);
    }
  });
});
