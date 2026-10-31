#!/usr/bin/env bash
# Actual production MP4 reader + PCM scanner on generated 16/24-bit ALAC files.
# No Android install, network, Gradle, or native JNI emulation.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$ROOT/modules/silence-trim/tests"
CACHE="$ROOT/node_modules/.cache/native-harness"
WORK="$ROOT/.local-cache/silence-mp4-jvm"
FIXTURES="$ROOT/.local-cache/silence-mp4-fixtures"
SDK=${ANDROID_HOME:-/Users/apple/LocalWork/Codex/2026-06-08/ios-users-apple-documents-lama-1/work/android-sdk}
JDK=${JAVA_HOME:-/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home}
ANDROID_JAR=$(find "$SDK/platforms" -maxdepth 2 -name android.jar -print | sort -V | tail -1)
[ -n "$ANDROID_JAR" ] || { echo 'An existing Android SDK android.jar is required.' >&2; exit 2; }
[ -f "$CACHE/m2/kotlin-compiler-embeddable-2.1.20.jar" ] || { echo 'Run the existing extractor harness once to cache its compiler.' >&2; exit 2; }
[ -f "$FIXTURES/manifest.json" ] && [ -f "$FIXTURES/corrupt-stsz-count.m4a" ] || python3 "$HERE/generate-fixtures.py"
mkdir -p "$WORK/shim" "$WORK/classes"
CLASSPATH=$(find "$CACHE/m2" -maxdepth 1 -name '*.jar' -print | paste -sd: -)
"$JDK/bin/javac" -nowarn -d "$WORK/shim" -cp "$ANDROID_JAR" "$ROOT"/scripts/native-harness/shim/android/*/*.java
ANNOTATION_AAR=$(find "$HOME/.gradle/caches/modules-2/files-2.1/androidx.annotation/annotation-experimental" -name '*.aar' -print | sort -V | tail -1)
[ -n "$ANNOTATION_AAR" ] || { echo 'An existing annotation-experimental Gradle cache is required.' >&2; exit 2; }
unzip -p "$ANNOTATION_AAR" classes.jar > "$WORK/annotation-experimental.jar"
LIB="$WORK/shim:$CLASSPATH:$WORK/annotation-experimental.jar:$ANDROID_JAR"
"$JDK/bin/java" -cp "$CLASSPATH" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -cp "$LIB" -d "$WORK/classes" \
  "$ROOT/modules/silence-trim/android/src/main/java/expo/modules/silencetrim/Mp4AlacSource.kt" \
  "$ROOT/modules/silence-trim/android/src/main/java/expo/modules/silencetrim/PcmBoundaryScanner.kt" \
  "$HERE/Mp4AlacFixtureHarness.kt"
"$JDK/bin/java" -Xmx128m -cp "$WORK/classes:$LIB" expo.modules.silencetrim.Mp4AlacFixtureHarness "$FIXTURES"
