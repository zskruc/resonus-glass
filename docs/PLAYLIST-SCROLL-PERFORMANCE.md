# 播放列表滚动修复 / Playlist scrolling work

`0.8.4.1-amll.12` · Android `versionCode 94` · `preview/amll-player`

## 现场与对照 / Observations

`.4` 的卡顿进程在三星 SM_S9380 上保留后采集，总 PSS（包含换出）约 1.3 GiB。设备未报告系统热降频。`.5`、`.6`、`.7` 虽有局部改善，用户仍报告明显卡顿，因此均未作为修复验收通过。原始日志、截图和 Perfetto 记录仅保存在本机忽略目录。

The slow `.4` process was retained on Samsung SM_S9380 with about 1.3 GiB total PSS including swapped memory and no reported system thermal throttling. `.5`, `.6` and `.7` improved individual costs but were still rejected in user testing. Raw logs, screenshots and Perfetto captures remain in ignored local storage.

以下对照只采用全程有输入的 8 秒记录，40 次手势持续约 9 秒；不把停滑后的后台采样或待机刷新率作为滚动帧率。设备系统请求 120Hz 并不等于交付 120 fps。

The comparison below uses eight-second traces fully covered by forty scroll gestures lasting about nine seconds. Idle capture rates and a 120Hz display request are not evidence of delivered scroll performance.

| 相同受控滚动 / Controlled scrolling | `.5` / 87 | `.6` / 88 | `.7` / 89 |
| --- | ---: | ---: | ---: |
| 主窗口绘制约每秒 / Main-window draws per second | 100 | 109 | 110 |
| 背景采样约每秒 / Backdrop captures per second | 79 | 90 | 91 |
| 应用超期帧（含复合原因）/ App Deadline Missed, including combined reasons | 85 | 53 | 36 |
| JS 调度 CPU / JS scheduled CPU | 4,052 ms | 3,934 ms | 7,207 ms |
| 新建歌曲封面 / Created row images | 301 | 303 | 310 |
| 新建 RCTView / Created RCTView | 2,709 | 909 | 10 |

绘制次数是应用侧观测，不能直接等同于屏幕最终呈现次数；SurfaceFlinger 的 Buffer Stuffing 也不能全部算作丢帧。`.6` 减少了外层 View，但 JS 和整行创建开销仍大，未满足用户要求。

Draw counts are app-side observations rather than final display presents; Buffer Stuffing is not uniformly a missed frame. `.6` reduced wrapper creation but retained substantial JS and row-creation cost and did not satisfy user testing.

## `.10` 有效热点与 `.11`／`.12` 修复 / Valid hotspot and retained correction

`.10` 的一轮有效播放列表操作同时记录了 Hermes 热点与 Perfetto；前后画面确认了真实列表偏移。Hermes 约 10 秒、100Hz 的记录共 992 个样本，其中 103 个位于 RN Animated 对象遍历及其子调用，约为**全样本的 10.38%**。这不是 103 次函数调用，也不是精确的墙钟耗时比例。该轮仅有少量预热、同时开启 JS profiler，不能拿它与此前无 profiler 的版本作严格平均 FPS 对比。

A valid `.10` playlist workload recorded overlapping Hermes and Perfetto captures, with real list displacement verified. The approximately ten-second, 100Hz Hermes recording contains 992 samples; 103 fall within RN Animated object traversal and its callees, **10.38% of all samples**. These are sample counts, not invocation counts or exact wall-clock proportions. Short warm-up and concurrent JS profiling prevent a strict average-FPS comparison with earlier unprofiled builds.

实际栈包含 `RN AnimatedComponent → createAnimatedProps → AnimatedObject.from → flatAnimatedNodes`。同一构建的源码显示，FlashList 的内部滚动宿主也会被 RN Animated 包装；外层 Reanimated 传下的对象 ref 可经 `forwardedRef.current.props.data` 到达整份歌曲数据。`flatAnimatedNodes` 的深度上限不能阻止这一层级内的完整数组遍历，因此列表即使只渲染少量回收行，构造 AnimatedProps 时仍可能扫描所有歌曲。采样本身未给出运行时属性名；具体 ref 路径由同版本源码与下述实际模块回归支持。

The sampled stack includes `RN AnimatedComponent → createAnimatedProps → AnimatedObject.from → flatAnimatedNodes`. Same-build sources show that FlashList also wraps its internal scroller in RN Animated. An object ref passed through the outer Reanimated wrapper exposes the entire song array through `forwardedRef.current.props.data`. The traversal depth limit does not bound the length of an array within that depth, so recycled visible rows do not prevent a full-data scan while constructing AnimatedProps. Sampling alone does not name the runtime prop; the source path and actual-module regression provide that attribution.

