import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, describe, it } from 'node:test';

import { getPlayerGlassRecipe, getPlayerMoreMenuMaterial, isPlayerGlassRecipe } from '@/theme/playerGlassRecipes';

const storage = {
  text: null as string | null,
  writes: [] as string[],
  failRead: false,
  failWrite: false,
  readGate: null as Promise<void> | null,
};
Object.assign(globalThis, { __playerGlassTestStorage: storage, __DEV__: false });
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/lib/storage') return {
    url: `data:text/javascript,${encodeURIComponent(`
      export async function getItem(key) {
        if (key !== 'resonus.player-glass.v1') throw new Error('Unexpected key');
        const storage = globalThis.__playerGlassTestStorage;
        const text = storage.text;
        if (storage.readGate) await storage.readGate;
        if (storage.failRead) throw new Error('Read failed');
        return text;
      }
      export async function setItemStrict(key, text) {
        if (key !== 'resonus.player-glass.v1') throw new Error('Unexpected key');
        const storage = globalThis.__playerGlassTestStorage;
        storage.writes.push(text);
        if (storage.failWrite) throw new Error('Write failed');
        storage.text = text;
      }
    `)}`,
    shortCircuit: true,
  };
  return next(specifier, context);
} });
const { usePlayerGlass } = await import('@/store/playerGlass');
hook.deregister();

beforeEach(() => {
  storage.text = null;
  storage.writes = [];
  storage.failRead = false;
  storage.failWrite = false;
  storage.readGate = null;
  usePlayerGlass.setState({ recipe: 'dock', hydrated: false });
});

describe('AM++ player popup recipes', () => {
  it('retains the different blur/lens chains rather than treating clear as zero blur', () => {
    for (const dark of [false, true]) {
      const dock = getPlayerGlassRecipe('dock', dark);
      const menu = getPlayerGlassRecipe('menu', dark);
      const clear = getPlayerGlassRecipe('clear', dark);
      assert.equal(dock.materialPreset, 'mediaPopupBottom');
      assert.deepEqual([dock.profile.blur, dock.profile.refractionHeight, dock.profile.refraction], [4, 24, 24]);
      assert.deepEqual([menu.profile.blur, menu.profile.refractionHeight, menu.profile.refraction], [20, 10, 16]);
      assert.deepEqual([clear.profile.blur, clear.profile.refractionHeight, clear.profile.refraction], [20, 20, 32]);
      assert.equal(clear.profile.tintOpacity, 0);
      assert.equal(clear.profile.tintColor, 'transparent');
      assert.equal(dock.profile.tintOpacity, .4);
      assert.equal(menu.profile.tintColor, dark ? '#3A3A3C' : '#F2F2F7');
      assert.equal(menu.profile.tintOpacity, dark ? .36 : .55);
    }
  });

  it('keeps More menu material independent of the selected popup recipe', () => {
    assert.equal(getPlayerMoreMenuMaterial(false).materialPreset, 'mediaMenu');
    assert.equal(getPlayerMoreMenuMaterial(true).profile.tintColor, '#3A3A3C');
    for (const value of ['dock', 'menu', 'clear', 'original']) assert.equal(isPlayerGlassRecipe(value), true);
    for (const value of ['no_frost', null, [], {}, 4]) assert.equal(isPlayerGlassRecipe(value), false);
  });

  it('hydrates only its own preference and does not write defaults on first use', async () => {
    await usePlayerGlass.getState().hydrate();
    assert.equal(usePlayerGlass.getState().recipe, 'dock');
    assert.equal(usePlayerGlass.getState().hydrated, true);
    assert.deepEqual(storage.writes, []);
    usePlayerGlass.setState({ hydrated: false });
    storage.text = JSON.stringify({ schemaVersion: 1, recipe: 'original' });
    await usePlayerGlass.getState().hydrate();
    assert.equal(usePlayerGlass.getState().recipe, 'original');
  });

  it('does not replace a user choice made while an older preference is loading', async () => {
    storage.text = JSON.stringify({ schemaVersion: 1, recipe: 'menu' });
    let release!: () => void;
    storage.readGate = new Promise<void>((resolve) => { release = resolve; });
    const hydration = usePlayerGlass.getState().hydrate();
    await usePlayerGlass.getState().setRecipe('clear');
    release();
    await hydration;
    assert.equal(usePlayerGlass.getState().recipe, 'clear');
    assert.equal(JSON.parse(storage.text!).recipe, 'clear');
  });

  it('retries failed reads without saving fallback values and keeps explicit save failures observable', async () => {
    storage.failRead = true;
    await usePlayerGlass.getState().hydrate();
    assert.equal(usePlayerGlass.getState().hydrated, false);
    assert.deepEqual(storage.writes, []);
    storage.failRead = false;
    storage.text = JSON.stringify({ schemaVersion: 1, recipe: 'menu' });
    await usePlayerGlass.getState().hydrate();
    assert.equal(usePlayerGlass.getState().recipe, 'menu');
    storage.failWrite = true;
    await assert.rejects(usePlayerGlass.getState().setRecipe('clear'));
    storage.failWrite = false;
    await usePlayerGlass.getState().setRecipe('dock');
    assert.equal(JSON.parse(storage.text!).recipe, 'dock');
  });

  it('serializes quick selections and rejects invalid keys without writing them', async () => {
    await Promise.all(['menu', 'clear', 'original'].map((recipe) =>
      usePlayerGlass.getState().setRecipe(recipe as 'menu' | 'clear' | 'original')));
    assert.equal(JSON.parse(storage.text!).recipe, 'original');
    assert.equal(usePlayerGlass.getState().recipe, 'original');
    await assert.rejects(usePlayerGlass.getState().setRecipe('invalid' as 'dock'));
    assert.equal(storage.writes.length, 3);
  });
});
