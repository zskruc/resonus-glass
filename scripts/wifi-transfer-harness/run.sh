#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd "$(dirname "$0")/../.." && pwd)
work="$project_root/node_modules/.cache/wifi-transfer-harness"
maven="$project_root/node_modules/.cache/native-harness/m2"
mkdir -p "$work/classes"
compiler_cp=$(find "$maven" -maxdepth 1 -name '*.jar' -print | paste -sd: -)
test_cp="$maven/kotlin-stdlib-2.1.20.jar:$maven/annotations-23.0.0.jar"
[ -f "$maven/kotlin-compiler-embeddable-2.1.20.jar" ] || { echo 'Run pnpm harness:extractor once to prepare the shared Kotlin compiler cache'; exit 2; }
java -cp "$compiler_cp" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$test_cp" -d "$work/classes" \
 "$project_root/modules/local-http/android/src/main/java/expo/modules/localhttp/TransferServer.kt" "$project_root/scripts/wifi-transfer-harness/TransferHarness.kt"
java -cp "$work/classes:$test_cp" TransferHarnessKt
