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

## AM++ phone dock geometry and motion

The optional AM++ reference appearance adapts phone mini-player/navigation
geometry, spring rebound, content cross-fades and capsule material rules from
[Kifranei/AM-plus-plus](https://github.com/Kifranei/AM-plus-plus), commit
`97fa2e4efc9ec7476daca383221f55b5d10f847c`, forked from Zennmn/AM-plus-plus.
Those AM++ changes are licensed under GPL-3.0, compatible with this project's
GPL-3.0-or-later distribution under GPLv3; see LICENSE. Original Kyant
Backdrop/catalog code remains Apache-2.0, with its existing notices retained.

Adapted files: AM++ GlassPolicy.kt, GlassBarCollapse.kt, GlassBarCollapseLayout.kt,
NativeLiquidButton.kt and LiquidBottomTabs.kt; integration and control ownership
are implemented for Resonus rather than Apple Music/Xposed. No Apple image
resources or AMLL tablet-media implementation is included in this adaptation.

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
