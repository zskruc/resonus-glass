/**
 * Exercises the installed Reanimated NativeProxy method on the JVM with a
 * small Fabric lifecycle stub. No emulator, Android build, or downloads.
 *
 * node scripts/native-harness/reanimated-mounted-props.mjs
 * Requires the Kotlin compiler jars already cached by the Android build.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dependency = dirname(require.resolve('react-native-reanimated/package.json'));
const source = readFileSync(join(dependency,
  'android/src/main/java/com/swmansion/reanimated/NativeProxy.kt'), 'utf8');
const start = source.indexOf('fun synchronouslyUpdateUIProps(');
assert.ok(start >= 0, 'installed NativeProxy method must exist');
const open = source.indexOf('{', start);
let depth = 1;
let end = open + 1;
while (depth && end < source.length) {
  if (source[end] === '{') depth++;
  if (source[end] === '}') depth--;
  end++;
}
assert.equal(depth, 0);
// Compile the actual production function rather than reproducing its guard.
const method = source.slice(start, end);
const work = join(root, '.local-cache/reanimated-mounted-props-harness');
mkdirSync(work, { recursive: true });
const fixture = `
class IllegalViewOperationException : RuntimeException()
object BuildConfig { var IS_REACT_NATIVE_86_OR_NEWER = true }
object Log {
  val warnings = mutableListOf<Exception>()
  fun w(tag: String, text: String, error: Exception) { warnings.add(error) }
}
object SynchronousPropsBufferParser {
  fun parse(tags: IntArray, doubles: DoubleArray, update: (Int, Map<String, Any>) -> Unit) {
    tags.forEach { update(it, mapOf("opacity" to 1.0)) }
  }
}
class FakeFabric {
  val mounted = mutableSetOf<Int>()
  val preallocated = mutableSetOf<Int>()
  var legacyUpdates = 0
  fun resolveView(tag: Int): Any? {
    if (tag in preallocated) throw IllegalViewOperationException()
    return if (tag in mounted) this else null
  }
  fun synchronouslyUpdateViewOnUIThread(tag: Int, props: Map<String, Any>) { legacyUpdates++ }
}
class FakeMountingManager(val fabric: FakeFabric) {
  var invocations = 0
  var invalidInvocations = 0
  var failMountedUpdate = false
  fun updatePropsSynchronously(tag: Int, props: Map<String, Any>) {
    invocations++
    if (tag !in fabric.mounted) {
      invalidInvocations++
      throw IllegalViewOperationException()
    }
    if (failMountedUpdate) throw IllegalStateException("unexpected mounted failure")
  }
}
class Proxy {
  val mFabricUIManager = FakeFabric()
  val mountingManager = FakeMountingManager(mFabricUIManager)
  val updatePropsSynchronouslyMethod = FakeMountingManager::class.java.getDeclaredMethod(
    "updatePropsSynchronously", Int::class.javaPrimitiveType, Map::class.java)
  ${method}
}
fun main() {
  val proxy = Proxy()
  val all = IntArray(400) { it + 1 }
  proxy.mFabricUIManager.mounted.addAll(1..16)
  proxy.mFabricUIManager.preallocated.addAll(17..24)
  // Repeated scroll flushes containing hundreds of historical tags must reach
  // only mounted views. A missed guard previously logged on every stale tag.
  repeat(500) { proxy.synchronouslyUpdateUIProps(all, doubleArrayOf()) }
  check(proxy.mountingManager.invocations == 500 * 16)
  check(proxy.mountingManager.invalidInvocations == 0)
  check(Log.warnings.isEmpty())
  // The very next flush after unmount must stop updating that tag; remount is
  // resolved afresh, with no growing blacklist and no stale negative cache.
  proxy.mFabricUIManager.mounted.remove(1)
  val before = proxy.mountingManager.invocations
  proxy.synchronouslyUpdateUIProps(intArrayOf(1, 2), doubleArrayOf())
  check(proxy.mountingManager.invocations == before + 1)
  proxy.mFabricUIManager.mounted.add(1)
  proxy.synchronouslyUpdateUIProps(intArrayOf(1), doubleArrayOf())
  check(proxy.mountingManager.invocations == before + 2)
  // Unexpected errors for genuinely mounted views remain diagnostic.
  proxy.mountingManager.failMountedUpdate = true
  proxy.synchronouslyUpdateUIProps(intArrayOf(1), doubleArrayOf())
  check(Log.warnings.size == 1)
  // Older RN retains its original public synchronous-update path.
  BuildConfig.IS_REACT_NATIVE_86_OR_NEWER = false
  proxy.synchronouslyUpdateUIProps(intArrayOf(1, 2), doubleArrayOf())
  check(proxy.mFabricUIManager.legacyUpdates == 2)
  println("PASS: 200000 mixed mounted/stale/preallocated updates; unmount/remount; diagnostics; legacy RN")
}
`;
const fixturePath = join(work, 'MountedPropsHarness.kt');
writeFileSync(fixturePath, fixture);

const gradleCache = join(process.env.GRADLE_USER_HOME ?? join(process.env.HOME, '.gradle'),
  'caches/modules-2/files-2.1');
function cachedJar(group, artifact, version) {
  const base = join(gradleCache, group, artifact, version);
  for (const hash of readdirSync(base)) {
    const name = readdirSync(join(base, hash)).find((file) => file === `${artifact}-${version}.jar`);
    if (name) return join(base, hash, name);
  }
  throw new Error(`Kotlin harness needs cached ${artifact} ${version}; run the normal Android dependency setup first`);
}
const kotlin = '2.1.20';
const stdlib = cachedJar('org.jetbrains.kotlin', 'kotlin-stdlib', kotlin);
const annotations = cachedJar('org.jetbrains', 'annotations', '23.0.0');
const compilerClasspath = [
  ...['kotlin-compiler-embeddable', 'kotlin-stdlib', 'kotlin-script-runtime',
    'kotlin-reflect', 'kotlin-daemon-embeddable'].map((artifact) =>
    cachedJar('org.jetbrains.kotlin', artifact, kotlin)),
  cachedJar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330'),
  cachedJar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'),
  annotations,
].join(':');
const output = join(work, 'out');
mkdirSync(output, { recursive: true });
function run(args) {
  const result = spawnSync('java', args, { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  return result.stdout;
}
run(['-cp', compilerClasspath, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
  '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-cp', `${stdlib}:${annotations}`,
  '-d', output, fixturePath]);
process.stdout.write(run(['-cp', `${output}:${stdlib}`, 'MountedPropsHarnessKt']));
