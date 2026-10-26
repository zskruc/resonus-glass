import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Execute installed Reanimated measure(), retaining its real null-ref behavior. */
export function nativeMeasureBoundary(read: (wrapper: any) => unknown) {
  const calls: unknown[] = [];
  const output = ts.transpileModule(readFileSync(new URL('../../node_modules/react-native-reanimated/src/platformFunctions/measure.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(output, { exports, __RUNTIME_KIND: 1,
    global: { _measure(wrapper: unknown) {
      calls.push(wrapper);
      assert.ok(wrapper && typeof wrapper === 'object', 'native measure requires a ShadowNode object');
      return read(wrapper);
    } },
    require(name: string) {
      if (name === 'react-native-worklets') return { RuntimeKind: { ReactNative: 0, UI: 1 } };
      if (name === '../common') return { IS_JEST: false, SHOULD_BE_USE_WEB: false, logger: { warn() {} } };
      throw new Error(`Unexpected installed measure import ${name}`);
    },
  });
  return { measure: exports.measure as (ref: () => unknown) => any, calls };
}