`.11` 改用稳定的函数 ref，只在回调中维护原有 `listRef.current`，`.12` 保留此修复。绑定、解绑、重新绑定和命令式滚动行为保持不变。[回收列表回归](../test/trackListRecycling.test.ts) 编译并执行实际安装的 RN AnimatedObject 模块：20,000 首的旧对象路径枚举 20,000 项，生产 callback ref 路径枚举 0 项；不是另写一份遍历算法来证明自身。生产入口见 [TrackListView](../src/components/TrackListView.tsx)。

`.11` replaces the object with a stable function ref, maintaining the same internal `listRef.current`; `.12` retains it. Attachment, detachment, rebinding and imperative scrolling remain covered. The [recycler regression](../test/trackListRecycling.test.ts) compiles and executes the installed RN AnimatedObject module: the old 20,000-song object path enumerates all 20,000 items, while the production callback-ref path enumerates zero. It does not duplicate the traversal algorithm. See [TrackListView](../src/components/TrackListView.tsx) for the actual binding.

这证明移除了一个随全列表长度增长的 JS 扫描路径，不证明所有卡顿只有这一个原因，也不是 `.12` 的长期实机帧率验收。原始 profile、截图、设备日志与 trace 仅保存在本机忽略目录；公开文档只记录上述汇总与源码入口。

This establishes removal of one JS scan whose cost grows with the full data array. It does not make it the sole cause of jank or establish sustained `.12` device frame rates. Raw profiles, screenshots, device logs and traces remain in ignored local storage; only aggregate findings and source entry points are published here.

## 修改 / Changes

- **列表复用**：专辑、播放列表共用的 TrackListView 改为 FlashList 2.0.2，保留稳定的 Gesture Handler 滚动宿主及 UI 线程滚动动画。回收池限制为 32 项，区分歌曲与唱片分组，关闭会抵消搜索／说明高度变化的自动锚定。歌曲、重复出现的位置、服务器索引和页面归属共同隔离点击、长按、菜单、多选与横滑。
- **回收状态**：封面错误、收藏请求和 Undo 状态按绑定归属更新；旧图片回调及旧触摸不能操作新歌曲。原生图片源改变时保留必要的 host 替换，不能声称所有图片 View 都复用。
- **动画下发**：Reanimated 4.5.1 每次滚动只下发待处理属性，保留完整 React 恢复和延后布局刷新；已静止且相同的属性不会重复触发 React 状态写入。原生快路径检查 View 是否实际存在，避免卸载／预分配 tag 的重复异常日志。
- **玻璃采样**：Activity 优先只记录 Stack 内容，避免把外部底栏消费者重新采入背景；保留独立顶部源、模态窗口与完整页面过渡。采样区域收紧到实际光学区域，同时保留运动和按压范围。
- **图片释放**：API 33+ 的退休 Image 交回现有图片线程按 FIFO 释放，队列与背压有界，Reader 关闭前先清理其图片。记录已显示主线程释放图片时会等待图片线程的锁；同步渲染提交仍留在原线程。
- **玻璃运动容量**：Backdrop 1.0.0 以原源码替换二进制，并回移固定 AM++ 版本的 minLayerSize／裁剪策略。折叠运动期预留物理效果层容量，逻辑折射尺寸、圆角及命中区域仍随动画变化，端点释放容量。未改变 shader、默认光学参数、采样分辨率或刷新率。详见[来源与许可证](../modules/liquid-glass/android/vendor/backdrop-1.0.0/UPSTREAM.md)。

TrackListView now recycles rows through FlashList 2.0.2 with a stable Gesture Handler scroll host, UI-thread animation and bounded pools. Recycled callbacks are tied to their original song/occurrence/server index and screen, including physical touch ownership, selection, Undo and image events. Different image sources still replace native image hosts where required to isolate stale native events.

The version-pinned Reanimated patch sends pending deltas, skips identical settled React properties and avoids removed/preallocated native tags while retaining full restoration and real error diagnostics. Activity backdrop recording excludes external dock consumers and uses bounded optical regions. API 33+ image retirement runs on the existing image thread with bounded FIFO/backpressure. The pinned AM++ backing-capacity policy is backported to the original Backdrop 1.0.0 source; logical lens geometry and all original shader/default optical parameters remain intact.

## 快滑原生闪退 / Native crash during fast scrolling

