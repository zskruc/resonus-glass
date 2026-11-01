#!/usr/bin/env bash
# Compiles the actual coordinator with lightweight Android/React boundaries.
# The Android service itself is separately checked by compileReleaseKotlin.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$ROOT/modules/background-downloads/native-harness"
SOURCE="$ROOT/modules/background-downloads/android/src/main/java/expo/modules/backgrounddownloads"
WORK="$ROOT/node_modules/.cache/background-downloads-harness"
M2="$ROOT/node_modules/.cache/native-harness/m2"
if [ -n "${JAVA_HOME:-}" ]; then TASK_JAVA="$JAVA_HOME/bin/java"; else TASK_JAVA=$(command -v java); fi
mkdir -p "$WORK"
KCP=""
for name in kotlin-compiler-embeddable kotlin-stdlib kotlin-script-runtime kotlin-reflect kotlin-daemon-embeddable; do
  jar="$M2/$name-2.1.20.jar"
  if [ ! -f "$jar" ]; then echo "Missing cached Kotlin harness dependency: run the project's native extractor harness setup first." >&2; exit 2; fi
  KCP="$KCP:$jar"
done
KCP="$KCP:$M2/trove4j-1.0.20200330.jar:$M2/kotlinx-coroutines-core-jvm-1.8.0.jar:$M2/annotations-23.0.0.jar"
"$TASK_JAVA" -cp "${KCP#:}" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -cp "$M2/kotlin-stdlib-2.1.20.jar" -d "$WORK" "$SOURCE/BackgroundDownloads.kt" "$SOURCE/DownloadProgress.kt" "$SOURCE/DownloadRunner.kt" \
  "$HERE"/stubs/*.kt "$HERE/Harness.kt"
"$TASK_JAVA" -cp "$WORK:$M2/kotlin-stdlib-2.1.20.jar" expo.modules.backgrounddownloads.HarnessKt
