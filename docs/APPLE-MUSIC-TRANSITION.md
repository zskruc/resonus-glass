# Apple Music 风格播放器转场 / Apple Music style player transition

## 当前 `.17` 状态 / Current `.17` status

`.17` / Android `versionCode 99` 当前构建已以同包名、原签名覆盖安装到三星设备。
574 项应用测试、139 项原生测试、类型与翻译检查通过；lint 为 0 错误、117 项警告。
以下封面录像数据来自此前 `.17` 诊断构建；最终包本轮已完成有限滚动复测。历史 `.13` 基础检查不代表当前全场景或长期性能通过，Primuse 整页形变仍已移除。

The current `.17` / Android `versionCode 99` build is installed on Samsung with
the same package and original certificate. All 574 app tests, 139 native tests,
typechecking and translations pass; lint reports zero errors and 117 warnings.
The artwork recordings come from the earlier `.17` diagnostic build;
the final build has now completed a limited scroll retest. Historical `.13` checks do not establish
current all-scenario or long-session acceptance; the rejected Primuse whole-player morph remains removed.

关闭端点 `restingArtwork` 现在来自与真实封面相同 Yoga 层级的空锚点，位于按压与
横滑变形之外，直接保留物理像素取整后的坐标与尺寸；入场继续测量已绘制封面。
入场中途反向关闭保持当前画面连续。图像比例及 Mini／共享封面的裁切交接已对齐。
此前 `.17` 诊断构建的三次收合录像，端点图像配准得到估计缩放 `0.9925`、`dx = dy = 0`，此前 `.16`
对应缩放为 `1.1225`。本次未再出现明显的裁切尺寸跳变，但独立解码、缩放和重采样
仍有静态差异，不能称为像素完全一致。

The closing `restingArtwork` now comes from an empty anchor matching the real
artwork's Yoga hierarchy outside press/swipe deformation. Native measurement
preserves physical pixel rounding, while entry still reads the painted image.
Closing during entry preserves the painted pose; image aspect and Mini/overlay crop handoff
are aligned. Three closes recorded with the earlier `.17` diagnostic build estimate endpoint registration scale `0.9925`
with `dx = dy = 0`, versus `.16` scale `1.1225`. The large crop-size jump did not
recur in these samples, but separate decoding, scaling and resampling still leave
static differences; pixel identity is not claimed.

三个交接窗口的同一底栏像素区域标准差为 `23.75–23.90`，连续帧平均绝对像素差最大
`0.59`；`.16` 曾出现一次标准差 `41.95` 的单帧闪变，本次三个窗口未重现。关闭卸载
期间保留隐藏状态，防止 layout cleanup 到 mapper 停止的间隙恢复完整播放器背景。
这些结果只适用于所检查片段，不代表所有操作均无闪变。

Across three handoff windows, the same tab-region pixel standard deviation stays
at `23.75–23.90` and maximum consecutive-frame mean absolute pixel difference is
`0.59`. The `.16` single-frame excursion to `41.95` did not recur in these three
windows. Close cleanup keeps the outgoing player hidden through the interval
before its animation mappers stop. These findings apply to the inspected samples,
not every possible interaction.

最终包有效 All Music 滚动采样约 8 秒，45 次快速滑动的工作量中，应用记录 927 个
Surface 帧、14 次 `App Deadline Missed / Late Present`。关联显示帧间隔中位数为
`8.32ms`、P99 `16.64ms`、最大 `16.65ms`；949 个完整 UI 帧中，84 个超过 `8.33ms`，
其中三个超过 `16.67ms`。短暂慢帧仍存在，不能据此承诺持续无损 120fps。缓存、温度与
热身未严格控制，不与此前诊断构建计算改善幅度；错误页面的 `.16` 采样无效，不作对比。

The final build's valid All Music capture covers about eight seconds of a 45-swipe
workload, with 927 application Surface frames and 14 `App Deadline Missed / Late Present`
frames. Mapped display-frame intervals have median `8.32ms`, P99 `16.64ms` and
maximum `16.65ms`; of 949 completed outer UI frames, 84 exceed `8.33ms`, including
three over `16.67ms`. Short stalls remain; sustained lossless 120fps is not claimed.
Cache, temperature and warmup were not strictly controlled, so no improvement
percentage against the earlier diagnostic build is calculated. The wrong-page
`.16` capture is invalid and is not a comparison baseline.

本轮读到的累计原生计数中，1285 次背景记录全部为 direct；离屏 GPU 图像捕获、异步提交及 `syncAndDraw`
计数均为零，与 trace 中没有离屏 Draw 一致。窗口和现有光学滤镜仍需绘制，不能把
这项路径确认当作零渲染成本。搜索下拉显示原材质已确认；后续点按片段进入播放器，
操作归属未能确认，搜索聚焦、取消及返回本轮未验收，不登记为通过或已确认故障。

