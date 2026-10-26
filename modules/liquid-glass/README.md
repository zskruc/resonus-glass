# Resonus Liquid Glass (Android)

Local Expo Modules API view using [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass), pinned to Backdrop 1.0.0. Its original source is vendored in [`android/vendor/backdrop-1.0.0`](./android/vendor/backdrop-1.0.0/UPSTREAM.md) with the AM++ minimum-backing-capacity extension and Resonus's matching shadow/highlight capacity adaptation; all original shaders, optics and defaults are retained.

## Integration

```tsx
import { LiquidGlassView, isLiquidGlassAvailable } from '../../modules/liquid-glass';

<View collapsable={false} style={styles.control}>
  {isLiquidGlassAvailable && (
    <LiquidGlassView
      style={StyleSheet.absoluteFill}
      radius={24}
      blur={14}
      refraction={18}
      tintColor="#111827"
      tintOpacity={0.18}
      dark
    />
  )}
  <Pressable onPress={onPress}>{children}</Pressable>
</View>
```

`LiquidGlassView` is a decorative background, with no children or touch handling. Keep it directly inside a non-collapsible wrapper, behind the React Native control. Set opaque/frosted fallback styling in the wrapper for unsupported platforms, Expo Go, and Android versions below 12.

The overall `radius` defaults to 0 to preserve originally square controls.
The mini-player wrapper always passes transparent RGBA with zero tint opacity,
independent of the current song, appearance mode or saved legacy tint. This
also remains transparent while a native frame is unavailable or mini blur is
disabled. Its fallback has no color fill. Lens, highlights and saved blur are
retained; page colors remain visible through the glass.
`radiusTopLeft`, `radiusTopRight`, `radiusBottomLeft`, and `radiusBottomRight`
accept physical corner radii; missing or null values inherit `radius`. This
allows sheets to retain only their original top corners. Set the material's
`tintColor` from the original fill; its RGBA alpha is multiplied by
`tintOpacity`. Native glass adds a subtle 0.4dp directional highlight and no
extra white wash, border, or gradient overlay.

