import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { GITHUB_REPOSITORY, RELEASES_API, RELEASES_PAGE } from '@/lib/project';

// Run the real updater with device storage and APK file operations replaced.
// The network boundary stays visible so an accidental return to the original
// project's release API or download URL fails these checks.
const device = {
  constants: { expoConfig: { version: '0.8.4' } },
  storage: new Map<string, string>(),
  deletedFiles: 0,
  download: null as null | { url: string; signal: AbortSignal },
};
Object.assign(globalThis, { __appUpdateTestDevice: device });

const modules: Record<string, string> = {
  'expo-constants': 'export default globalThis.__appUpdateTestDevice.constants;',
  'expo-modules-core': 'export function requireOptionalNativeModule() { return null; }',
  'expo-file-system': `
    export const Paths = { cache: 'file:///cache/' };
    export class Directory {
      create() {}
      list() { return [{ delete() { globalThis.__appUpdateTestDevice.deletedFiles++; } }]; }
    }
    export const File = {
      async downloadFileAsync(url, dir, options) {
        globalThis.__appUpdateTestDevice.download = { url, signal: options.signal };
        options.onProgress({ bytesWritten: 25, totalBytes: 100 });
        return { uri: 'file:///cache/updates/Resonus-Glass.apk' };
      },
    };
  `,
  './storage': `
    export async function getItem(key) { return globalThis.__appUpdateTestDevice.storage.get(key) ?? null; }
    export async function setItem(key, value) { globalThis.__appUpdateTestDevice.storage.set(key, value); }
  `,
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    const source = modules[specifier];
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return next(specifier, context);
  },
});
const { checkForUpdate, compareVersions, currentVersion, downloadApk } = await import('@/lib/appUpdate');
hook.deregister();

const originalFetch = globalThis.fetch;
const CHECK_KEY = `update_last_check:${GITHUB_REPOSITORY}`;
const APK_URL = 'https://github.com/zskruc/resonus-glass/releases/download/v0.8.5/Resonus-Glass-v0.8.5-arm64-v8a.apk';

function publishedRelease(version = '0.8.5') {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/zskruc/resonus-glass/releases/tag/v${version}`,
    body: '### Changed\n- Glass fork update.\n\n### Fixed\n- Keep the custom player.',
    assets: [
      { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.invalid/checksums' },
      { name: `Resonus-Glass-v${version}-arm64-v8a.apk`, browser_download_url: APK_URL, size: 12345 },
    ],
  };
}

beforeEach(() => {
  device.storage.clear();
  device.deletedFiles = 0;
  device.download = null;
  device.constants.expoConfig.version = '0.8.4';
});
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Glass version ordering', () => {
  it('tracks the upstream version and detects later Glass patch releases', () => {
    assert.equal(currentVersion(), '0.8.4');
    assert.equal(compareVersions('v0.8.4', '0.8.4'), 0);
    assert.equal(compareVersions('0.8.4', '0.8.3'), 1);
    assert.equal(compareVersions('0.8.4.1', '0.8.4'), 1);
    assert.equal(compareVersions('0.8.5', '0.8.4.1'), 1);
    assert.equal(compareVersions('0.8.4', '0.8.5'), -1);
    assert.equal(compareVersions('0.8.4', '0.8.4-beta.10'), 1);
    assert.equal(compareVersions('0.8.4-beta.10', '0.8.4-beta.9'), 1);
  });
});

describe('updates from the Glass repository', () => {
  it('loads its own API, APK, release page and release-body summary', async () => {
    const calls: string[] = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return Response.json(publishedRelease());
    };
    const release = await checkForUpdate(true);
    assert.deepEqual(calls, ['https://api.github.com/repos/zskruc/resonus-glass/releases/latest']);
    assert.equal(RELEASES_API, calls[0]);
    assert.deepEqual(release, {
      version: '0.8.5',
      apkUrl: APK_URL,
      size: 12345,
      pageUrl: 'https://github.com/zskruc/resonus-glass/releases/tag/v0.8.5',
      notes: { added: [], changed: ['Glass fork update.'], fixed: ['Keep the custom player.'] },
    });
  });

  it('does not offer the installed version or a downgrade', async () => {
    for (const version of ['0.8.4', '0.8.3']) {
      globalThis.fetch = async () => Response.json(publishedRelease(version));
      assert.equal(await checkForUpdate(true), null);
    }
  });

  it('offers a four-part Glass maintenance version', async () => {
    globalThis.fetch = async () => Response.json(publishedRelease('0.8.4.1'));
    assert.equal((await checkForUpdate(true))?.version, '0.8.4.1');
  });

  it('falls back to its own releases page if no page or APK is published', async () => {
    globalThis.fetch = async () => Response.json({ tag_name: 'v0.8.5' });
    const release = await checkForUpdate(true);
    assert.equal(release?.pageUrl, RELEASES_PAGE);
    assert.equal(RELEASES_PAGE, 'https://github.com/zskruc/resonus-glass/releases/latest');
    assert.equal(release?.apkUrl, undefined);
    assert.equal(release?.notes, undefined);
  });

  it('ignores the old upstream throttle, then throttles this source and permits a manual check', async () => {
    device.storage.set('update_last_check', String(Date.now()));
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(publishedRelease()); };
    assert.ok(await checkForUpdate());
    assert.ok(device.storage.has(CHECK_KEY));
    assert.equal(await checkForUpdate(), null);
    assert.equal(calls, 1);
    assert.ok(await checkForUpdate(true));
    assert.equal(calls, 2);
  });

  it('keeps network failures visible and retries without throttling them', async () => {
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(checkForUpdate(), /GitHub answered 503/);
    assert.equal(device.storage.has(CHECK_KEY), false);
    globalThis.fetch = async () => Response.json(publishedRelease());
    assert.ok(await checkForUpdate());
  });

  it('downloads the fork APK and forwards progress and cancellation', async () => {
    globalThis.fetch = async () => Response.json(publishedRelease());
    const release = (await checkForUpdate(true))!;
    const progress: number[] = [];
    const controller = new AbortController();
    assert.equal(await downloadApk(release, (fraction) => progress.push(fraction), controller.signal), 'file:///cache/updates/Resonus-Glass.apk');
    assert.deepEqual(device.download, { url: APK_URL, signal: controller.signal });
    assert.equal(device.deletedFiles, 1);
    assert.deepEqual(progress, [0.25]);
  });
});