Native counters read after this round report 1285 backdrop recordings, all direct. Offscreen GPU image
capture, asynchronous submission and `syncAndDraw` counters are zero, matching the
absence of offscreen Draw passes in the trace. The window and existing optical
filters still require rendering. Pull-down Search retained its original material;
the later tap sequence was inconclusive after the player opened. Search focus,
cancellation and return remain unverified, rather than recorded as passes or
confirmed failures.

最终 `.17` 构建已移除临时自动开启转场记录的行为；私有录像、图像
及日志不提交或链接到公开文档。Mini 标题保留同一 Marquee 树，以独立 `active` 暂停／
恢复时钟并保留 offset。源码见 [MiniPlayer](../src/components/MiniPlayer.tsx)、
[转场协调](../src/hooks/useAppleMusicPlayerMotion.ts) 与 [MarqueeText](../src/components/MarqueeText.tsx)。

Automatic transition tracing has been removed from the final `.17` build. Private recordings, images and logs are neither
committed nor linked publicly. Mini retains one Marquee tree and pauses/resumes
its clock through independent `active` state while preserving its offset. See
the source links above.

## 保留的 `.14` 行为 / Retained `.14` behavior

`.14` 移除顶部白条及其点击区域，但保留原高度、顶部下拉、系统返回和现有封面的
无障碍关闭动作；主控制区只保留原位置的上一首／播放暂停／下一首，随机与循环仍在菜单。
返回交接新增 scope-ready 保护：来源页面的进度尚未恢复时保留已绘制进度，恢复就绪后
继续跟随滚动；选中透镜同时保留来源页透明度，不在揭露或返回时额外淡入。

`.14` removes the top handle and its tap target while retaining header height,
pull-down/system-back dismissal and accessible closing on the existing artwork.
Only previous/play-pause/next remain in their original positions; modes stay in
More. Scope-ready handoff retains painted dock progress until the origin's
progress is restored, then follows scrolling again. Selected-lens opacity also
retains its origin value without another reveal/return fade.

## 固定来源 / Pinned source

