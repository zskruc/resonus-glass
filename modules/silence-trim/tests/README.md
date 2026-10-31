# Local MP4 / ALAC regression fixtures

Run from the repository checkout:

```sh
python3 modules/silence-trim/tests/generate-fixtures.py
modules/silence-trim/tests/run-mp4-harness.sh
```

The generator creates deterministic test audio under
`.local-cache/silence-mp4-fixtures/`; no user's music, images, paths or credentials
are included. Four real ALAC M4As cover 16/24-bit samples, `moov` before/after
`mdat`, attached artwork, metadata and `free` padding. A separate AAC M4A is a
negative codec-identification fixture.

Each track is 60 seconds: 1.2 seconds of silence, a stereo tone with opposite
channel phase through 58 seconds, then 2 seconds of silence. FFprobe records
all compressed packet hashes/timestamps. FFmpeg independently decodes only the
first 3 and last 4 seconds to float PCM and verifies the 10 ms RMS boundaries.
These references and the fixture manifest remain in the local cache.

The JVM harness compiles the **actual production** `Mp4AlacSource.kt` and
`PcmBoundaryScanner.kt`. It verifies exact compressed sample bytes and original
timestamps, both metadata positions, ALAC cookie bit depth, precise random
access to the tail, low IO, early stopping, cancellation, invalid/oversized
inputs, forged `stsz`/`elst`/`stco` entry counts in otherwise small valid `moov`
boxes, recovery after a consumer failure, AAC rejection and the real PCM
boundary times. It uses the existing cached Media3/Kotlin jars, existing Gradle
annotation AAR and Android SDK shims; it does not download dependencies or
build/install an APK. The fixture JVM has a 128 MiB heap ceiling so a regression
in a malformed-count guard fails locally without attempting a huge allocation.

The Android ARM64 `AlacPcmInspector` JNI decoder cannot execute in this macOS
JVM. These tests verify its actual input packets and the production PCM scanner
against an independent lossless decoder; the integrated JNI path is checked by
Android compilation and subsequent on-device acceptance.