`progressiveBlur` selects the bottom scroll-edge material instead of a glass capsule. When the edge is visible, the existing capture RenderNode applies one Gaussian blur and background tint from the submitted edge top downward, preserving raw content above it. The graph runs at the shared capture's resolution (at most 480 pixels wide), rather than the phone's physical resolution. Capsules sample this processed background. The edge displays it through a cached BitmapShader/LinearGradient ComposeShader with DST_IN alpha, directly over the live page. Strict clipping to both the current child and submitted edge bounds prevents capture padding or old larger frames from spilling into the page. The alpha ramp starts transparently at their intersection, so a collapsing child cannot cut into the nonzero middle of a late frame’s mask. The transparent transition never copies sharp pixels from an older capture over live scrolling content. The quantized capture buffer is filled with opaque theme background before recording a progressive scene; unused rows cannot reduce Gaussian alpha and restore sharp raw content at the bottom. Producer blur and tint remain clamped at full strength below the edge, including the sample padding. Ordinary captures still clear to transparent. It adds no second blur or offscreen material layer, and omits lens, vibrancy, highlights and shadows. It follows [Kyant's alpha-masked progressive blur example](https://github.com/Kyant0/AndroidLiquidGlass/blob/kmp/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/destinations/ProgressiveBlurContent.kt), using API 31 RenderEffect plus public shader blending so Android 12 also supports it. This is a gradual alpha blend between live sharp content and sampled blur, rather than a different Gaussian radius at each pixel. Producer graphs are cached by capture dimensions, ROI, actual edge bounds and configuration; the overlay mask is cached by the intersection of submitted bounds and the current child, with its bitmap shader replaced on publication. Submission tickets freeze the processing metadata with the source coordinates; an edge refuses raw or old-configuration frames and releases bitmap shader references on detach.

`BottomScrollEdge` places this background below the navigation, spanning the gaps and physical screen edges. With tabs visible, its expanded top starts at the tabs' top, preserving the raw page beside the mini player; the compact row retains its existing 40dp upper transition allowance. Mini-only screens retain their prior geometry. It uses 18dp blur and a 0.46 background tint independently of the three saved capsule/panel profiles. The smooth transition spans 4–40% of the edge height, reaching full strength before the bottom controls’ centers. These are project visual presets, not Apple's private parameters. The fixed RN host reserves the larger of the two endpoint heights and shares the existing native dock progress; only its Compose drawing child changes height. The optional `dockExpandedHeight` defines the initial material height and defaults to the full host, preserving other controls. Native and fallback drawings are anchored to the same physical bottom. Its dedicated non-collapsible wrapper is excluded from the same window capture as the controls. It adds no capture loop, ImageReader, fence, or CPU readback. After its exit fade the native material unmounts, restoring the raw capture path. When both relevant bar-blur preferences are disabled, or native blur is unavailable, the existing color fade remains instead.

On Android 13+, the mini player sets `preferUnblurredBackdrop`: the shared GPU image also contains a small raw mini-player ROI after the processed main region. The source scene is recorded once; retained source/processed/output RenderNodes replay only the additional clipped patch into the same ImageReader. Its frozen screen/atlas coordinates travel with each asynchronous ticket. Lens/blur padding and an 8dp motion guard protect sampling; insufficient old coverage falls back to the processed main region. Normal consumers use a strict main source rectangle, and the edge's cached single-tap shader clamps to its main region so appended raw rows cannot sharpen the physical bottom. This adds buffer rows and a regional GPU replay, rather than another root draw, capture, Gaussian, fence or CPU readback. The expanded mini samples the raw scene with its saved blur, tint and lens values; zero blur now means zero blur rather than the scroll edge's preprocessed 18dp image. The compact mini samples the original processed main region, restoring its appearance before the clearer-source revision. During the existing dock spring it draws the opaque processed base plus raw alpha `1 - dockProgress`, retaining source opacity without an extra layer, capture, filter or RN update. Both endpoints draw only one region, and insufficient raw coverage keeps the original processed fallback. Progress is observed in drawing, and Paint alpha/shader and canvas clipping are restored after each sample. Navigation and the surrounding progressive edge retain their processed source. Android 12 retains the previous one-region path. Source nodes and shader references are released with the existing capture/consumer lifecycle.

Fold/unfold reactions dispatch in the foreground mapper pass, and a stable scroll context keeps compact-target notifications from re-rendering the active list. The producer caches raw/Gaussian filters independently of geometry and precomputes the overlay's 17 alpha stops. A gated `ResonusDockProgress` Trace counter changes only with native progress while tracing is enabled, allowing real motion to be separated from idle frames. Preview builds permit local release profiling through `<profileable android:shell="true">`; ordinary builds remove this preview-only flag. Display refresh, UI callbacks, GPU backdrop publications and actual presented frames are separate measurements.

Backdrop 1.0.0 requires explicit refraction height and amount; it has no universal numeric lens preset. The three default material profiles use no blur or chromatic aberration, mini-player lens amount/height 11/9dp with depth disabled, navigation 14/14dp with depth enabled, and other controls 8/8dp with depth enabled. See `src/theme/glassDefaults.ts` for their complete highlights and tints. These choices are independent of the optimized capture scheduler.

## Tune the material

Settings → Appearance → Glass tuning exposes a live native preview and independent profiles for the mini player, navigation, and other controls. It adjusts blur, lens amount/height, highlight width/opacity, tint color/opacity for navigation and other surfaces, depth effect, and chromatic aberration. Mini-player tint controls are hidden because its fill is always transparent. `depthEffect` is also a public native-view prop, defaulting to `true`.

The shared material components read partial overrides from `src/store/glassTuning.ts`. With no override, each glass surface uses its group's chosen default profile and retains its original shape. For non-mini surfaces, automatic tint follows the control's original color and a custom tint replaces only the material's fill color. Mini-player tint is always disabled. Existing bar-blur preferences still control whether bottom bars render glass; the tuning preview follows those preferences.

Dragging updates memory immediately; Save persists the appearance separately from account settings under `resonus.glass-tuning.v1` and reports storage failures. Reset clears only the selected profile in memory; Save makes that reset persistent. Export serializes versioned appearance overrides for applying the chosen values later. The three default profiles are defined in `src/theme/glassDefaults.ts`; other controls use that profile while retaining their original shape and automatic tint colors. Capture scheduling and screen layouts are independent of these profiles.

Buttons have no decorative glass layer. `GlassPressable` remains a compatibility wrapper but strips material-only props and forwards original native Pressable styles, children, state feedback, events, and refs. `GlassSwitch` and `GlassSlider` forward the native controls directly. Manually added glass on action rows, rating controls, cover-change badges, and selectable cards is also removed. General panel/input glass and the complete mini-player/navigation surfaces still use the chosen profiles; tuning cannot restore glass borders on individual buttons.

The player’s song menu has a separate floating glass card: 28dp rounded corners, 12dp blur, 10/7dp lens, depth enabled, no color dispersion and a 0.6dp highlight. `MenuGlassBackdrop` follows the light/dark theme without writing or resolving the three saved tuning profiles. It must be a direct child of the non-collapsible card, beside its scrolling foreground, so transparent-Modal capture excludes the complete card and samples the Activity behind it. This replaces the player’s existing sheet material and uses the existing per-window capture pipeline. Other song-menu callers keep the bottom sheet. Each submenu shares the card’s single scroll container; labels can wrap, safe-area bounds cap its dimensions, and ordinary menu actions do not acquire glass frames.

The complete bottom navigation additionally adapts the upstream [`LiquidBottomTabs`](https://github.com/Kyant0/AndroidLiquidGlass/blob/kmp/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidBottomTabs.kt) interaction. Its selected capsule is a native lens, with spring tracking, press enlargement, velocity-dependent stretching, directional highlight, inner/outer shadows and a moving light spot. The outer material also shifts and expands subtly while pressed. Its resting appearance continues to use the saved navigation profile (including zero blur); selected-lens refraction/highlights follow that profile instead of replacing it with a fixed frosted preset.

Horizontal dragging chooses one tab on release. Vertical gestures and cancelled touches restore the current route. Reanimated reactions share the raw synchronous Expo JSI HostFunction into the UI runtime and dispatch their prepared values in the same mapper pass as foreground motion. A second requestAnimationFrame previously read derived progress before the next mapper pass and could leave the material one frame behind. Host/value deduplication prevents unchanged calls; no recurring motion callback is installed. This does not mean the whole Reanimated or Worklets runtime stops requesting animation frames. Native state updates use an ephemeral weak view token, a main-thread/finite-value guard, and one atomic Compose snapshot; unchanged dock Floats skip snapshot allocation. This bypasses per-frame Fabric prop/ShadowTree commits for native selector motion. Touch start/end feedback and the final route change run in RN JS. Existing RN icons/labels retain their fonts, configurable order, hiding, reselection behavior and accessibility. The selected icon enlarges once for each touch session, without per-frame RN transforms; unlike the Compose-only sample, icons are not copied into a separately refracted foreground layer.

At rest, the selector draws the upstream's plain translucent selection shape and omits every inactive lens/highlight/shadow/combined-backdrop layer. A derived boolean enables the complete native selected-lens stack only during interaction and settling. During interaction the capsule material is recorded once in a retained graphics layer, displayed from that layer, and sampled by the selected lens. This avoids the repeated source drawing of Backdrop 1.0.0's `exportedBackdrop` and default `layerBackdrop` paths without adding another screen capture. The shared capture scheduler and buffers are unchanged. The expanded layout retains its safe-area spacing and 62dp navigation/48dp mini-player dimensions. A one-tab bar disables horizontal dragging and sideways enlargement; two-tab bars limit sideways enlargement. Reduced motion suppresses press/velocity deformation while preserving tab selection.

The AM++ selected lens uses the nearest ancestor marked `resonus-dock-selection-host` inside `PlayerDockUnderlay`, rather than the bar-height `ViewOverlay`. Android's overlay inherits its host's bounds, which otherwise crops the source's enlarged lens at the bar edges. The draw-only overlay now records a padded parent, uses the actual owner-to-host matrix and skipped ancestors' opacity, and remains inside the player's full-screen reveal clip. It owns no input or accessibility target. Kyant/custom selectors already draw directly through unclipped Compose parents and retain that path. Source deformation stays unchanged: Kyant uses `78/56`, AM++ `1.5/1.45`, with the existing springs and velocity clamps. Padding and the capture ROI reserve a fixed interaction envelope derived from those values, spring overshoot and the default shadow margins, rather than resizing with every press/velocity sample. Logical tab bounds, shader sizes and hit areas remain unchanged; overlay resources still release when interaction ends.

## Coordinated dock layout

The layout adapts the Apple Music example and [minimize controller at revision `6e7ffdacdabf5895c68569a3fb147fad694c299a`](https://github.com/sdegenaar/liquid_glass_widgets/blob/6e7ffdacdabf5895c68569a3fb147fad694c299a/lib/widgets/surfaces/shared/tab_bar_minimize_controller.dart) from the Flutter project liquid_glass_widgets. The MIT notice is included in [LIQUID_GLASS_WIDGETS_LICENSE](LIQUID_GLASS_WIDGETS_LICENSE) and the adapted `src/lib/liquidDock.ts`. The React Native layout uses the existing native material and shared capture; it adds no Flutter engine or shader dependency.

`LiquidDockProvider` supplies one shared spring progress to the navigation and mini player. Main vertical lists and supported detail/settings screens compact through `useLiquidDockScrollHandler`; Search can compact with its keyboard hidden, while horizontal carousels retain their existing handlers. The controller requires same-direction real-drag travel of 96dp down to compact or 80dp up to expand. The final genuine drag offset is sampled before disabling drag eligibility; momentum never re-enables it or completes short travel. The prior lower-distance fast-flick path and its clock calculations are removed. One drag can commit at most one manual target change; a new drag creates fresh state. Top and short-content restoration remain independent. The controller resets its baseline for programmatic jumps, overscroll, extent changes, and interrupted or stale-route gestures. Only target changes cross to RN JS. The Android RN hosts retain their expanded bounds. A raw UI-runtime HostFunction supplies progress to one Compose drawing child, which measures its actual rounded glass outline and offsets backdrop sampling to the physical position. Foreground content uses translation and opacity; text width and hit rectangles change only at a target/settled transition. This avoids per-frame Yoga/Fabric resizing of the navigation and mini player without stretching the lens or fonts. Unsupported platforms keep the visual fallback.

Expanded navigation is 62dp high, with an 8dp gap below the 48dp mini player and 20dp outer margins. Search is a separate 62dp circle on the physical right, with an 8dp gap after the capsule of other enabled tabs. Its presence depends only on navigation settings, including on Search itself, without a song, and with the keyboard visible. Compact navigation becomes a 50dp current-tab circle at the physical left; Search morphs to a 50dp circle at the physical right. The navigation host stays at the left while its native drawing child shrinks. Search's fixed parent translates by 12dp while shrinking from 62dp to 50dp, keeping its visible right edge fixed. Glass, foreground and touch targets follow the same parent, without per-frame RN layout. Search's RN shadow/elevation is removed, matching the native material's null shadow. The mini player shows only a vertically centered song title in both states. It fits between the compact circles, retaining artwork, title, and play/pause while secondary controls collapse. Search disabled gives the compact mini player the free right space. Hidden controls disable touch and accessibility targets; they restore after expansion finishes. Both layouts cap their overall width at 560dp. `getLiquidDockGeometry` shares physical bounds between the bar and mini player; only mini-player content spacing mirrors for RTL.

The current-tab circle expands navigation. The search circle expands the dock, selects the existing Search route, and requests input focus. Top or short content, route changes, the keyboard, and no current song restore expansion; compact behavior follows navigation-bar visibility throughout the app, including artist/album/playlist detail, browser results, history, settings and Search with its keyboard hidden. The dock also requires a loaded song and an enabled non-Search navigation entry. Main vertical scroll containers use the shared UI-thread handler; horizontal shelves and Modal contents do not drive the dock. Full player, lyrics, and queue hide the dock, retaining outgoing geometry during the fade. Returning to a tab starts expanded. Existing playback, mini-player gestures, tab configuration, selection/reselection, and the saved mini-player/navigation material profiles are retained. The layout spring honors `ReduceMotion.System`.

The appearance store also provides an approximate iPhone-reference mode. RN resolves the selected profile before supplying the unchanged native props, so this adds no capture, shader pass or animation loop. Reference edge depths are 7/8/6dp for mini player/navigation/other surfaces, with 0.5dp mini/navigation highlights and 0.5 navigation highlight opacity; explicit blur remains zero and color dispersion remains disabled. These are Kyant calibration choices, not Apple private parameters. Custom overrides and the existing export format remain intact, with the selected mode stored separately. All material consumers subscribe to mode changes. The tuning screen displays the reference read-only and restores the saved, editable profiles through Custom parameters. The original ordinary button styling is retained in both modes.

## System typography

The separate `SystemTypography` Expo module reads Android 12+ `Configuration.fontWeightAdjustment` from the application configuration, with a system-resource fallback. The Activity's existing `withoutFontWeightAdjustment` override keeps that field at zero for TextView, preventing a second platform adjustment and the previous measurement/drawing mismatch. `src/lib/appFont.ts` applies the original system adjustment explicitly to React Native Text and TextInput weights, so layout and drawing use the same face.

Phosphor, Phosphor-fill, Ionicons, Material glyph fonts, and `CustomFont-` imported single-face families retain their registered faces. Configuration events and foreground refresh publish only changed adjustment values; a font-family commit also notifies mounted and memoized labels through a stable snapshot. This module does not change system settings or saved appearance parameters. Android versions below 12 use a zero adjustment, and iOS retains the previous family injection.

## What gets rendered

This is the actual library's `drawBackdrop` + `vibrancy` + `blur` + `lens` + `Highlight`, not an imitation gradient. Each Android window has one shared GPU capture of the current React Native screen. All visible glass surfaces draw their corresponding region from that capture. With a visible bottom edge, the Activity samples the ordinary RN content host identified by `resonus-glass-content`; the floating dock sits outside that subtree. The native path replaces Expo's legacy `BlurTargetView`, which otherwise records the whole Stack on every draw despite having no blur consumer. The cached content host uses a weak reference and is validated before use, with full-root fallback. Screen-coordinate alignment and the ROI remain relative to the root.

Capture excludes material wrappers inside its chosen source and their labels using temporary `transitionAlpha` 0, avoiding recursive glass and doubled text. Dock siblings outside a content-only capture no longer need this exclusion. This does not set the visibility property or ordinary alpha, clear input focus, or dispatch ordinary visibility events. Android's `isVisibleToUser` can still report false while transition alpha is zero; each wrapper's exact original transition alpha is restored in `finally` after the GPU frame is frozen. In a transparent Modal, capture retains the full-root path and draws the Activity backdrop and then the Modal root, aligned in screen coordinates.

The capture uses `RenderNode`, `HardwareRenderer`, and `ImageReader` so hardware-decoded artwork can be sampled. Android 13+ submits without waiting for presentation on the UI thread; a serial background handler acquires GPU images and waits for their completion fences. Up to two requests can be in flight, with FIFO image acquisition and immutable source coordinates, allowing consecutive display frames to be sampled. Android 12 retains the synchronous capture path. The renderer retains the last two displayed GPU images until newer frames are available and releases its resources when the last surface detaches. Snapshots remain in memory and are never saved or logged.

Navigation samples also carry an independent page epoch. A cached outer React Native `ScreenStack` supplies the actual native top screen when a material attaches, before drawing, and when an asynchronous image completes. Changing pages clears the sample available to materials and rejects late images from an earlier visit, including a rapid return to the same screen. A top screen that is not attached, laid out, or visible pauses capture until it is drawable. Transitionless opaque `PUSH` pages sample that exact top screen directly: Android still retains disappearing siblings briefly even with `NONE`, and a whole-stack draw can otherwise capture the outgoing artwork with the new page epoch. Animated pages, transparent presentations and Modal windows retain their existing scene composition. Dialogs observe the Activity's stack because they sample its background. Existing displayed image buffers remain in the two-frame retirement queue; changing pages does not rebuild the GPU reader, change glass parameters, or add a JavaScript frame loop. Discovery searches the native hierarchy only when the cached stack is missing or replaced. Eight JVM regression cases cover the epoch and isolated-source policy.

For a newly attached host or a display list suppressed during capture, the native host and its Compose child are explicitly invalidated after the frame is captured. This restores the first draw before Compose has registered a draw-state observer; otherwise a newly mounted navigation material can stay transparent. Normal frames use draw-state notification alone, avoiding a second independent redraw.

Captures are shared and downsampled to at most 480 pixels wide. Only the union of visible materials, with blur/lens padding, is recorded; transparent ancestors and off-screen surfaces are excluded. Quantized buffer capacity is reused as this region moves or temporarily shrinks. If capacity is at least twice the required area and quantized bounds remain unchanged for 350ms, pending images drain and the producer shrinks while retaining the displayed images. This avoids retaining a full-page Surface for a bottom-only dock throughout the session, without reallocating each step of an animated layout. Real scrolling follows `Choreographer` display VSync, with no fixed 24/60 fps cap. Other updates retain a 42ms limiter and suppression of traversals caused by material redraw. Actual throughput depends on device performance and available images, so the display refresh rate alone is not a measured capture rate.

A driver exception or lost/stopped renderer status produces a legible tint fallback. An ordinary dropped GPU submission keeps the displayed frame and rebuilds the producer generation: a RenderThread retry can otherwise contain restored controls or break FIFO image pairing. Reader cleanup waits until its displayed images have been replaced and runs behind pending fence work. Late results are rejected by generation. A redraw request is nonfatal.

The bottom capsules override blur, refraction height/amount, highlight width/opacity, and tint opacity. Safe renderer counters are logged at two finite startup observations and at most every two seconds during active capture. These logs contain only window/capture/scheduling counts, CPU and delivery timings, recent effective update intervals, and failure state. A Home loading animation can also drive captures while it is outside the viewport.

Android 13+ supports the refractive lens and directional highlights. Android 12 keeps actual GPU blur. Older Android versions use the shared UI layer's fallback. OS-native `SurfaceView` content (such as external video surfaces) is outside the View tree capture; normal RN text, images, lists, and controls are supported. Controls nested inside another glass wrapper share the same scene backdrop; the enclosing glass control is omitted from capture.

`isolateModalForeground` is an opt-in for the floating player menu. When every Modal material opts in and the known scrim is present, internal menu scrolling reuses the static captured backdrop and cancels trailing idle captures. Activity scene changes, card geometry/transforms, scrim alpha/color and material updates still capture. Scene observers omit glass containers and inspect native view metadata plus real dirty leaves before any Activity backdrop capture can consume those flags. Image/text/progress metadata also remains observable after drawing; a running animation alone does not force captures. Mixed surfaces and missing scrims use ordinary scheduling. Listeners and cached references are released with the window. This does not add a renderer, GPU blur, image reader, fence or CPU pixel readback. Menu visual parameters remain unchanged.

## Build

Add `./plugins/withLiquidGlass` to Expo's plugin list and rebuild the native app. Expo Go cannot load this local native module. Expo autolinking discovers `modules/liquid-glass` through `expo-module.config.json`.

The plugin explicitly enables window hardware acceleration. The separate Glass application identity enables shell profiling for release performance diagnostics; builds using the original application identity remove that flag. Module Gradle configuration owns the pinned dependency and applies the Compose compiler matching the root Kotlin version. Backdrop 1.0.0 uses AndroidX Compose 1.9.4 and Android SDK 36 compatible APIs; Backdrop 2.0.1 requires Kotlin 2.4.10 / SDK 37. This deliberately avoids upgrading the entire Expo SDK for a renderer preview. Validate a release build whenever changing the library, Compose, Kotlin, or Expo SDK version.

The host accepts Fabric/Yoga dimensions while detached, deferring Compose
child measurement until reattachment. This supports scrolling lists with
`removeClippedSubviews` without asking a detached view for a window Recomposer.
A reattached surface recreates its composition and resumes the same renderer.

## Diagnostics

`getLiquidGlassDiagnostics()` returns window/material counts, capture counters,
GPU sample dimensions, whether a frame exists, and a failure class if the
renderer has fallen back. It runs on the native UI queue. Android logcat tag
`ResonusGlass` records the first successful GPU capture or a single failure
class. These diagnostics contain no screen content or device identifiers.
`registeredMotionHosts` and `directMotionCalls` additionally verify the direct
tabs animation path. `ResonusTabsMotion` reports its update count at the first
call and at most every two seconds during changing motion; it contains no
account data, screen content, saved appearance, or device identity.

## Background-only player surface clip / 仅背景裁剪

`PlayerSurfaceClipView` hosts only the fixed full-viewport `AmllPlayerBackground`
subtree. Never wrap artwork, controls, lyrics, touch targets or the whole player
in it. It neither scales/translates a View nor changes Yoga dimensions per
frame. The caller computes a background-only rounded rectangle and sends
`updateNativePlayerSurfaceClip(hostId, left, top, width, height, radius, opacity)`
directly from Worklets' UI runtime. Distances are dp; alpha is dimensionless.
`onClipHostReady` supplies a fresh token for each attachment and an optional
`cornerRadius` in dp. Android 12+ reads the public top-left rounded corner from
root window insets once on attachment; missing geometry and older devices report
zero. `initialOpacity` defaults to zero. The raw HostFunction is exported without
a JS binding/wrapper.

This is a decorative subtree: both RN/RNGH native target traversal and Android
touch dispatch always ignore it and its children (`ReactPointerEventsView.NONE`).
The JS fallback also enforces no pointer or accessibility targets. The separate
`PlayerSurfaceClip` native name and event do not replace Glass or tabs. Glass
remains the module's first/default native View for existing consumers.

The host reuses its Path and RectF, clamps radius to the supplied rectangle,
rejects non-finite/negative-size frames, and does not invalidate unchanged clips.
Opacity-only updates use native View alpha. It retains hardware Canvas clipping
for ordinary and integrated TextureView children; separate SurfaceView surfaces
are outside this container's contract. There is no forced software layer, bitmap
snapshot, frame clock or per-frame main-thread posting. Fabric measures/layouts
RN children independently, so this ExpoView does not run LinearLayout's child
placement. Parent and background bounds remain full-screen while the drawing
clip changes. Weak attachment tokens are removed on detach, and clip state is
cleared before a reattached host accepts a fresh frame.

该入口只裁剪背景，不能承载播放器交互内容。原生与回退层都强制禁用触摸，原有
Glass 默认视图及材质参数不变。背景与容器保持固定全屏布局，通过 UI 线程同步
标量更新可复用圆角路径与透明度；没有逐帧 Yoga 重排、整页缩放、位图截图或投递
队列。挂载事件通过公开 WindowInsets API 一次读取屏幕左上圆角（dp），旧设备或
无数据时为零，不在每帧读取。形状与 host 解绑回归用于源码验证，硬件背景的设备
呈现仍须实机验收。

## License

Resonus remains GPL-3.0-or-later. AndroidLiquidGlass / Backdrop is Apache-2.0, compatible with GPLv3. The original copyright and license apply; the Apache license is included as `ANDROID_LIQUID_GLASS_LICENSE` and beside the vendored 1.0.0 source. The vendored source replaces the same-version binary, backports Zennmn AM++'s minimum record capacity / clip-compositing extension, and extends that contract to the original shadow/highlight layers (GPL-3.0 additions), with complete provenance and both licenses in its `UPSTREAM.md`. AM++ motion reserves expanded backing while live logical lens/outline geometry remains unchanged; stable endpoints and other modes use the previous exact-size/offscreen path. `LiquidBottomTabsMaterial.kt` adapts the upstream sample component's interactive material, with source attribution and Apache-2.0 notice in the file; Resonus retains its own React Native navigation/gesture implementation.

The coordinated dock layout and distance-based scroll controller adapt the Apple Music example and minimize-controller behavior in [liquid_glass_widgets](https://github.com/sdegenaar/liquid_glass_widgets/tree/6e7ffdacdabf5895c68569a3fb147fad694c299a). Its MIT copyright and license are preserved in [LIQUID_GLASS_WIDGETS_LICENSE](LIQUID_GLASS_WIDGETS_LICENSE) and the adapted controller. The Flutter engine and its shader pipeline are not dependencies: rendering remains the existing native AndroidLiquidGlass module with one shared screen capture.

## Repeated-tab animation cleanup

Reanimated 4.5.1 deduplicates nested animated components by native tag when registering, but its original unregister decremented the count even for a previously removed tag. React Native's Suspense freeze/reappear invokes class mount/unmount lifecycles; repeated Home/Library switching could make the count negative and stop settled-props cleanup while hundreds of views remained mounted. The pinned pnpm patch in `patches/react-native-reanimated@4.5.1.patch` makes unregister idempotent, keeps the count equal to `Map.size`, and guards interval registration. The regression test runs the installed collector through 100 nested-row freeze/remount cycles. Explicitly disabled Home swipe rows also skip the unused Swipeable animated tree; active swipe rows retain their existing gestures and actions.

The decorative native host implements `ReactPointerEventsView` and returns `PointerEvents.NONE`. ExpoView itself does not provide this interface; a JS `pointerEvents="none"` plus a false Android touch-dispatch result is insufficient for RN/RNGH target traversal. The interface keeps the fixed-width compact navigation drawing host from masking the mini-player touch rectangle behind it.
