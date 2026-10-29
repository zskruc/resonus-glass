# Third-party notices

## Primuse lyric motion and depth effect

The word-level lyric sweep and bounce in `src/components/KaraokeWords.tsx`,
and the inactive-line blur policy in `src/lib/lyricMotion.ts`, are adapted
from the Primuse project:

Copyright (c) 2026 Welape

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## AM++ phone dock input, geometry and selected material

The optional AM++ reference appearance adapts phone mini-player/navigation
geometry, spring rebound, content cross-fades and capsule material rules from
[Zennmn/AM-plus-plus](https://github.com/Zennmn/AM-plus-plus), commit
`36dd119950b001883d3e31e17586f545d404a7c1`. The earlier adaptation used
[Kifranei/AM-plus-plus](https://github.com/Kifranei/AM-plus-plus), commit
`97fa2e4efc9ec7476daca383221f55b5d10f847c`.
Those AM++ changes are licensed under GPL-3.0, compatible with this project's
GPL-3.0-or-later distribution under GPLv3; see LICENSE. Original Kyant
Backdrop/catalog code remains Apache-2.0, with its existing notices retained.

Ported files include GlassBarCollapse.kt, GlassBarCollapseLayout.kt,
GlassTabGeometry.kt, GlassScrollCollapse.kt and GlassTouchCollapseTracker.kt,
with their source regression tests. GlassBarCollapseInput/Controller's page,
boundary, velocity and fling ownership is adapted in AmPlusDockScrollInput.kt.
NativeLiquidButton.kt, GlassNavigation.kt and LiquidBottomTabs.kt supply the
native material/refraction-row adaptation; integration and control ownership
are implemented for Resonus rather than Apple Music/Xposed. No Apple image
resources or AMLL tablet-media implementation is included in this adaptation.

Source-to-integration mapping at the pinned Zennmn commit:

| Source | Integration in this repository |
| --- | --- |
| `app/.../GlassBarCollapseInput.kt` and `GlassBarCollapseController.kt` | `modules/liquid-glass/.../AmPlusDockScrollInput.kt` adapts window/page ownership, scroll boundaries and fling intent. `TabsMotionHosts.kt`, `LiquidGlassModule.kt`, `modules/liquid-glass/index.tsx` and `src/hooks/useLiquidDock.tsx` connect these decisions to Resonus's shared UI-thread spring through scalar JSI calls. |
| `app/.../GlassScrollCollapse.kt` and `GlassTouchCollapseTracker.kt` | Native policies with the same file names retain the source's signed accumulator, axis/slop tracking, reversal and release-velocity behavior. |
| `glass/.../GlassBarCollapse.kt`, `GlassBarCollapseLayout.kt` and `GlassTabGeometry.kt` | Native policies with the same file names and `AmPlusDockGeometry.kt` map the source's continuous capsule, mini-player, search and tab geometry onto Resonus views. |
| `glass/.../LiquidBottomTabs.kt` | `LiquidBottomTabsMaterial.kt` and `AmPlusSelectionMotion.kt` adapt the independent refraction row and velocity × press deformation. `AmPlusTabForeground.kt` records real RN labels/glyphs; `AmPlusSelectionOverlay.kt` draws the selected lens after that visible row. |
| `backdrop/.../ViewBackdrop.kt` | The hardware foreground bridge in `AmPlusTabForeground.kt` follows the source's `RenderNode` recording approach. The original Kyant/Backdrop portions remain Apache-2.0, including the upstream `65ab177e90e5c1d8c62e70cf7755841982da65f6` attribution retained by AM++. AM++ additions retain their GPL-3.0 attribution. See the retained [AndroidLiquidGlass license](./modules/liquid-glass/ANDROID_LIQUID_GLASS_LICENSE). |

Native destination files above are under
`modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/`.
Host playback, navigation, window observation and event ownership are adapted
to Resonus. Existing Custom parameters and non-AM++ appearances remain in use.
This is a source adaptation, not execution of the complete Xposed module,
Apple Music host or Apple resource bundle. AM++ lyric blur was not ported;
the existing Resonus/Primuse-derived lyric treatment remains in use.

## AM++ media companion and full-player palette

Floating popup recipes in `src/theme/playerGlassRecipes.ts` and the native
media popup/menu material variants, plus
`modules/media-controls/android/src/main/java/expo/modules/mediacontrols/SystemAudioOutput.kt`,
are adapted from [Kifranei/AM-plus-plus-media-plugin](https://github.com/Kifranei/AM-plus-plus-media-plugin),
commit `b9e043c10ee8bdba62f155acba296be566b9b71d` (GPL-3.0).
Resonus implements its own playback integration, system-volume lifecycle and
quality card. The light popup fill follows the current theme rather than the
reference plugin's always-dark popup host. No Apple speaker/AirPods images,
Apple Music code, Xposed hooks or companion resource bundles are copied.

The optional full-player Oklab roles and stable-artwork timing in
`src/lib/playerPalette.ts` are adapted from
[Kifranei/AM-plus-plus-monet-plugin](https://github.com/Kifranei/AM-plus-plus-monet-plugin),
commit `0408c9f9dc7d6f4f893e22f847f60dc443cf9f70` (GPL-3.0).
Oklab conversion credits Björn Ottosson's public-domain reference. Resonus
reuses its existing cover-color extraction; it does not duplicate the plugin's
24×24 quantizer, resource hooks or global theme injection. These additions are
distributed under GPLv3 with the rest of this GPL-3.0-or-later project; see LICENSE.

## AMLL player controls and artwork-background reference

The player control adaptation uses
[amll-dev/applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics),
pinned commit [`5fee356362353dbb24ce9bea3a62536478040de7`](https://github.com/amll-dev/applemusic-like-lyrics/tree/5fee356362353dbb24ce9bea3a62536478040de7).
`packages/react-full/package.json` declares **AGPL-3.0-only**. No separate
MIT/Apache license for this package or its bundled control SVGs was found.
The complete upstream license is retained in
[licenses/AMLL-AGPL-3.0.txt](./licenses/AMLL-AGPL-3.0.txt).

The following native portions are adaptations of that AGPL source:

- `src/components/AmllPlayerControls.tsx` and `src/lib/amllPlayerControls.ts`:
  `PrebuiltLyricPlayer/index.tsx`, `PrebuiltLyricPlayer/index.module.css`,
  `MediaButton/index.tsx` and CSS,
  `ToggleIconButton/index.tsx` and CSS, `MenuButton/index.tsx` and CSS, and the
  horizontal layout's footer ordering. Original copyright remains with the
  AMLL contributors.
- `assets/amll-controls/`: the selected upstream transport, shuffle/repeat,
  lyrics, queue, output and More SVGs. `PROVENANCE.json` records each exact
  source path, fixed commit, original SHA-256 and adapted SHA-256.

SVG provenance is limited to the files published by AMLL: its source and the
original toggle-icon addition commit
[`208ac5124022ff4c61348472bbeb158770919826`](https://github.com/amll-dev/applemusic-like-lyrics/commit/208ac5124022ff4c61348472bbeb158770919826)
(Steve-xmh, 2024-09-11) contain no separate icon attribution/license or Apple/SF
export metadata. Their original drawing/font source has not been independently
established. The package's AGPL declaration is not represented as an Apple
permission or a new license for Apple's SF Symbols. No Apple symbol package,
font or private asset archive was imported.

The AGPL-derived portions retain AGPL-3.0-only. Resonus's existing sources retain
their GPL-3.0-or-later notices and the root LICENSE is preserved. Combining the
GPLv3 and AGPLv3 portions uses their section 13 permission; the combination must
satisfy the AGPL's source-availability requirements, including its network-use
requirement where applicable. Distributions of this combined preview must
provide the complete corresponding source and both applicable license texts;
this notice does not relicense the remaining original Resonus code.

Native adaptation boundaries:

- Existing Resonus playback, queue, lyrics and output callbacks remain in use;
  AMLL's web runtime and playback/state-management dependencies are not embedded.
- Expo Image's existing AndroidSVG support draws the original SVG paths; no
  WebView, icon-font substitution or full upstream asset/source tree is added.
  The static native assets replace only `currentColor` paint values with
  `#FFFFFF`, since Expo Image's Android SVG tint adapter does not replace that
  paint type. Existing explicit white paint, path geometry, viewBox, transparent
  areas and fill/clip rules remain unchanged; the controls need no runtime tint.
- Control sizing and spacing retain the compact Resonus layout rather than the
  upstream desktop CSS scales. SVG whitespace is accounted for so phone skip
  arrows are about 36dp, play about 46dp, modes about 22–28dp and utility artwork
  about 24dp. Selected plates retain the actual upstream cutout artwork.
- Short native press/release feedback uses 80/140ms timing, with callbacks
  dispatched immediately on the confirmed press. The source's long click bounce
  and skip-arrow entrance animation are not included. Reduced-motion preferences
  are respected and stale/inactive control callbacks are rejected.
- Hit targets are at least 44dp and very narrow rows can scroll. Earlier
  previews deliberately used a requested five-button portrait arrangement,
  differing from upstream; that arrangement is historical. The current `.15`
  retains `.14`'s three transport buttons in portrait and landscape, with
  shuffle/repeat modes available in More. Native seek/system-volume slots and
  accessibility text sizing remain Resonus integrations.

The artwork field and the other previously reviewed native player components
were visually informed by the same project's layouts and Mesh treatment. Their
independently written native implementation does not import AMLL's renderer,
shader, control-point preset arrays or lyric animation engine. This paragraph
does not apply to the newly adapted control files/assets listed above.

Source boundaries and preview validation are documented in
[AMLL player preview](./docs/AMLL-PLAYER-PREVIEW.md). This adaptation does not imply
AMLL or Apple endorsement, or use of Apple's private rendering implementation.

## AppleMusicStylePlayer artwork transition

The optional mini-player/full-player transition adapts geometry and gesture
rules from [f728743/AppleMusicStylePlayer](https://github.com/f728743/AppleMusicStylePlayer),
pinned commit [`a0b5631417dec05d092c3c61df4679ed361743bf`](https://github.com/f728743/AppleMusicStylePlayer/tree/a0b5631417dec05d092c3c61df4679ed361743bf).
Copyright (c) 2025 Alexey Vorobyov. The complete upstream MIT license is retained
unchanged in [licenses/APPLE-MUSIC-STYLE-PLAYER-MIT.txt](./licenses/APPLE-MUSIC-STYLE-PLAYER-MIT.txt).

`ExpandableNowPlaying.swift`, `CompactNowPlaying.swift`,
`RegularNowPlaying.swift` and `NowPlayingBackground.swift` inform
`src/lib/appleMusicPlayerTransition.ts`, `src/hooks/useAppleMusicPlayerMotion.ts`,
`src/components/PlayerArtworkOverlay.tsx` and
`src/components/PlayerUnderlayTransform.tsx`, with integration into the existing
mini/player route lifecycle. The adaptation uses one artwork overlay between
measured endpoints, an independently clipped fixed-layout background and the
source's 300ms/no-extra-bounce intent. Reanimated's critically damped timing is
an approximation of SwiftUI smooth, not the same solver. Source window-depth
geometry is applied only to the originating screen, not the entire navigation
Stack or the player. The native background-only clip container is a Resonus
integration; it imports no SwiftUI/UIKit runtime or private display API.

The existing upward pull from mini-player is a Resonus extension, not a feature
claimed from this demo. Primuse's rejected whole-player transition remains
removed. These MIT portions do not change the separate AGPL/GPL notices for
the existing controls, glass and lyrics. Scope and pending preview validation:
[Apple Music transition](./docs/APPLE-MUSIC-TRANSITION.md).

## LNPopupUI / LNPopupController presentation adaptation

The `.25` Android player presentation adapts the open/close geometry, content
phases and Automatic interaction model of [LeoNatan/LNPopupController](https://github.com/LeoNatan/LNPopupController),
pinned commit [`2e20c7e1bc8990d58d81c74b8a17df9b5b433a1a`](https://github.com/LeoNatan/LNPopupController/tree/2e20c7e1bc8990d58d81c74b8a17df9b5b433a1a).
It was evaluated through [LNPopupUI](https://github.com/LeoNatan/LNPopupUI), its
SwiftUI wrapper at `60853564423524c9ed15cc74c5969d3e1ca666f1`.
Copyright (c) 2015-2025 Léo Natan. The complete upstream MIT license is retained
unchanged in [licenses/LNPOPUPCONTROLLER-MIT.txt](./licenses/LNPOPUPCONTROLLER-MIT.txt).

`Private/LNPopupController.mm` and `Private/TransitionAnimators/` inform the
new LNPopup helpers in `src/lib/appleMusicPlayerTransition.ts`, the shared
presentation progress in `src/hooks/useAppleMusicPlayerMotion.ts`, the parent
header gesture and Mini Player's upward Snap. Geometry helpers from the earlier
AppleMusicStylePlayer adaptation remain attributed above. Full-layout content
and its independently retained background share native clipping bounds; artwork
keeps one measured overlay and the existing atomic endpoint handoff. Optical
profiles and settled player layout are unchanged. Android Reanimated approximates
the 500ms spring intent and maps keyframe phases onto reversible progress; no
UIKit runtime, private portal view or Apple glass implementation is imported.
See [the LNPopup preview scope](./docs/LNPOPUP-TRANSITION.md) for limitations.

## Expo Image static artwork and disk prefetch patch

`patches/expo-image@57.0.3.patch` modifies Expo Image 57.0.3, using the existing Glide bitmap decoders and pool ownership for opt-in first-frame artwork. It separates static and animated cache keys, makes disk-only prefetch download data without a drawable, clears completed/cancelled targets and makes animation starts idempotent. The preview builds `expo-image` from source so the patch is included. Expo Image and the modified files retain the following MIT terms:

The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Backdrop source capacity backport and FlashList

The preview builds the original Backdrop 1.0.0 source with the pinned AM++
minimum-layer-size and clip-compositing backport. Original Apache-2.0 source,
GPL-3.0 additions, exact commits, modified-file boundaries and complete licenses
are retained in the [vendor provenance](./modules/liquid-glass/android/vendor/backdrop-1.0.0/UPSTREAM.md).

Song-list recycling uses [Shopify FlashList](https://github.com/Shopify/flash-list),
version 2.0.2, distributed under the following MIT license retained from that package:

```text
Copyright 2022-present, Shopify Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
