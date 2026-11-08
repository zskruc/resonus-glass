/** No device/APK: isolate Expo's FTS close bug using its bundled SQLite C. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = join(root, '.local-cache'); mkdirSync(cache, { recursive: true });
const out = mkdtempSync(join(cache, 'sqlite-fts-close-'));
try {
  const binary = join(out, 'fts-close');
  const compile = spawnSync(process.env.CC || 'cc', ['-DSQLITE_ENABLE_FTS5=1', '-DSQLITE_THREADSAFE=1',
    '-I', join(root, 'node_modules/expo-sqlite/vendor/sqlite3'),
    join(root, 'scripts/native-harness/SqliteFtsClose.c'), join(root, 'node_modules/expo-sqlite/vendor/sqlite3/sqlite3.c'),
    '-lm', '-lpthread', '-o', binary], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr || String(compile.error));
  const broken = spawnSync(binary, ['expo-finalize', join(out, 'broken.db')], { encoding: 'utf8' });
  assert.equal(broken.status, 88, `The old Expo sweep must reproduce its invalid FTS close: ${broken.stderr}`);
  const fixed = spawnSync(binary, ['safe', join(out, 'safe.db')], { encoding: 'utf8' });
  assert.equal(fixed.status, 0, fixed.stderr || String(fixed.signal));
  process.stdout.write(`Old close sweep: isolated double-finalize reproduced (88).\n${fixed.stdout}`);
} finally { rmSync(out, { recursive: true, force: true }); }
