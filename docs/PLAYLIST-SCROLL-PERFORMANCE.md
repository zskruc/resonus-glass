# 播放列表滚动修复 / Playlist scrolling work

`0.8.4.1-amll.9` · Android `versionCode 91` · `preview/amll-player`

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

`.9` ARM64 APK 已构建并核对版本、包名、原签名及 RN 二进制 Build ID；425 项应用测试、113 项玻璃模块测试、两组实际源码方法回归通过。官方 0.86.3 AAR 的 SHA256 与 Maven 发布元数据一致；反汇编确认两处事件派发都在复制目标前加锁，`.9` APK 也包含同一二进制。

`.8` 的临时 Release 热点采样成功导出并符号化，但画面离开了目标播放列表，已作废，不能用其 JS 空栈比例或帧时间宣称列表改善。`.9` 不含临时性能记录入口。手机 USB 当前断开，尚未安装 `.9`；原生手势仲裁、连续长列表滚动、崩溃恢复和内存复测仍待完成，不承诺恒定 120 fps。

The `.9` ARM64 APK’s version, package, original certificate and RN binary Build ID were verified. All 425 app tests, 113 glass-module tests and both actual-source native-method harnesses passed. The official RN 0.86.3 AAR matches its Maven SHA256; disassembly confirms both locked event-target snapshots, and `.9` embeds the same binary.

The temporary `.8` Release profiler exported and symbolicated successfully, but the screen left the target playlist. That capture is invalid for list performance, including its root-only sample ratio and frame times. `.9` excludes the diagnostic receiver. USB is disconnected and `.9` is not installed; native gesture arbitration, sustained long-list scrolling, crash recovery and memory acceptance remain pending. Constant 120 fps is not claimed.
