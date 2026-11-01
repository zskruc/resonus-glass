#!/usr/bin/env bash
# Executes the installed production RNCMaskedView.java against small JVM hosts.
# The hosts model Android's retained disappearing children; they do not emulate GPU pixels.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$ROOT/scripts/native-harness/masked-view"
WORK="$ROOT/node_modules/.cache/native-harness/masked-view"
SOURCE=${MASKED_VIEW_SOURCE:-$ROOT/node_modules/@react-native-masked-view/masked-view/android/src/main/java/org/reactnative/maskedview/RNCMaskedView.java}
mkdir -p "$WORK"
if [ -n "${JAVA_HOME:-}" ]; then
  TASK_JAVAC="$JAVA_HOME/bin/javac"
  TASK_JAVA="$JAVA_HOME/bin/java"
else
  TASK_JAVAC=$(command -v javac)
  TASK_JAVA=$(command -v java)
fi
"$TASK_JAVAC" -d "$WORK" "$HERE"/stubs/android/content/*.java "$HERE"/stubs/android/graphics/*.java \
  "$HERE"/stubs/android/view/*.java "$HERE"/stubs/com/facebook/react/views/view/*.java "$SOURCE" "$HERE/Harness.java"
"$TASK_JAVA" -cp "$WORK" Harness
