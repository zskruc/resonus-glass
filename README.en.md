<p align="center">
  <img src="./assets/images/icon-transparent.png" width="100" alt="Resonus Glass icon" />
</p>

<h1 align="center">Resonus Glass</h1>

<p align="center"><a href="./README.md">简体中文</a> · <strong>English</strong></p>

<p align="center">An Android-focused Resonus derivative with a Liquid Glass interface</p>

Resonus Glass builds on [juananzzz/resonus](https://github.com/juananzzz/resonus), retaining its self-hosted music player features and adding native refractive glass, a coordinated mini player and bottom navigation, floating glass menus, and saved material profiles for Android.

This is an independently maintained, unofficial derivative. It is not affiliated with or endorsed by the upstream author, Apple, or Apple's music services. Glass is rendered natively on Android; it does not use Apple's private implementation or reproduce every internal iOS parameter. Development focuses on Android. Upstream's experimental iOS support is outside this branch's glass validation scope.

## Install

Download the **Resonus Glass APK** from [this repository's latest release](https://github.com/zskruc/resonus-glass/releases/latest). The `v0.8.4` file is `Resonus-Glass-v0.8.4-arm64-v8a.apk`, for ARM64 Android devices. APKs in the original project's releases are the original Resonus and do not include these changes.

Android 13 and later support native refraction and directional highlights. Android 12 uses GPU blur; earlier versions use a UI fallback. Appearance and smoothness depend on the device and system state.

With `RESONUS_GLASS_PREVIEW=1` enabled at build time, the app is named **Resonus Glass** and uses Android package `com.zskruc.resonus.glasspreview`. It can coexist with the original app. Their sign-in state and offline files are separate. Updating an existing Glass installation requires the same package name and signing key. Do not uninstall the app to work around a signature mismatch: uninstalling removes its local data.

In **Settings → About**, the GitHub link, release notes, and update check all use this repository. The update summary reads its release notes, and the APK comes from the same release. Update checks use published stable releases, excluding drafts and prereleases.

For independent testing, open **Actions → Glass ARM64 test APK → Run workflow**. Each run creates a random, disposable test signing key. Its APK cannot update an existing Glass installation and is not guaranteed to update an APK from an earlier CI run. Use a separate test device or emulator. Use explicitly identified APKs in Releases for normal installation.

## Glass features

- [AndroidLiquidGlass / Backdrop](https://github.com/Kyant0/AndroidLiquidGlass) provides shared background capture, refraction, blur, and edge highlights across controls.
- The mini player and bottom navigation fold and unfold together during page scrolling. Search stays separate on the right, and scrolling detail pages can also drive the dock.
- The mini player displays only the song title and supports bounded swipe-to-skip gestures. Its glass has no fixed color fill or tint derived from the current artwork.
- Floating song menus, playback speed, song information, and related dialogs share a rounded glass style.
- Independent material profiles and a saved tuning screen are provided for the mini player, navigation, and other controls.
- List, navigation, and menu capture, transitions, and animation lifecycles have been adjusted. System font weight settings are respected, and Simplified Chinese settings text has been expanded.
- Selected upstream fixes cover background recovery, playback progress, lyric ordering, search, complete-response network timeouts, and artwork URL privacy.

These features describe the released Glass baseline. Development previews may change materials and control implementations; see the version information below. Implementation details and limits are documented in the [Glass guide](./docs/LIQUID-GLASS-PREVIEW.md) and [native module README](./modules/liquid-glass/README.md). Original features and documentation are preserved in the [upstream README](./docs/UPSTREAM-README.md).

## Versions and upstream updates

| Channel | Version | Android version code | Availability |
| --- | --- | --- | --- |
| Stable | `0.8.4` | `67` | [GitHub Releases](https://github.com/zskruc/resonus-glass/releases/latest), in-app update checks |
| Development preview | `0.8.5.1-preview.2` | `124` | Local ARM64 APK, unpublished; [compact Home, artwork accents and settings rows](./docs/HOME-THEME-SETTINGS-PREVIEW-2.md) |

`.preview.2` reduces the Apple Music-style Home Discover cards, adds manual/current-artwork accent sources in settings, and aligns ordinary settings rows to a shared minimum height. Existing upstream fixes, player layout and glass profiles remain. See the [preview notes](./docs/HOME-THEME-SETTINGS-PREVIEW-2.md).

This preview adapts selected upstream playback-load priority, localized network errors, artist/album search grids, playlist membership management and external media skip commands. The last two come from main after the release. Existing layouts, glass profiles and the `.39` artist-image improvements are retained; this is not a complete upstream merge. See the [adaptation record](./docs/UPSTREAM-0.8.5-ADAPTATION-20261031.md) for validation and deferred changes.

The current preview updates artist navigation transitions and name artwork, Volta album actions and dock restoration. It also adds bulk artwork/lyrics caching and a download manager with overall/per-song progress, start/pause/cancel controls and 1–20 concurrent song downloads. Implementation limits, builds and device validation are recorded in the [preview notes](./docs/PREVIEW-35-36-CACHE-AND-DOWNLOADS.md).

`.32` adapts upstream #304, #302, #301 and #299, with additional ownership guards for playback and background warming. **Settings → Appearance → Album page style** selects **Volta / Minidisc** within Apple Music style, retaining Volta by default. Artist pages sample the original photo's scene corners and use a continuous static blur/fade. Player layout and stored glass parameters are retained. See the [adaptation and validation record](./docs/UPSTREAM-PR-ADAPTATION-20261031.md).

`.33` retains those changes and adds verified official artist-name artwork, local content verification for proxy images and offline caching. Ordinary names remain when no official wordmark is available. Ayano Tsuji references inform corrected photo framing, neutral-scene color and a longer single-mask fade, keeping title/control positions intact.

`.34` uses Samsung comparison findings to delay the sharp-to-blur handoff and reduce peak artist-photo blur, retaining the matched scene colors, framing, fade extent and other controls.

`.27` adds an optional [Volta](https://github.com/countervolts/Volta)-inspired **Apple Music style** under **Settings → Appearance → UI style**, alongside **Spotify style**. Home, Library, artist and album/playlist pages use alternate layouts while retaining the existing player, glass profiles and user data. See the [dual UI preview scope and validation](./docs/VOLTA-UI-PREVIEW.md). Earlier preview notes below remain development history.

The current preview is on `preview/compact-home-artwork-accent-20261031`. Its native player combines [AMLL](https://github.com/amll-dev/applemusic-like-lyrics)-derived controls and SVGs with independently implemented cover/lyric views and a moving artwork-field background. Settings → Player → Player layout restores the previous Resonus layout; the Player background option below applies only to that layout. See the [third-party notices](./THIRD_PARTY_NOTICES.md#amll-player-controls-and-artwork-background-reference) and [preview guide](./docs/AMLL-PLAYER-PREVIEW.md) for the controls/assets’ **AGPL-3.0-only** provenance, retained original licenses and implementation boundaries.

`.15` retains five changes from `.14`: remove the player/lyric top handle while retaining header space, pull-down dismissal and accessible closing on the artwork; remove shuffle/repeat buttons while leaving previous/play-pause/next in their original positions, with modes still in More; retain painted dock progress until its origin scope is restored and preserve the origin's selected-lens opacity; prepare word masks only for the current and next lyric rows, delaying next-row preparation by 720ms without changing blur, optics or lyric timing; show a complete saved playlist mirror while refreshing HTTP in the background, reuse offline metadata without duplicate SQL and limit local queries to the current playlist IDs. A first opening without saved data can still wait; instant loading is not guaranteed.

`.15` adds two corrections for mini-player return jitter: closing targets artwork at its resting position, excluding press/swipe deformation, and reversing an unfinished opening rebases its endpoints while retaining the currently painted pose. With marquee titles enabled, the mini title keeps the same Marquee component tree; covering it pauses an independent clock at its current position and returning resumes it, without replacing plain text and marquee components. Device confirmation remains pending.

The earlier `.2` opened on the large-cover view. Tapping the top handle, dragging down or using system Back dismisses the entire player; its last lyric frame remains visible while subsequent lyric animation stops. Portrait orders the three transport buttons, lyrics/output/queue and volume, with shuffle/repeat moved into an optional playback group in More options. Landscape keeps five transport buttons, with output at the lower left and lyrics/queue at the lower right. The AMLL play button loses its artwork-colored circle while progress and volume tracks retain artwork colors. The previous Resonus layout is unchanged.

`.3` reduces auxiliary glyphs such as lyrics, output and queue to 24dp while retaining 48dp touch targets. Tapping a synchronized lyric seeks there and starts playback. Lyrics keep Resonus's data sources and seeking behavior; the later `.4` shared blur and viewport budget are described below.

Global switches are about 16% smaller in a 54×44dp layout, retaining a 44dp touch height and leaving more horizontal room for settings text.

Settings → Glass tuning now supports independent AM++ parameters for the mini player, navigation and other controls, plus one-tap restoration and saving of all AM++ defaults. Existing Custom profiles remain separate. A dock fix clears inherited compact-icon offsets when switching among AM++, Kyant defaults, iPhone reference and Custom appearances. Earlier integration details remain in the [AM++ adaptation guide](./docs/AMPP-ADAPTATION.md).

This round ports the pinned Zennmn/AM-plus-plus page-input controller, collapse geometry, independent selected-lens content row and velocity/press deformation into the source. Playback, navigation and window interfaces are adapted to Resonus, with Custom and non-AM++ appearances retained. See the [AM++ source-port mapping](./docs/AMLL-PLAYER-PREVIEW.md#ampp-source-port) for the source files, hardware foreground recording and JSI bridge.

`.4` shares Resonus lyric blur/transitions across every player presentation with viewport-bounded filters, restores complete tab-tap press/travel/release motion and adds a custom Home heading under Appearance settings. Shared optical foreground/overlay resources run only during interaction; background capture excludes cached lenses and navigation discovery skips list content. Static thumbnails decode one frame, disk prefetch downloads files without creating animated drawables and cleans up requests, while artwork animation capability stays independent of playback/pause state.

The `.26` preview adapts the [LNPopupUI / LNPopupController](https://github.com/LeoNatan/LNPopupUI) presentation model: container, shared artwork and dock use coordinated progress, mini taps/upward intents snap open, and the full player drags down to complete or rebound. Settled player layout and all glass profiles remain, along with endpoint and route-handoff safeguards. This Android implementation includes no UIKit portals/native glass and claims no frame identity; Samsung upward-open, close/cancel and return checks have passed within the captured scope; they do not establish sustained frame rates or long-session acceptance. See [LNPopup presentation](./docs/LNPOPUP-TRANSITION.md) for scope/attribution and [earlier transition records](./docs/APPLE-MUSIC-TRANSITION.md) for history.

The layout follows the user's Samsung Apple Music reference: paused artwork scales to 0.85, readable white SVG controls accompany a favorite star and More entry beside track information, and the current transport shows only previous/play-pause/next in their original positions with short press/release feedback. Progress and volume tracks retain artwork colors. Private reference screenshots are not published.

UI-thread tab-tap feedback, the stable list callback-ref correction and unified floating glass panels remain. See the [panel scope](./docs/UNIFIED-GLASS-PANELS.md) and the earlier [transition research/rollback record](./docs/PLAYER-MINI-TRANSITIONS.md).

`.14` is installed on Samsung. The top handle and transport shuffle/repeat buttons were confirmed removed; cached AllMusic promptly displayed track rows in this run. No valid older-build comparison or rigorous tap-to-content timing was obtained. The user still rejects jitter when returning to the mini player, so that issue is not accepted as fixed. The `.15` ARM64 APK is built with the original signature verified. All 558 app tests, 125 native tests, typechecking and translation checks pass; lint reports zero errors and 117 warnings. It will not be installed until the user reconnects for appearance and sustained-behavior checks.

Historically, `.13` was installed and basic visual checks observed shared-artwork resizing/landing, full entry, short-pull cancellation, long-pull dismissal, lyric switching, lyric-header return and synchronized Mini/Tabs reveal, without a new crash during those checks. This is not `.15` acceptance or evidence of sustained frame rate, long-list behavior or long-term stability. See the [playlist performance record](./docs/PLAYLIST-SCROLL-PERFORMANCE.md) for evidence and limits. A 120Hz request, draw count or passing tests does not guarantee constant 120 fps. The artwork background retains an independent approximately 60 fps maximum work budget; this preview is not a stable release.

When the artwork palette is enabled in the previous Resonus layout, the play/pause button uses the same immediate current-artwork role as the progress and volume tracks; its background palette retains a separate stability wait and transition. AMLL uses its own native artwork field and a play button without a persistent circle, while keeping artwork-colored tracks.

Playback track colors now commit immediately, with bounded foreground warmup of adjacent artwork. Cached colors update on track change; unread artwork still requires image access and uses a neutral placeholder rather than the previous song's color.

The current revision restores the original action-button appearance and colors playback progress/volume tracks from artwork, while retaining LiquidToggle, LiquidSlider gestures, the AM++ dock, popup materials and refresh/rendering optimizations.

This preview also adds floating-popup glass recipes, a tappable quality card, real system output controls, hardware-synchronized media volume, and an optional full-player artwork palette. Find the options under Settings → Player → AM++ player features. Artwork colors default to Off and never recolor the mini player or tabs. An unavailable system output switcher explicitly falls back to the system volume panel.

The visible version follows the latest reviewed upstream stable baseline. Glass selectively ports changes: it **is not the complete upstream 0.8.4** and does not include all of that release's new features. Consult the [Glass changelog](./CHANGELOG.md) and [upstream fix scope](./docs/LIQUID-GLASS-PREVIEW.md#上游修复范围) for the changes included here.

Further Glass changes within the same upstream baseline can use a fourth version component, such as `0.8.4.1`; a subsequent upstream baseline uses `0.8.5`. For a stable release, the app version, Git tag, and release version match, and Android `versionCode` must increase for each release. Matching visible versions do not make the original and Glass APKs interchangeable.

The `glass` branch preserves this project's customizations. [juananzzz/resonus](https://github.com/juananzzz/resonus) remains the upstream source; changes are compared and validated before suitable fixes are integrated. Automatically fetching upstream commits does not guarantee automatic conflict resolution or compatibility with custom glass interactions. See the [upstream maintenance guide](./docs/UPSTREAM.md) for the review and checking process.

Settings → Glass tuning still lets you compare AM++ reference, Kyant defaults and existing custom profiles. The previous defaults preview remains on `preview/kyant-defaults`.

## Build Android from source

Use **Node.js 24, pnpm 11, Java 17, Android SDK Platform 36**, and Android build tools. This project uses **Expo SDK 57**; `package.json` and `pnpm-lock.yaml` are the source of truth for dependency versions. Expo Go cannot load this project's local native modules.

```bash
git clone https://github.com/zskruc/resonus-glass.git
cd resonus-glass
git switch glass
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm i18n:check
```

Set `ANDROID_HOME` to your Android SDK and `JAVA_HOME` to Java 17, then build the ARM64 APK:

```bash
export RESONUS_GLASS_PREVIEW=1
bash scripts/build-glass-preview.sh
```

The script regenerates the Android project and writes `artifacts/Resonus-Glass-preview.apk`. Local signing depends on your Android build configuration; the release signing key is not included in this repository. Keep Expo-generated directories, dependencies, caches, APKs, and private configuration out of Git. See the [release guide](./RELEASING.md) for local signing, package verification, and GitHub Releases.

To reuse a local signing key, configure `RESONUS_KEYSTORE_FILE`, `RESONUS_KEYSTORE_PASSWORD`, `RESONUS_KEY_ALIAS`, and `RESONUS_KEY_PASSWORD` in `.local-signing/env.sh`. The build script reads this local file. The entire `.local-signing/` directory is excluded from Git.

## Documentation and feedback

This project provides a complete [Chinese README](./README.md) and [English README](./README.en.md). The technical documents below currently retain their existing languages.

| Topic | Link |
| --- | --- |
| Changes and APKs | [Changelog](./CHANGELOG.md) · [Releases](https://github.com/zskruc/resonus-glass/releases) |
| Features and validation scope | [Glass guide](./docs/LIQUID-GLASS-PREVIEW.md) |
| AMLL player preview | [Layout, background and validation boundaries](./docs/AMLL-PLAYER-PREVIEW.md) |
| Apple Music transition | [Shared artwork, independent background and source-screen depth](./docs/APPLE-MUSIC-TRANSITION.md) |
| Playlist performance | [Evidence, changes and pending acceptance](./docs/PLAYLIST-SCROLL-PERFORMANCE.md) |
| Native material implementation | [Liquid Glass module](./modules/liquid-glass/README.md) |
| Upstream update process | [Upstream maintenance](./docs/UPSTREAM.md) |
| Signing and publishing | [Release guide](./RELEASING.md) |
| Original project features | [Upstream README](./docs/UPSTREAM-README.md) |
| UI translations | [Translation guide](./TRANSLATING.md) |

Report issues and suggestions in [this repository's Issues](https://github.com/zskruc/resonus-glass/issues), in Chinese or English. Include the Glass version, device and Android version, reproduction steps, and whether the problem occurs only in this derivative. Report issues caused by Glass customizations here.

## License and acknowledgements

- [Resonus](https://github.com/juananzzz/resonus): original author **juananzzz** and upstream contributors. Original sources retain **GPL-3.0-or-later** and the root [LICENSE](./LICENSE) is unchanged. The preview’s added AGPL-derived controls are described below and in the third-party notices. You can support the original author on [Ko-fi](https://ko-fi.com/juananzzz).
- [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass): **Apache-2.0**. Native materials use Backdrop 1.0.0 and adapt its Bottom Tabs example; see the [license](./modules/liquid-glass/ANDROID_LIQUID_GLASS_LICENSE).
- [sdegenaar/liquid_glass_widgets](https://github.com/sdegenaar/liquid_glass_widgets): **MIT**, Copyright © 2024–2026 Sebastian Degenaar. Its coordinated layout and minimize controller informed this adaptation. The Flutter engine is not included; see the [license](./modules/liquid-glass/LIQUID_GLASS_WIDGETS_LICENSE).
- Primuse: parts of the lyrics animation implementation follow **MIT**; see [third-party notices](./THIRD_PARTY_NOTICES.md).
- [f728743/AppleMusicStylePlayer](https://github.com/f728743/AppleMusicStylePlayer): **MIT**, Copyright © 2025 Alexey Vorobyov. Shared-artwork motion, background outline and pull-down rules are adapted; see the [complete license](./licenses/APPLE-MUSIC-STYLE-PLAYER-MIT.txt) and [implementation scope](./docs/APPLE-MUSIC-TRANSITION.md).
- [LNPopupController](https://github.com/LeoNatan/LNPopupController): **MIT**, Copyright © 2015-2025 Léo Natan; [complete license](./licenses/LNPOPUPCONTROLLER-MIT.txt) and [adaptation scope](./docs/LNPOPUP-TRANSITION.md).
- [AMLL](https://github.com/amll-dev/applemusic-like-lyrics): native controls and selected SVGs derive from a pinned source and retain **AGPL-3.0-only**; see the [complete license](./licenses/AMLL-AGPL-3.0.txt) and [file provenance / combined-distribution requirements](./THIRD_PARTY_NOTICES.md#amll-player-controls-and-artwork-background-reference). The artwork field is independently implemented without its web runtime, shaders or animation engine. Icon provenance is not represented as Apple permission.

The original project icons, other dependencies, and existing third-party notices retain their respective rights and licenses.
