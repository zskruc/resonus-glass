/**
 * Runs the installed Reanimated registry's real C++ method bodies with minimal
 * value/tree types. Checks draw-pass deltas without an Android build or device.
 *
 * node scripts/native-harness/reanimated-pending-props.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dependency = dirname(require.resolve('react-native-reanimated/package.json'));
const source = readFileSync(join(dependency,
  'Common/cpp/reanimated/Fabric/updates/UpdatesRegistry.cpp'), 'utf8');
function method(signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `installed C++ method ${signature} must exist`);
  const open = source.indexOf('{', start);
  let depth = 1;
  let end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  return source.slice(start, end);
}
const methods = [
  'UpdatesBatch UpdatesRegistry::getPendingUpdates()',
  'void UpdatesRegistry::flush(UpdatesBatch &updatesBatch)',
  'void UpdatesRegistry::collectProps(PropsMap &propsMap)',
  'void UpdatesRegistry::addUpdatesToBatch(',
  'void UpdatesRegistry::flushUpdatesToRegistry(',
].map(method).join('\n\n');
const work = join(root, '.local-cache/reanimated-pending-props-harness');
mkdirSync(work, { recursive: true });
const fixture = `
#include <cassert>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>
#define react_native_assert assert
namespace folly {
struct dynamic {
  std::map<std::string, double> values;
  dynamic() = default;
  dynamic(std::initializer_list<std::pair<const std::string, double>> initial) : values(initial) {}
  void update(const dynamic &next) { for (auto &[key, value] : next.values) values[key] = value; }
};
}
using Tag = int;
struct ShadowNodeFamily {
  using Shared = std::shared_ptr<ShadowNodeFamily>;
  Tag tag;
  Tag getTag() const { return tag; }
};
struct RawProps {
  folly::dynamic value;
  RawProps(const folly::dynamic &value) : value(value) {}
};
using UpdatesBatch = std::vector<std::pair<ShadowNodeFamily::Shared, folly::dynamic>>;
using RegistryMap = std::unordered_map<Tag, std::pair<ShadowNodeFamily::Shared, folly::dynamic>>;
using PropsMap = std::map<ShadowNodeFamily::Shared, std::vector<RawProps>>;
struct UpdatesRegistryManager { static bool isLockedByCurrentThread() { return true; } };
class UpdatesRegistry {
 public:
  UpdatesBatch getPendingUpdates();
  void flush(UpdatesBatch &updatesBatch);
  void collectProps(PropsMap &propsMap);
  void addUpdatesToBatch(const ShadowNodeFamily::Shared &family, const folly::dynamic &props);
 private:
  UpdatesBatch updatesBatch_;
  RegistryMap updatesRegistry_;
  void flushUpdatesToRegistry(const UpdatesBatch &updatesBatch);
};
${methods}
int main() {
  UpdatesRegistry registry;
  std::vector<ShadowNodeFamily::Shared> rows;
  // A large mounted swipeable list seeds hundreds of settled styles.
  for (int tag = 1; tag <= 800; ++tag) {
    auto row = std::make_shared<ShadowNodeFamily>(); row->tag = tag; rows.push_back(row);
    registry.addUpdatesToBatch(row, {{"opacity", 1.0}, {"translateX", 0.0}});
  }
  UpdatesBatch initial;
  registry.flush(initial);
  assert(initial.size() == 800);
  // Scroll events without style changes must not copy/re-serialize 800 rows.
  for (int i = 0; i < 1000; ++i) assert(registry.getPendingUpdates().empty());
  auto header = std::make_shared<ShadowNodeFamily>(); header->tag = 801;
  registry.addUpdatesToBatch(header, {{"opacity", .7}, {"height", 80.0}});
  registry.addUpdatesToBatch(header, {{"opacity", .4}});
  for (int i = 0; i < 20; ++i) {
    auto pending = registry.getPendingUpdates();
    assert(pending.size() == 2);
    for (auto &[family, props] : pending) assert(family == header);
  }
  // Full React-commit restoration still includes every unchanged row, plus
  // the newest merged header values, even before the normal frame flush.
  PropsMap restore;
  registry.collectProps(restore);
  assert(restore.size() == 801);
  for (auto &row : rows) assert(restore.at(row).front().value.values.at("opacity") == 1.0);
  assert(restore.at(header).front().value.values.at("opacity") == .4);
  assert(restore.at(header).front().value.values.at("height") == 80.0);
  // The draw-pass path cannot consume deferred layout props. They must reach
  // the normal flush together with the last non-layout update.
  UpdatesBatch full;
  registry.flush(full);
  assert(full.size() == 2);
  assert(full[0].second.values.at("height") == 80.0);
  assert(full[1].second.values.at("opacity") == .4);
  assert(registry.getPendingUpdates().empty());
  PropsMap after;
  registry.collectProps(after);
  assert(after.size() == 801);
  assert(after.at(header).front().value.values.at("height") == 80.0);
  // A newly mounted row is immediately eligible, even if its first style is
  // identical to settled styles on other rows; this is not global value dedup.
  auto fresh = std::make_shared<ShadowNodeFamily>(); fresh->tag = 802;
  registry.addUpdatesToBatch(fresh, {{"opacity", 1.0}});
  auto mount = registry.getPendingUpdates();
  assert(mount.size() == 1 && mount[0].first == fresh);
  std::cout << "PASS: 800 settled rows x 1000 unchanged events produce no native deltas; full commit restoration and deferred layout remain intact\\n";
}
`;
const file = join(work, 'PendingPropsHarness.cpp');
const binary = join(work, 'pending-props');
writeFileSync(file, fixture);
const compiled = spawnSync('clang++', ['-std=c++17', '-O2', file, '-o', binary],
  { cwd: root, encoding: 'utf8' });
assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
const result = spawnSync(binary, [], { cwd: root, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || String(result.error));
process.stdout.write(result.stdout);
