import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { applyInstall } = require('../plugins/withHighRefresh.js');

describe('foreground high refresh prebuild integration', () => {
  it('installs before React Native startup and preserves existing native setup', () => {
    const source = `class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    expo.modules.networkrecovery.NetworkRecovery.install(this)
    loadReactNative(this)
  }
}`;
    const updated = applyInstall(source);
    assert.ok(updated.indexOf('HighRefresh.install(this)') > updated.indexOf('super.onCreate()'));
    assert.ok(updated.indexOf('HighRefresh.install(this)') < updated.indexOf('loadReactNative(this)'));
    assert.ok(updated.includes('NetworkRecovery.install(this)'));
    assert.equal(applyInstall(updated), updated);
  });

  it('fails clearly on a changed prebuild template instead of shipping without the policy', () => {
    assert.throws(() => applyInstall('class MainApplication : Application() {}'),
      /Kotlin MainApplication.onCreate anchor was not found/);
  });
});
