import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Style = Record<string, unknown>;
type State = { settledProps: Style };
type Update = (state: State) => State | null;
type Sync = (this: { setState(update: Update): void }, props: Style) => void;
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-reanimated/package.json'));
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const builtins = { Object, Array, Reflect, WeakSet };
const equality: { deepEqual?: (left: unknown, right: unknown) => boolean } = {};
runInNewContext(compile(readFileSync(join(root, 'src/css/utils/equality.ts'), 'utf8')),
  { ...builtins, exports: equality });
const comparison: { haveSameSettledProps?: (left: Style, right: Style) => boolean } = {};
runInNewContext(compile(readFileSync(join(root, 'src/createAnimatedComponent/settledProps.ts'), 'utf8')), {
  ...builtins,
  exports: comparison,
  require(id: string) {
    assert.equal(id, '../css/utils/equality');
    return equality;
  },
});
const component = readFileSync(join(root, 'src/createAnimatedComponent/AnimatedComponent.tsx'), 'utf8');
const start = component.indexOf('_syncStylePropsBackToReact(props: StyleProps)');
assert.ok(start >= 0);
const open = component.indexOf('{', start);
let depth = 1;
let end = open + 1;
while (depth && end < component.length) {
  if (component[end] === '{') depth++;
  if (component[end] === '}') depth--;
  end++;
}
assert.equal(depth, 0);
// Keep the production method body, its actual comparison helper and upstream
// pure deepEqual. Only the React scheduler is replaced by a controllable queue.
const method = compile(`class ActualComponent { ${component.slice(start, end)} }
exports.sync = ActualComponent.prototype._syncStylePropsBackToReact;`);

function view(enabled = true) {
  const exports: { sync?: Sync } = {};
  runInNewContext(method, {
    exports,
    FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS: enabled,
    settledProps_1: comparison,
    haveSameSettledProps: comparison.haveSameSettledProps,
  });
  assert.ok(exports.sync);
  let state: State = { settledProps: {} };
  let commits = 0;
  const queue: Update[] = [];
  const owner = { setState(update: Update) { queue.push(update); } };
  return {
    sync(props: Style) { exports.sync!.call(owner, props); },
    flush() {
      while (queue.length) {
        const next = queue.shift()!(state);
        if (next !== null) { state = next; commits++; }
      }
    },
    state: () => state.settledProps,
    commits: () => commits,
    queued: () => queue.length,
  };
}

describe('settled animation React synchronization', () => {
  it('keeps the first sync and skips structurally equal transform arrays from later polls', () => {
    const h = view();
    const initial = { opacity: 1, transform: [{ translateX: 0 }, { scaleY: .5 }] };
    h.sync(initial); h.flush();
    assert.equal(h.commits(), 1);
    for (let poll = 0; poll < 20; poll++) h.sync(JSON.parse(JSON.stringify(initial)));
    h.flush();
    assert.equal(h.commits(), 1);
    h.sync({ transform: [{ translateX: 0 }, { scaleY: .6 }] }); h.flush();
    assert.equal(h.commits(), 2);
    assert.equal(h.state().opacity, 1);
  });

  it('compares queued functional state and preserves newer partial changes', () => {
    const h = view();
    h.sync({ opacity: .5 });
    h.sync({ opacity: .5 });
    h.sync({ opacity: .7, borderRadius: 12 });
    h.sync({ borderRadius: 12 });
    h.flush();
    assert.equal(h.commits(), 2);
    assert.deepEqual({ ...h.state() }, { opacity: .7, borderRadius: 12 });
    h.sync({ elevation: undefined }); h.flush();
    assert.equal(h.commits(), 3);
    assert.ok(Object.hasOwn(h.state(), 'elevation'));
    h.sync({}); h.flush();
    assert.equal(h.commits(), 3);
  });

  it('deduplicates normalized colors and shadow records but commits changed color values', () => {
    const h = view();
    const style = { backgroundColor: 'rgba(0,128,255,1)', tintColor: { resource_paths: ['color/accent'] },
      boxShadow: [{ offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.3)', blurRadius: 3 }] };
    h.sync(style); h.flush();
    h.sync(JSON.parse(JSON.stringify(style))); h.flush();
    assert.equal(h.commits(), 1);
    h.sync({ backgroundColor: 'rgba(0,64,255,1)' }); h.flush();
    assert.equal(h.commits(), 2);
    assert.deepEqual(h.state().boxShadow, style.boxShadow);
  });

  it('retains frozen state but performs the first sync again for a fresh owner', () => {
    const retained = view();
    retained.sync({ opacity: .4 }); retained.flush();
    // A freeze/remount keeping the same component also keeps settled React state.
    retained.sync({ opacity: .4 }); retained.flush();
    assert.equal(retained.commits(), 1);
    const fresh = view();
    fresh.sync({ opacity: .4 }); fresh.flush();
    assert.equal(fresh.commits(), 1);
    assert.deepEqual({ ...fresh.state() }, { opacity: .4 });
  });

  it('does not equate opaque objects, getters, custom prototypes or cyclic data', () => {
    const h = view();
    class HostObject {}
    for (const create of [() => new HostObject(), () => ({}), () => Object.create({ native: true })]) {
      h.sync({ tintColor: create() }); h.flush();
      const before = h.commits();
      h.sync({ tintColor: create() }); h.flush();
      assert.equal(h.commits(), before + 1);
    }
    const accessor = Object.defineProperty({}, 'native', { enumerable: true, get() { throw new Error('must not read'); } });
    h.sync({ tintColor: accessor }); h.flush();
    const before = h.commits();
    h.sync({ tintColor: accessor }); h.flush();
    assert.equal(h.commits(), before + 1);
    const opaque = new Proxy({}, { ownKeys() { throw new Error('opaque native object'); } });
    h.sync({ tintColor: opaque }); h.flush();
    h.sync({ tintColor: opaque }); h.flush();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    h.sync({ tintColor: cycle }); h.flush();
    h.sync({ tintColor: cycle }); h.flush();
  });

  it('keeps the upstream feature gate intact', () => {
    const h = view(false);
    h.sync({ opacity: 1 });
    assert.equal(h.queued(), 0);
    assert.equal(h.commits(), 0);
  });
});
