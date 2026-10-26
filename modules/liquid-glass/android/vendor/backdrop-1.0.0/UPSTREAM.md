# Backdrop 1.0.0: bounded material backing

This directory replaces the previous `io.github.kyant0:backdrop:1.0.0` binary
with its source, so the same renderer can accept an optional backing capacity.
It does **not** upgrade to Backdrop 2.x.

The original 27 files under `src/main` were copied from
[Kyant0/AndroidLiquidGlass tag 1.0.0](https://github.com/Kyant0/AndroidLiquidGlass/tree/1.0.0/backdrop/src/main),
commit `eada9a8600142c1bd6a5c5fc143d06f599cdfaef`. Copyright 2025 Kyant;
Apache-2.0, with the complete original license retained in [LICENSE](./LICENSE).
All original shader strings, effects, highlight, shadow, outline and default
parameters remain unchanged.

The modified original file `DrawBackdropModifier.kt` backports the
minimum-layer-size and optional clip-compositing additions from
[Zennmn/AM-plus-plus](https://github.com/Zennmn/AM-plus-plus/blob/36dd119950b001883d3e31e17586f545d404a7c1/backdrop/src/commonMain/kotlin/com/kyant/backdrop/DrawBackdropModifier.kt),
commit `36dd119950b001883d3e31e17586f545d404a7c1`. Its AM++ additions are GPL-3.0;
the complete license is retained in [AMPP-LICENSE](./AMPP-LICENSE). Resonus is
distributed under GPLv3. The original Apache-2.0 portions retain their license.

The backport adds two optional parameters, `minLayerSize` and
`clipCompositingStrategy`. Defaults remain zero capacity and offscreen clipping.
While an AM++ dock collapses or expands, physical effect layers reserve the
expanded frame, source gap/rebound room and pre-lens blur padding. Both settled
endpoints return to their actual allocation. Layout, clipping outlines, input
bounds and lens uniforms continue to use the changing logical size. A source
callback temporarily sees the original padded logical size, and its drawing
context is restored in `finally`; extra backing pixels are clipped away.

Resonus additionally adapts `shadow/ShadowModifier.kt` and
`highlight/HighlightModifier.kt` to the same optional physical-capacity contract.
These are original Resonus additions, rather than a claim that AM++ already
extends those two decorators. Their shape outlines and highlight shader uniforms
are computed from the live logical size before recording. Shadow radius, offset,
color, alpha, blur mask and highlight parameters remain unchanged. The shadow
reservation includes the original asymmetric radius/offset margins; highlight
keeps the original one-pixel guard. Drawing clips to each original logical layer
extent, leaving extra capacity transparent, and restores the drawing context in
`finally`. Zero capacity retains the original path. Both decorators receive
nonzero capacity only from the same AM++ motion-only caller and release it at
the two endpoints. These capacity additions are distributed under GPLv3 with
Resonus; all original Apache-2.0 portions retain their license.

Resonus keeps 1.0.0's existing invalidation policy and explicitly invalidates
placement when the new clip strategy changes. `BackdropLayerSize.kt` extracts
the unchanged padding, shadow/highlight extents and physical maximum into pure
functions used by unit tests. Tests also cover live outline/clip bounds and
draw-context restoration after interrupted/nested recording. The other 24
original source/manifest files remain byte-for-byte unchanged.
`AmPlusMaterialCapacity.kt` in the host module
adapts the same pinned source's `LiquidBottomTabs.kt`, `GlassNavigation.kt` and
`PhoneGlassSession.kt` expanded-capacity policy to fixed React Native hosts.
Other glass modes and materials retain their original allocation and clipping.

No vibrancy/blur effect-prefix cache, frame-rate limit, sampling resolution,
shader uniform or user tuning value is changed by this backport. Compose 1.9.4
and Android SDK 36 remain the module's supported baseline.