本轮依据 [f728743/AppleMusicStylePlayer，提交
`a0b5631417dec05d092c3c61df4679ed361743bf`](https://github.com/f728743/AppleMusicStylePlayer/tree/a0b5631417dec05d092c3c61df4679ed361743bf)，
作者 Alexey Vorobyov，MIT；[完整原始许可证](../licenses/APPLE-MUSIC-STYLE-PLAYER-MIT.txt)
及[第三方归属](../THIRD_PARTY_NOTICES.md#applemusicstyleplayer-artwork-transition)保留在仓库。
这是源码几何与手势的 Android 适配，不是将 SwiftUI 或 Apple Music 嵌入应用。

The pinned MIT source by Alexey Vorobyov supplies geometry and gesture rules.
The full license and attribution are retained above. SwiftUI and Apple Music
are not Android dependencies.

| 源码 / Source | 本轮采用的结构 / Adapted structure |
| --- | --- |
| [ExpandableNowPlaying.swift](https://github.com/f728743/AppleMusicStylePlayer/blob/a0b5631417dec05d092c3c61df4679ed361743bf/AppleMusicStylePlayer/NowPlaying/ExpandableNowPlaying.swift) | 300ms smooth、extraBounce 0；下拉只跟手平移，松手以 `max(translationY, 0) + velocityY / 5 > height × 0.3` 决定关闭。300ms/no-extra-bounce intent, translating during drag and committing collapse on release. |
| [CompactNowPlaying.swift](https://github.com/f728743/AppleMusicStylePlayer/blob/a0b5631417dec05d092c3c61df4679ed361743bf/AppleMusicStylePlayer/NowPlaying/CompactNowPlaying.swift) / [RegularNowPlaying.swift](https://github.com/f728743/AppleMusicStylePlayer/blob/a0b5631417dec05d092c3c61df4679ed361743bf/AppleMusicStylePlayer/NowPlaying/RegularNowPlaying.swift) | 同一 artwork namespace；封面在两个实测端点间交接，完整内容淡入并带底部控件位移。Shared artwork identity, content fade and bottom-control movement. |
| [NowPlayingBackground.swift](https://github.com/f728743/AppleMusicStylePlayer/blob/a0b5631417dec05d092c3c61df4679ed361743bf/AppleMusicStylePlayer/NowPlaying/NowPlayingBackground.swift) | 背景形状与封面几何分离；过渡期使用显示屏圆角，完全展开后取消该裁切圆角。Background outline is separate from artwork geometry and uses the display corner during transition. |

## Android 实现边界 / Android implementation boundaries

- **只飞一张封面。** [几何函数](../src/lib/appleMusicPlayerTransition.ts)、
  [运动协调](../src/hooks/useAppleMusicPlayerMotion.ts)和
  [封面 overlay](../src/components/PlayerArtworkOverlay.tsx)使用开始时测得的 mini／大封面
  边界；交接时隐藏原位置的两张封面，结束后显示目标，避免双影。图像保留固定布局尺寸，
  通过变换移动。**One artwork overlay** connects measured endpoints; original
  artworks hand off visibility and the image keeps fixed layout dimensions.
- **背景单独裁切。** 原生 [PlayerSurfaceClipView](../modules/liquid-glass/README.md#background-only-player-surface-clip--仅背景裁剪)
  只承载 `AmllPlayerBackground`，复用圆角路径，容器和子背景始终全屏；不缩放整个
  播放器、歌词或控制区，不逐帧重排。Android 12+ 挂载时通过公开 WindowInsets API
  读取左上屏角，旧设备或缺失数据时为零。**Background clipping is independent**:
  fixed full-screen layout, no whole-player scale, and one public display-corner
  read per attachment. The decorative subtree never receives touch input.
- **景深只作用于来源页面。** [来源页变换](../src/components/PlayerUnderlayTransform.tsx)
  在完全展开时沿用源几何：scale `0.9`、最终平移 `9dp`、圆角 `22dp`（源代码先缩放再
  平移 `10`，合成后为 `9`）。它不变换整个 Stack，也不缩放播放器本体。
  **Depth affects only the originating screen**, with the source's composed
  scale/translation/radius; other navigation pages and the player stay outside it.
- **300ms 是跨运行时近似。** Reanimated duration 配置为 `300 / 1.5 = 200ms`、
  dampingRatio `1`，表达约 300ms、无额外弹跳的意图；不声称与 SwiftUI `.smooth` 使用
  相同求解器。**Timing approximates** the source intent rather than reproducing
  SwiftUI's undocumented solver.
- **Mini 与 Tabs 同步交接。** 共享封面转场时，两者使用同一 `1 - progress` 透明度，
  不以正在收合的背景底边单独裁掉 Tabs；原有滑动回退仍保留同步裁切揭露。
  **Mini and Tabs share the same fade** during artwork flights; ordinary slide
  fallbacks keep their existing coordinated clip reveal.

保留现有路由所有权、取消回弹、重复关闭保护、旋转失效处理及系统返回交接。实测端点无效
时回退已有滑动路径。mini 上拉入场是保留的 Resonus 扩展，源 demo 只有点击 mini 展开及
展开后的下拉关闭，不能把这个上拉能力归为上游实现。控制布局结合用户三星 Apple Music
的实机参考适配；私有截图不提交到公开仓库。原有玻璃光学参数与其他许可边界不因此改变。

Route ownership, cancellation, repeated-close guards, rotation invalidation and
system-back handoff remain. Invalid endpoint measurements use the existing slide
fallback. Upward pulling from mini is an existing Resonus extension, not a demo
capability. Layout also follows the user's Samsung Apple Music reference;
private screenshots are not published. Glass optics and other license boundaries
remain unchanged.

## `.13` 历史检查与保留的回退 / Historical `.13` checks and retained fallback

历史 `.13` 的实机基础视觉检查已看到封面在真实端点之间缩放并回位、完整入场、顶部短拉取消、长拉
退出、歌词切换和歌词页顶部下拉返回；修复版这些检查期间未出现新的崩溃。三星参考布局、
白色 SVG、暂停封面 0.85、收藏与更多入口也已确认。这不是持续 FPS 测试，也不等于所有
页面、长列表、长期运行或全弹窗均已通过；最终审美效果仍须用户判断。

Historical `.13` device checks observed artwork resizing and landing at real endpoints,
full entry, short-pull cancellation, long-pull dismissal, lyric switching and
lyric-header pull-down return, without a new crash during those fixed-build
checks. The Samsung-reference layout, white SVGs, 0.85 paused artwork and
favorite/More entries were confirmed too. These were not sustained-FPS tests,
nor acceptance of every page, long list, long-running session or popup. The user
still needs to assess the final appearance.

`.13` 首次安装包的 `measure(null)` 问题已通过原生引用就绪保护修复，并在该版实际安装版本中
复查测量路径；交付位置已替换为修复包。共享封面只在有效端点、当前 owner 与原生
背景 host 就绪时启动；未就绪时延后尝试，无法建立时使用已有滑动回退。Android 原生
host 就绪事件会重试尚未开始的入场；来源路由在本次 owner 下捕获，不跟随之后聚焦的
页面变化。缺少原生裁切入口的环境沿用回退视图／滑动路径；host 暂未提供时保留中性
背景，避免空透明帧。挂载代际 token、视口／曲目变化和失效测量均不应让旧飞行更新新 host。

The first `.13` build's `measure(null)` error was fixed with native-ref readiness
guards and that version's installed measurement path was checked again. Deliverable paths
contain the fixed APK. Artwork flights require valid endpoints, the current
owner and a ready background host; otherwise entry is deferred or uses the
existing slide fallback. The Android host-ready event can retry an entry that
has not begun, and the origin route is captured for its owner rather than
following later focused pages. Environments without the native clip API keep
the fallback View/slide path; a temporarily missing host retains a neutral
background to avoid an empty transparent frame. Attachment-generation tokens,
viewport/track changes and invalid measurements guard against stale flights
updating a new host.