`.7` 在 2026-10-26 23:01:50 的冷进程（运行约 23 秒）发生 JS 线程原生 SIGSEGV。系统退出记录与堆栈确认是 `jsi::Value` 析构，经 `EventQueueProcessor` 中的 `EventTarget::retain` 赋值触发；不是当天早先记录的 Java 图片解码 OOM。已从安装包反汇编定位到旧 strong instance handle 的析构。

The `.7` process crashed after about 23 seconds on 2026-10-26 at 23:01:50. Exit information and the native backtrace identify a JS-thread SIGSEGV in `jsi::Value` destruction during `EventTarget::retain`, distinct from the earlier Java image-decoder OOM. Disassembly of the installed binary identifies the old strong instance-handle assignment.

本地 React Native 0.86.2 在 `dispatchEvent` / `dispatchUniqueEvent` 中未加锁复制目标引用，与卸载时的重置可能并发。官方 [0.86.3 修复](https://github.com/react/react-native/commit/fdb26edfe79041380147b0dde0ccd6552d29d31b) 在同一互斥锁内取得目标与 family 快照，再解锁派发。该已知竞态与本次悬空目标堆栈高度吻合，但单次日志不足以证明唯一根因。`.8` 将 RN、代码生成、Gradle 插件与匹配的 Hermes 编译器／运行库一起升级，避免只替换单个二进制。仍需新版本连续快滑复测。

Local RN 0.86.2 copies the target and family without the dispatch mutex while detach can reset them. The official [0.86.3 fix](https://github.com/react/react-native/releases/tag/v0.86.3) takes a locked snapshot, then dispatches outside the lock. This matches the dangling-target failure closely, without proving a unique root cause from one crash. `.8` upgrades the matched RN/codegen/Gradle/Hermes packages together; repeated device stress is still required.

## 回归与升级 / Regressions and upgrades

`pnpm harness:reanimated` 从实际安装源码提取并编译方法：200,000 次混合 View 生命周期更新；800 条静止行 × 1,000 次事件不产生原生增量；完整恢复、变化属性及延后布局提交仍保留。应用测试执行真实组件回调，覆盖回收 ABA、同指移出重入、旧延迟释放、旧横滑结束及图片／收藏异步回调。原生测试覆盖来源选择、光学区域、队列关闭顺序、背压、运动期容量及逻辑尺寸。

The native-method harness compiles the installed production methods. Component regressions execute real callbacks rather than a duplicate implementation. These checks cover lifecycle correctness, not Android frame-rate acceptance. Dependency upgrades must review the pinned patches and vendored source against the new versions.

## 当前验证 / Current validation

`.12` ARM64 APK 已构建，版本 `0.8.4.1-amll.12`、更新编号 `94`、包名与原签名已核对；463 项应用测试、118 项玻璃模块原生测试、类型检查与翻译检查通过，lint 为 0 错误、117 项已有警告。此前已核验 RN 0.86.3 官方 AAR 与事件目标加锁路径；本版保留该升级、列表 ref 修复和既有玻璃／图片生命周期优化。

The `.12` ARM64 APK is built; version `0.8.4.1-amll.12`, code `94`, package and original certificate are verified. All 463 app tests, 118 native glass-module tests, typechecking and translation checks pass; lint reports zero errors and 117 existing warnings. The official RN 0.86.3 AAR and locked event-target path were verified earlier. This build retains that upgrade, the list-ref correction and prior glass/image lifecycle work.

`.12` 恢复 `.10` 的播放器进出场，保留同步底栏，不再使用 `.11` 的 Primuse 实验。`.10` 和 `.11` 曾安装测试；`.12` 尚未安装，按用户要求先完成安装包，等待后续连接。连续长列表、退出恢复、温度／内存及完整视觉验收仍待完成，没有新的 `.12` 长期实机帧率结论。

`.12` restores `.10` player entry/dismissal with its synchronized dock and removes the `.11` Primuse experiment. `.10` and `.11` were installed earlier; `.12` is not installed, following the user's request to prepare the package before a later connection. Sustained lists, exit recovery, temperature/memory and full visual acceptance remain pending. No new sustained-device frame-rate result is claimed for `.12`.

`.8` 的一次热点采样离开了目标播放列表，已作废；不能用其 JS 空栈比例或帧时间宣称列表改善。上面的 `.10` 有效采样也不等于无 profiler 的帧率验收。系统刷新请求、单次绘制次数、操作计数回归或全部测试通过均不能推导恒定 120 fps。

One `.8` recording left the target playlist and remains invalid for list conclusions. The valid `.10` profile above is also not an unprofiled frame-rate acceptance test. Display requests, draw counts, operation-count regressions and passing tests do not establish constant 120 fps.
