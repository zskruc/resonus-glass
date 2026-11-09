#!/usr/bin/env bash
# Real production policy and BaseAudioPlayer, deterministic coroutine clock.
# Test-only Expo event boundary + ExoPlayer proxy; no APK/emulator/device.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
CACHE="$ROOT/node_modules/.cache/native-harness"
HERE="$ROOT/scripts/native-harness/audio-power"
OUT="$ROOT/.local-cache/audio-power-321/jvm"
AUDIO="$ROOT/node_modules/expo-audio/android/src/main/java/expo/modules/audio"
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
JAVACMD="${JAVA_HOME:+$JAVA_HOME/bin/}java"
[ -f "$CACHE/m2/kotlin-compiler-embeddable-2.1.20.jar" ] || { echo 'Run the existing extractor harness to prepare the Kotlin compiler cache.' >&2; exit 2; }
mkdir -p "$OUT"
TEST="$CACHE/m2/kotlinx-coroutines-test-jvm-1.8.0.jar"
if [ ! -f "$TEST" ]; then
  curl -fsSL 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-test-jvm/1.8.0/kotlinx-coroutines-test-jvm-1.8.0.jar' -o "$TEST.tmp"
  mv "$TEST.tmp" "$TEST"
fi
MEDIA3=$(sed -n 's/.*androidxMedia3Version = "\(.*\)".*/\1/p' "$ROOT/node_modules/expo-audio/android/build.gradle")
for MODULE in common exoplayer; do
  JAR="$OUT/media3-$MODULE-$MEDIA3.jar"
  if [ ! -f "$JAR" ]; then
    AAR=$(find "$HOME/.gradle/caches/modules-2/files-2.1/androidx.media3/media3-$MODULE/$MEDIA3" -name '*.aar' -print -quit)
    [ -n "$AAR" ] || { echo "Compile the expo-audio module to cache Media3 $MEDIA3 first." >&2; exit 2; }
    unzip -p "$AAR" classes.jar > "$JAR"
  fi
done
ANDROID_JAR=$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)
LIBS=$(find "$CACHE/m2" -maxdepth 1 -name '*.jar' -print | paste -sd: -)
mkdir -p "$OUT/shim"
"${JAVA_HOME:+$JAVA_HOME/bin/}javac" -d "$OUT/shim" "$HERE/Build.java"
CP="$OUT/shim:$OUT/media3-common-$MEDIA3.jar:$OUT/media3-exoplayer-$MEDIA3.jar:$LIBS:$ANDROID_JAR"
rm -rf "$OUT/classes"
mkdir -p "$OUT/classes"
"$JAVACMD" -cp "$LIBS" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$CP" -d "$OUT/classes" \
  "$AUDIO/PlaybackPowerPolicy.kt" "$AUDIO/BaseAudioPlayer.kt" "$AUDIO/Playable.kt" \
  "$HERE/AppContext.kt" "$HERE/SharedRef.kt" "$HERE/AudioPowerHarness.kt"
"$JAVACMD" -cp "$OUT/classes:$CP" expo.modules.audio.AudioPowerHarnessKt
