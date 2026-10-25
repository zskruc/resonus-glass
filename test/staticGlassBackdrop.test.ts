import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import { createElement, type ReactNode } from 'react';
import ts from 'typescript';

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as {
  renderToStaticMarkup(element: ReactNode): string;
};

// Compile this UI-only boundary so the tests exercise its real React context.
// No React Native view, native renderer or filesystem-backed setting is mocked.
const contextUrl = new URL('../src/components/glass/StaticGlassBackdropContext.tsx', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../src/components/glass/StaticGlassBackdropContext') return { url: contextUrl, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== contextUrl) return next(url, context);
    return {
      format: 'module',
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      shortCircuit: true,
    };
  },
});
const { DynamicGlassBackdrop, StaticGlassBackdropProvider, useStaticGlassBackdropColor } =
  await import('../src/components/glass/StaticGlassBackdropContext');
hook.deregister();

function Probe({ variant = 'regular' }: { variant?: 'regular' | 'button' | 'subtle' | 'prominent' }) {
  return createElement('output', { 'data-source': useStaticGlassBackdropColor(variant) ?? 'live' });
}

describe('known flat settings backdrop boundary', () => {
  it('defaults to the live scene outside a settings source', () => {
    assert.equal(renderToStaticMarkup(createElement(Probe)), '<output data-source="live"></output>');
  });

  it('uses the supplied theme color only for ordinary cards', () => {
    const html = renderToStaticMarkup(createElement(StaticGlassBackdropProvider, { color: '#141619' },
      ...(['regular', 'button', 'subtle', 'prominent'] as const).map((variant) => createElement(Probe, { key: variant, variant }))));
    assert.equal(html, '<output data-source="#141619"></output>' + '<output data-source="live"></output>'.repeat(3));
  });

  it('clears the inherited source for modal and nested foreground subtrees without changing siblings', () => {
    const html = renderToStaticMarkup(createElement(StaticGlassBackdropProvider, { color: '#141619' },
      createElement(Probe),
      createElement(DynamicGlassBackdrop, null, createElement(Probe)),
      createElement(Probe)));
    assert.equal(html, '<output data-source="#141619"></output><output data-source="live"></output><output data-source="#141619"></output>');
  });

  it('renders the current light or dark source instead of retaining an earlier theme color', () => {
    for (const color of ['#141619', '#F7F8FA', '#000000']) {
      assert.equal(renderToStaticMarkup(createElement(StaticGlassBackdropProvider, { color }, createElement(Probe))),
        `<output data-source="${color}"></output>`);
    }
  });
});
