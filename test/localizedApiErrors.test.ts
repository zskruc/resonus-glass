import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import * as deadline from '../src/api/deadline';
import { createSlots } from '../src/lib/slots';

const en = JSON.parse(readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8'));
const zh = JSON.parse(readFileSync(new URL('../src/i18n/locales/zh-CN.json', import.meta.url), 'utf8'));
const auth = { serverUrl: 'https://server.test', username: 'user', token: 'token', salt: 'salt', ndPassword: 'password' };

function translation() {
  let language = 'zh-CN';
  return {
    setLanguage: (next: string) => { language = next; },
    tg: (key: string, vars?: Record<string, string | number>) => {
      let value: string = (language === 'zh-CN' ? zh : en)[key] ?? key;
      for (const [name, replacement] of Object.entries(vars ?? {})) value = value.replaceAll(`{${name}}`, String(replacement));
      return value;
    },
  };
}

function apiHarness(file: 'subsonic' | 'navidrome') {
  const text = translation();
  let responses: (Response | Error)[] = [];
  let timeout = false;
  let calls = 0;
  const exports: Record<string, any> = {};
  const mocks: Record<string, unknown> = {
    '@/i18n': { tg: text.tg },
    'expo-crypto': {}, 'expo-file-system': {},
    'expo/fetch': { fetch: async () => {
      calls++; const value = responses.shift();
      if (value instanceof Error) throw value;
      assert.ok(value, 'a test must supply every network response'); return value;
    } },
    '@/lib/perfLog': { netTally() {}, timed: (_label: string, work: () => unknown) => work() },
    '@/lib/slots': { createSlots },
    '@/lib/absentCovers': { markAbsentCovers() {}, omitsAbsentCovers: () => false },
    '@/lib/lyricWords': {},
    '@/lib/navidromeIds': { canonicalId: (id: string) => id, idWouldChange: () => false },
    './netGate': { assertCanRequest() {} },
    './deadline': { ...deadline, withDeadline: (...args: Parameters<typeof deadline.withDeadline>) => {
      if (timeout) return Promise.reject(new deadline.DeadlineError());
      return deadline.withDeadline(...args);
    } },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/api/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, __DEV__: false, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    require(name: string) { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; } });
  return { api: exports, calls: () => calls, setLanguage: text.setLanguage, timeout: () => { timeout = true; },
    reply: (...next: (Response | Error)[]) => { responses = next; } };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('Navidrome credential, HTTP and transport errors use the chosen language without changing their kinds', async () => {
  const missing = apiHarness('navidrome');
  await assert.rejects(missing.api.listArtistsPage({ ...auth, ndPassword: undefined }),
    (error: any) => error.kind === 'auth' && error.message === '未保存密码');
  assert.equal(missing.calls(), 0);
  for (const [response, expected] of [[new Error('socket failed'), '无法连接服务器'],
    [json({}, 401), '用户名或密码错误'], [json({}, 503), '网络错误（503）']] as const) {
    const h = apiHarness('navidrome'); h.reply(response);
    await assert.rejects(h.api.listArtistsPage(auth), (error: any) => error.message === expected);
  }
  for (const [status, kind, expected] of [[403, 'forbidden', '没有访问权限'],
    [404, 'unsupported', '服务器不支持此功能'], [503, 'other', '服务器错误（503）']] as const) {
    const h = apiHarness('navidrome'); h.reply(json({ token: 'jwt' }), json({}, status));
    await assert.rejects(h.api.listArtistsPage(auth), (error: any) => error.kind === kind && error.message === expected);
    assert.equal(h.calls(), 2);
  }
});

test('Navidrome deadlines stay bounded and translate without becoming authentication failures', async () => {
  const h = apiHarness('navidrome'); h.timeout();
  await assert.rejects(h.api.listArtistsPage(auth), (error: any) => error.kind === 'other' && error.message === '服务器响应超时');
  assert.equal(h.calls(), 0);
});

test('Subsonic retains network classification and protocol error codes while translating client messages', async () => {
  const h = apiHarness('subsonic'); h.reply(new Error('socket failed'));
  await assert.rejects(h.api.ping(auth), (error: any) => error.network === true && error.message === '无法连接服务器');
  h.reply(json({}, 503));
  await assert.rejects(h.api.ping(auth), (error: any) => error.network === false && error.message === '网络错误（503）');
  h.reply(json({ unexpected: true }));
  await assert.rejects(h.api.ping(auth), (error: any) => error.network === false && error.message === '服务器响应异常');
  h.reply(json({ 'subsonic-response': { status: 'failed', error: { code: 50, message: 'Server-specific detail' } } }));
  await assert.rejects(h.api.ping(auth), (error: any) => error.code === 50 && !error.network && error.message === 'Server-specific detail');
  h.setLanguage('en'); h.reply(json({}, 503));
  await assert.rejects(h.api.ping(auth), (error: any) => error.message === 'Network error (503)');
});

test('the actual crash boundary translates its title/retry and preserves error details and reset', () => {
  const text = translation(); const exports: Record<string, any> = {};
  class Component {
    state: any; props = { children: 'restored content' };
    setState(next: unknown) { this.state = next; }
  }
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const colors = { accent: 'green' };
  const mocks: Record<string, unknown> = {
    react: { Component }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'button', Text: 'text', View: 'view' },
    '@/i18n': { tg: text.tg }, '@/theme': { colors, fontSize: {}, radius: {}, spacing: {}, tracking: {}, themed: (read: any) => read(colors) },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/ErrorBoundary.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => mocks[name] });
  const boundary = new exports.ErrorBoundary(); boundary.state = { error: new Error('useful detail') };
  let tree = boundary.render();
  assert.equal(tree.props.children[0].props.children, '出现了一些问题');
  assert.equal(tree.props.children[1].props.children, 'useful detail');
  assert.equal(tree.props.children[2].props.children.props.children, '重试');
  text.setLanguage('en'); tree = boundary.render();
  assert.equal(tree.props.children[0].props.children, 'Something went wrong');
  tree.props.children[2].props.onPress(); assert.equal(boundary.render(), 'restored content');
});
