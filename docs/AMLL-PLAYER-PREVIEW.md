# AMLL 播放器预览 / AMLL player preview

`0.8.4.1-amll.1` · Android `versionCode 83` · `preview/amll-player`

本页记录本地开发预览，未表示已经发布或完成三星实机验收。正式下载仍以仓库 Releases 为准。

This page describes a local development preview, not a published release or a completed Samsung-device validation. Use the repository's Releases for stable downloads.

## 来源与实现边界 / Reference and implementation boundary

视觉参考为 [amll-dev/applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics)，固定提交 [`5fee356362353dbb24ce9bea3a62536478040de7`](https://github.com/amll-dev/applemusic-like-lyrics/tree/5fee356362353dbb24ce9bea3a62536478040de7)。核对范围包括 `react-full` 的 [PrebuiltLyricPlayer](https://github.com/amll-dev/applemusic-like-lyrics/tree/5fee356362353dbb24ce9bea3a62536478040de7/packages/react-full/src/components/PrebuiltLyricPlayer)、[竖屏与横屏布局](https://github.com/amll-dev/applemusic-like-lyrics/tree/5fee356362353dbb24ce9bea3a62536478040de7/packages/react-full/src/layout)，以及 Mesh 背景的视觉处理。

AMLL 对应包声明 **AGPL-3.0-only**。本预览以其布局、动效与颜色分布作为视觉参考，使用 React Native、Reanimated 和 Android Canvas 独立实现；没有导入或嵌入 AMLL 的 DOM/WebView 运行库，没有复制其 AGPL 源码、着色器、SVG、贝塞尔控制点预设数组或动画引擎。图标继续使用 Resonus 已有图标体系。本实现不等于 AMLL 本体、像素级移植或 Apple 的私有 Liquid Glass；仓库根许可证继续为 **GPL-3.0-or-later**。

The visual reference is the pinned AMLL commit above, specifically `react-full`'s PrebuiltLyricPlayer, its portrait/landscape arrangements and its Mesh background treatment. The reviewed AMLL packages declare **AGPL-3.0-only**. This preview independently implements native views using React Native, Reanimated and Android Canvas. It does not import/embed AMLL's DOM or WebView runtime or copy its AGPL source, shaders, SVGs, Bézier control-point preset arrays or animation engine. Existing Resonus icons are reused. This is neither the AMLL runtime, a pixel-identical port nor Apple's private Liquid Glass. The repository's root license remains **GPL-3.0-or-later**.

## 播放页 / Player layout

- 默认竖屏歌词模式使用小封面、歌曲与歌手信息，歌词占满小封面下方至底部工具栏之间的区域；隐藏进度、播放和音量控制，底部保留歌词切换、输出与队列入口。点击封面或底部歌词按钮，可切换到大封面布局并显示播放控制；当前歌词的定位锚点为手机区域高度的 10%、横屏的 42%。
- 同一个封面视图通过原生动画缩放、移动；没有以两张不同封面互相替换。小屏与大字体采用可滚动的内容列，避免封面、文字与控制区域重叠。
- 横屏采用约 45% 的封面／控制列与 55% 的歌词列；隐藏歌词时，原来的封面／控制列移向中央。
- 歌词继续使用 Resonus 的本地、服务器与 LRCLIB 数据和跳播逻辑。有时间轴的歌词使用现有逐字与同步渲染，纯文本歌词可单独滚动。
- 播放、暂停、切歌、随机、循环、进度、系统或远程音量、音质详情、输出设备、队列和歌曲菜单继续调用已有功能。进度条、音量条与开启封面配色后的播放按钮直接读取当前封面色。

In portrait, the default lyric view combines a small cover and metadata with lyrics filling the space down to the footer; progress, transport and volume controls are hidden, while lyric switching, output and queue remain in the footer. The cover or lyric button switches to a large-cover view with playback controls; the active lyric anchors at 10% of the lyric region in portrait and 42% in landscape. One cover view moves and scales through native animation; small viewports and accessibility text can scroll rather than overlap. Landscape uses approximately 45% for artwork/controls and 55% for lyrics, centering the same information column when lyrics are hidden. Existing Resonus lyric sources, timed-word rendering, seek behavior, playback, queue, output, volume, quality and song-menu actions remain in use. Untimed lyrics receive their own text scroll view. Current-artwork colors directly drive progress, volume and the optional themed play button.

在 **设置 → 播放器 → 播放器布局** 选择 **Resonus 原有布局**，即可切回之前的播放页，原有偏好不会被清除。下面的 **播放器背景**（纯色／封面颜色／模糊封面）仅适用于 Resonus 原有布局；AMLL 布局使用本页所述的网格背景。

Select **Settings → Player → Player layout → Resonus layout** to restore the previous presentation without clearing its preferences. The **Player background** choices below—Plain, Cover color and Blurred cover—apply only to that Resonus layout. AMLL uses the native artwork field described here.

## 完整封面背景与动画预算 / Spatial artwork background and animation budget

背景保留整张封面的空间颜色分布，先生成低分辨率纹理，再进行颜色整形、柔化、宽范围网格流动和暗角处理；不是用单一主色填满屏幕。网格轨迹与颜色处理由本项目独立实现，与 AMLL 的着色器、控制点和渲染器不同。

- 图片统一由 Expo Image 下载／读取缓存；原生模块只接收本地路径或内容 URI，不另开 HTTP 下载。离线标记的封面仅查询现有缓存，缺图使用中性背景。
- 解码、颜色处理和柔化按新封面执行，使用受限缓存；过期任务不能盖回旧封面。绘制复用一个最长边不超过 256 像素的缓冲区，没有逐帧全屏截图、全屏模糊或位图分配。
- 只有可见、前台且正在播放时才运行背景动画。暂停、隐藏、卸载、进入后台或无可用封面时停止申请动画帧；恢复时沿用暂停的动画相位。
- 缓慢流动的背景独立限制在最高约 **60 fps** 的工作预算。它不修改显示器、窗口或 Surface 的刷新率请求，界面与手势仍采用已有 **120Hz** 请求。背景预算与整页实际帧率不是同一项指标。

The background retains the complete artwork's spatial color distribution in a small texture, then applies color shaping, softening, a broad moving mesh and a vignette. It is not a single dominant-color fill. Its trajectories and filtering are independently implemented, rather than AMLL's shader/control-point renderer. Expo Image alone resolves/downloads images; native code accepts local paths/content URIs. Offline-marked artwork is cache-only, and missing artwork uses a neutral field. Decode/filter work occurs for new covers, stale work is rejected, and a bounded cache and reusable buffer avoid per-frame full-screen capture, blur or bitmap allocation. The buffer's longest edge is at most 256 pixels.

Animation stops while playback is paused, the view is hidden/detached, the app is backgrounded or artwork is unavailable, preserving phase on resume. The slowly moving background has its own approximately **60 fps maximum** work budget. It does not change display/window/Surface refresh requests; UI and gestures retain their existing **120Hz** requests. This budget does not measure or guarantee the entire page's delivered frame rate. See the [native background module](../modules/amll-background/README.md) for implementation details.

## AM++ 参数与底栏修复 / AM++ tuning and dock correction

**设置 → 玻璃调节** 中，AM++ 模式现可分别调节 mini player、导航与其他控件。**恢复 AM++ 默认参数** 一次恢复并保存三个目标；原有「自定义」参数独立保留。保存失败会提示，导出包含当前三个 AM++ 表面的参数。

修复在玻璃风格之间切换后，折叠导航图标可能继承 AM++ 旧位移的问题。AM++、开源默认、iPhone 参考和自定义模式现在都明确设置当前位置，AM++ 原有的回弹跟随继续保留。此修复不改变已设置的滚动触发门槛。

**Settings → Glass tuning** now edits AM++ profiles independently for the mini player, navigation and other controls. **Restore AM++ defaults** resets and saves all three; existing Custom parameters remain separate, save failures are reported and export includes the current AM++ profiles. A dock correction clears inherited AM++ compact-icon offsets when changing among all four appearance modes, while retaining AM++ spring tracking. Existing scroll thresholds are unchanged.

## 验证状态 / Validation status

本轮已通过 TypeScript 类型检查、翻译检查、321 项 JavaScript 测试及 71 项原生测试（背景 6、玻璃 58、高刷 7）；静态检查无错误，保留 11 条现有代码警告。ARM64 Release 安装包已成功构建并验证版本号、包名与原测试版签名一致。另用临时本机样例检查了小屏竖屏、封面／歌词切换与横屏布局；该网页检查不呈现 Android 原生背景，不能作为背景外观或原生帧率验收。临时样例和测试入口已移出安装包。自动化验证覆盖小屏／横屏／大字体布局约束、滑条取消及旧手势隔离、AM++ 参数保存恢复、切换风格后的折叠位移、背景缓存及动画预算等。自动化检查无法代替实机视觉与帧时间记录。

当前尚待连接三星，完成覆盖安装、真实滚动、切歌、歌词和后台恢复检查。**本轮没有新的实机 120 fps 测量结果**，也不承诺所有页面、所有动画或长时间操作始终达到 120 fps。实际表现取决于设备、温度、系统调度与数据内容。

Type checking, translations, 321 JavaScript tests and 71 native tests (6 background, 58 glass, 7 refresh-policy tests) passed. Static checks report no errors and 11 existing-code warnings. The ARM64 release APK built successfully; its version, package and signing certificate match the intended preview update. Temporary local fixtures checked small portrait, cover/lyric switching and landscape layout; that web check does not render the Android native background or validate native frame rates. Fixtures and their route were removed before the APK build. Automated tests cover responsive/accessibility layout bounds, slider cancellation/stale gestures, AM++ persistence/reset, compact-icon style changes, background cache handling and its animation budget. They do not replace on-device visual inspection or frame-time measurements. Samsung installation, actual scrolling, track changes, lyrics and background-resume checks are pending connection. **This preview has no new on-device 120 fps measurement**, and does not promise sustained 120 fps across every page, animation or long session. Device, temperature, system scheduling and content affect the result.
