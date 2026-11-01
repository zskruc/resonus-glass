/**
 * Explicit, bounded reproduction; intentionally excluded from the normal test suite.
 * React 19 + useSyncExternalStore + synchronous lease commits can keep retrying
 * react-freeze's shared infinite thenable when the second sibling is retired.
 * The production resource boundary uses built-in Activity instead.
 * Run: node scripts/native-harness/route-image-freeze-regression.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const fixture = (activity) => `
import React from 'react';
import { act, create } from 'react-test-renderer';
import { Freeze } from 'react-freeze';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let version = 0;
const listeners = new Set();
const subscribe = (callback) => { listeners.add(callback); return () => listeners.delete(callback); };
function Boundary({ at }) {
  const current = React.useSyncExternalStore(subscribe, () => version);
  const active = at >= current;
  const lease = React.useMemo(() => ({ active }), [active]);
  const [committed, setCommitted] = React.useState(lease);
  React.useLayoutEffect(() => { if (committed !== lease) setCommitted(lease); }, [lease, committed]);
  const hidden = !active && committed === lease;
  return React.createElement(${activity ? "React.Activity, { mode: hidden ? 'hidden' : 'visible' }" : 'Freeze, { freeze: hidden }'}, React.createElement('view'));
}
let renderer;
await act(async () => { renderer = create(React.createElement(React.Fragment, null,
  [0, 1, 2].map((at) => React.createElement(Boundary, { at, key: at })))); });
console.log('mounted');
for (let next = 1; next <= 2; next++) {
  await act(async () => { version = next; for (const callback of [...listeners]) callback(); });
  console.log('retired', next);
}
await act(async () => renderer.unmount());
`;

const legacy = spawnSync(process.execPath, ['--input-type=module', '-e', fixture(false)], { encoding: 'utf8', timeout: 4_000 });
assert.equal(legacy.error?.code, 'ETIMEDOUT', 'the pinned legacy Freeze fixture should demonstrate the second-retirement retry');
assert.match(legacy.stdout, /retired 1/);
assert.doesNotMatch(legacy.stdout, /retired 2/);
console.log('Legacy Freeze: reproduced bounded second-retirement timeout (child terminated).');

const corrected = spawnSync(process.execPath, ['--input-type=module', '-e', fixture(true)], { encoding: 'utf8', timeout: 4_000 });
assert.equal(corrected.status, 0, corrected.stderr || corrected.error?.message);
assert.match(corrected.stdout, /retired 2/);
console.log('Native React Activity: both retirements completed and the renderer unmounted.');
