# 播放器与 Mini Player 转场研究 / Player-to-mini transition research

## 当前状态 / Current status

用户在 `.11` 实机体验后明确拒绝这次 Primuse 入场／退场效果，要求恢复原有动效。`.12` 构建候选已回滚这部分：播放器与 mini player 恢复 `.10` 的进出场动效并保留同步底栏；同时保留旋转时稳定 surface owner、独立发布高度的非视觉安全修复；本次新增的 Primuse 形变函数、原生 PlayerMorph 容器、mini 目标测量与 inverse clip 接入不再应用。此前歌词表现中独立的 Primuse 来源不属于本次转场回滚范围。

After testing `.11` on the phone, the user rejected its Primuse entry/dismissal effect and requested the previous motion. The `.12` build candidate restores `.10` player/mini entry and dismissal motion with its synchronized underlay, while retaining a nonvisual fix that keeps the surface owner stable across rotation and publishes height separately. The experimental morph helper, native PlayerMorph container, mini-target measurement and inverse-clip integration are no longer active. Separate earlier Primuse-derived lyric treatment is outside this transition rollback.

原有顶部下拉、取消回弹、系统返回、路由代际保护与同步底栏保留。清理后 23 项真实手势／底栏回归测试通过；最终安装包以本轮构建结果为准。本轮按用户要求先构建，不再操作或安装到手机，因此不能标记 `.12` 已实机验收。

The previous header pull, cancellation rebound, system back, route ownership and synchronized dock remain. All 23 retained gesture/underlay regression tests pass. Final APK availability follows the build result. The user requested a build first, without further phone interaction or installation, so `.12` phone acceptance is not claimed.

## 保留的源码研究 / Retained source research

以下是实际核对过的候选，作为以后比较动效的资料；不代表本轮仍采用其播放器转场，也不代表将 iOS 框架作为 Android 依赖。

These candidates were examined in source and remain available for comparison. They are not active player-transition implementations in this build, nor iOS frameworks embedded as Android dependencies.

| 项目 / Project | 固定来源与核对结果 / Pinned source and finding |
| --- | --- |
| Primuse | [提交 `9d02322d2455f7750d01e8dfc3a90170c83f555a`](https://github.com/chenqi92/primuse/tree/9d02322d2455f7750d01e8dfc3a90170c83f555a)，[MIT，Welape](https://github.com/chenqi92/primuse/blob/9d02322d2455f7750d01e8dfc3a90170c83f555a/LICENSE)。[`PlayerOverlayMorphGeometry` / `PlayerOverlayCardShape`](https://github.com/chenqi92/primuse/blob/9d02322d2455f7750d01e8dfc3a90170c83f555a/Primuse/Views/ContentView.swift#L2897) 将整张播放器卡片收回实际胶囊，独立处理宽度缩放、纵向裁切、圆角和淡出；不是大封面直接飞进 mini 封面的共享元素。Whole-card morph, with width scale, vertical clip, rounding and fades; not a direct artwork shared element. |
| Minidisc | [提交 `11b5925f2e99b316b4cdcced7ba783a7ed3d957d`](https://github.com/Loriage/Minidisc/tree/11b5925f2e99b316b4cdcced7ba783a7ed3d957d)，[MPL-2.0](https://github.com/Loriage/Minidisc/blob/11b5925f2e99b316b4cdcced7ba783a7ed3d957d/LICENSE)。[`PlayerContainer.swift`](https://github.com/Loriage/Minidisc/blob/11b5925f2e99b316b4cdcced7ba783a7ed3d957d/Minidisc/Views/Main/PlayerContainer.swift) 的 accessory→overlay→accessory 生命周期使用同一 `playerArtwork` 共享几何、0.3s ease-out，完成后无动画卸载，避免 mini 再执行一次插入。Shared artwork geometry, 0.3s ease-out and nonanimated detach after completion. 本轮未合入源码 / No source merged. |
| AppleMusicStylePlayer | [f728743/AppleMusicStylePlayer，提交 `9e3d4f7324e66fa445684c776db43a7777277667`](https://github.com/f728743/AppleMusicStylePlayer/tree/9e3d4f7324e66fa445684c776db43a7777277667)，[MIT，Alexey Vorobyov](https://github.com/f728743/AppleMusicStylePlayer/blob/9e3d4f7324e66fa445684c776db43a7777277667/LICENSE)。[`ExpandableNowPlaying.swift`](https://github.com/f728743/AppleMusicStylePlayer/blob/9e3d4f7324e66fa445684c776db43a7777277667/AppleMusicStylePlayer/NowPlaying/ExpandableNowPlaying.swift) 是较早的简化参考，采用 0.3s smooth、extraBounce 0 与共享封面 namespace；该转场未使用 iOS 26 `.glassEffect`。Earlier compact reference with smooth motion and a shared artwork namespace, without iOS 26 glass. 本轮未合入源码 / No source merged. |

Primuse 的下拉手势与松手收合分离：先跟手平移，确认关闭后才从松手位置向胶囊形变，具体见 [`playerMinimizeDragGesture`](https://github.com/chenqi92/primuse/blob/9d02322d2455f7750d01e8dfc3a90170c83f555a/Primuse/Views/NowPlaying/NowPlayingView.swift#L3202) 与 [`beginDismissal`](https://github.com/chenqi92/primuse/blob/9d02322d2455f7750d01e8dfc3a90170c83f555a/Primuse/Views/ContentView.swift#L2533)。它的封面↔歌词小封面另用 [`LyricsArtworkFlight`](https://github.com/chenqi92/primuse/blob/9d02322d2455f7750d01e8dfc3a90170c83f555a/Primuse/Views/NowPlaying/NowPlayingView.swift#L1080) 固定尺寸单图处理，是另一种转场。Minidisc 也不能描述成封面在整个下拉过程中都连续缩放：主要拖动阶段是平移，收合在松手确认后提交。

Primuse separates tracking a downward drag from committing its capsule morph. Its fixed-size artwork flight between cover and lyric layouts is a separate transition. Minidisc likewise primarily translates during the drag and commits its shared-element collapse after release; it should not be described as a continuously shrinking cover throughout the pull.

`.11` 实验曾把 SwiftUI 420ms／bounce 0.12 的意图转换成 Reanimated 时长参数 280ms 与 dampingRatio 0.88；这只是跨运行时近似，不是同一求解器或 Apple 私有参数。该实验实现现已移除，不能将这些数字当作 `.12` 的实际动效配置。

The removed `.11` experiment approximated SwiftUI's 420ms/0.12-bounce intent with Reanimated's 280ms duration parameter and 0.88 damping ratio. That was not an identical solver or Apple-private parameter set, and those numbers no longer describe `.12` motion.

这些研究不构成全 App 120fps、逐像素一致或原生 Apple Liquid Glass 的保证。

This research does not establish app-wide 120fps, pixel-identical rendering or native Apple Liquid Glass on Android.
