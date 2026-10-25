#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_root"

# Optional machine-local signing configuration. Never commit keys or passwords.
if [[ -f "$project_root/.local-signing/env.sh" ]]; then
  source "$project_root/.local-signing/env.sh"
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  printf '%s\n' 'Set ANDROID_HOME to your local Android SDK before building.' >&2
  exit 1
fi
if [[ -z "${JAVA_HOME:-}" ]] && [[ -x /usr/libexec/java_home ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
fi
export RESONUS_GLASS_PREVIEW=1

pnpm install --frozen-lockfile
pnpm typecheck
pnpm i18n:check
pnpm expo prebuild --platform android --no-install

(
  cd android
  ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
)
mkdir -p artifacts
cp android/app/build/outputs/apk/release/app-release.apk artifacts/Resonus-Glass-preview.apk
printf '%s\n' "Preview APK: $project_root/artifacts/Resonus-Glass-preview.apk"
