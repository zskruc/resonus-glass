/** Index only labels attached to real settings controls; no setting values or account data. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
const chinese = JSON.parse(readFileSync(new URL('src/i18n/locales/zh-CN.json', root), 'utf8'));
const titleOf = (key) => chinese[key] ?? chinese[key.split('::')[0]] ?? key.split('::')[0];
function translated(expression) {
  if (ts.isParenthesizedExpression(expression)) return translated(expression.expression);
  // The false branch is the base screen; previews/offline headings are transient variants.
  if (ts.isConditionalExpression(expression)) return translated(expression.whenFalse) ?? translated(expression.whenTrue);
  return ts.isCallExpression(expression) && expression.expression.getText() === 't'
    && expression.arguments[0] && ts.isStringLiteral(expression.arguments[0]) ? expression.arguments[0].text : undefined;
}
const attr = (node, key) => node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.text === key)?.initializer;
const entries = [];
for (const file of readdirSync(new URL('src/app/settings/', root)).filter((name) => name.endsWith('.tsx') && !['index.tsx', 'search.tsx'].includes(name)).sort()) {
  const route = `/settings/${file.slice(0, -4)}`;
  const source = ts.createSourceFile(file, readFileSync(new URL(`src/app/settings/${file}`, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const labels = new Set(); let heading;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(source);
      if (['SettingsPage', 'ScreenHeader'].includes(name)) {
        const title = attr(node, 'title'); if (title && ts.isJsxExpression(title) && title.expression) heading ??= translated(title.expression);
      }
      if (['SettingRow', 'Field', 'SliderRow', 'TextRow', 'SelectList'].includes(name)) {
        const label = attr(node, 'label');
        if (label && ts.isJsxExpression(label) && label.expression) { const key = translated(label.expression); if (key) labels.add(key); }
      }
      const collapsible = attr(node, 'collapsible');
      if (name === 'SwitchList' || (name === 'SelectList' && collapsible?.getText(source) === '{false}')) {
        const options = attr(node, 'options');
        const walk = (child) => {
          if (ts.isPropertyAssignment(child) && child.name.getText(source) === 'label') { const key = translated(child.initializer); if (key) labels.add(key); }
          child.forEachChild(walk);
        };
        if (options) walk(options);
      }
    }
    node.forEachChild(visit);
  }
  visit(source);
  if (file === 'glass.tsx') {
    // ParameterSlider explicitly wraps these labels with SettingAnchor.
    const findParameters = (node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'PARAMETERS' && node.initializer) {
        const scan = (child) => {
          if (ts.isPropertyAssignment(child) && child.name.getText(source) === 'label' && ts.isStringLiteral(child.initializer)) labels.add(child.initializer.text);
          child.forEachChild(scan);
        };
        scan(node.initializer);
      }
      node.forEachChild(findParameters);
    };
    findParameters(source);
  }
  const slug = file.slice(0, -4), words = slug.replaceAll('-', ' ');
  heading ??= ({ cache: 'Cached songs', glass: 'Glass lab', player: 'Player', theme: 'Theme', 'long-audio': 'Long audio', shuffle: 'Shuffle preferences' })[slug]
    ?? words.charAt(0).toUpperCase() + words.slice(1);
  entries.push({ id: route, route, title: heading, chinese: titleOf(heading), section: heading });
  for (const label of labels) entries.push({ id: `${route}#${label}`, route, title: label, chinese: titleOf(label), section: heading, anchor: label });
}
writeFileSync(new URL('src/lib/settingsSearchEntries.ts', root), `/** Generated from real SettingsUI control labels by scripts/generate-settings-search-index.mjs. */\nimport type { SettingsSearchEntry } from './settingsSearch';\nimport { SETTINGS_SEARCH_EXTRAS } from './settingsSearchExtras';\nexport const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [...${JSON.stringify(entries, null, 2)}, ...SETTINGS_SEARCH_EXTRAS];\n`);
process.stdout.write(`${entries.length} settings routes and controls indexed.\n`);
