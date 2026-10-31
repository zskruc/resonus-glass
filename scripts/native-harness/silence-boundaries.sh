#!/usr/bin/env bash
# Compile only the pure production PCM scanner and deterministic JVM fixture.
# Uses the same cached Kotlin compiler as run.sh; no APK, emulator or network.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CACHE="$ROOT/node_modules/.cache/native-harness"
OUT="$ROOT/.local-cache/silence-boundaries-jvm"
JAVACMD="${JAVA_HOME:+$JAVA_HOME/bin/}java"
COMPILER="$CACHE/m2/kotlin-compiler-embeddable-2.1.20.jar"
[ -f "$COMPILER" ] || { echo 'Run the extractor harness once to cache its Kotlin compiler.' >&2; exit 2; }
CLASSPATH=$(find "$CACHE/m2" -maxdepth 1 -name '*.jar' -print | paste -sd: -)
mkdir -p "$OUT"
"$JAVACMD" -cp "$CLASSPATH" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -cp "$CACHE/m2/kotlin-stdlib-2.1.20.jar" -d "$OUT" \
  "$ROOT/modules/silence-trim/android/src/main/java/expo/modules/silencetrim/PcmBoundaryScanner.kt" \
  "$ROOT/scripts/native-harness/SilenceBoundaries.kt"
"$JAVACMD" -cp "$OUT:$CACHE/m2/kotlin-stdlib-2.1.20.jar" expo.modules.silencetrim.SilenceBoundaries
