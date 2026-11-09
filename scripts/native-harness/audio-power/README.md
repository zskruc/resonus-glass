# Audio power regression

Run `bash scripts/native-harness/audio-power/run.sh` with JDK17 and `ANDROID_HOME`.
It reuses the existing native extractor harness compiler cache and the actual
Media3 version from expo-audio. A test-only coroutine-clock jar is cached locally
on first run. No production dependency is added.

The harness compiles the current production `PlaybackPowerPolicy.kt`,
`BaseAudioPlayer.kt` and `Playable.kt`. Only Expo's event boundary and ExoPlayer's
external interface are replaced. A virtual clock verifies ordinary background
versus precise/foreground notification rates, no paused/idle polling, immediate
seek/load/end/pause events and release cancellation. Separate policy cases check
local/current/next URI combinations, conservative unknowns and the single-item
offload gate. This does not prove a device supports or actually uses offload;
`powerStatus.offloadedPlayback` and `sleepingForOffload` report native callbacks.

The current Media3 version is1.9.0. Its compressed-offload/gapless-playlist issue
was fixed in1.9.3, so native offload is restricted to one non-repeating item and
disabled before another is queued, even when JS permits it. Sources:
[Media3 release notes](https://github.com/androidx/media/blob/release/RELEASENOTES.md#193-2026-03-13),
[Android offload guidance](https://developer.android.com/media/media3/exoplayer/battery-consumption).

Compiler output and caches stay under `.local-cache` or `node_modules/.cache`.
