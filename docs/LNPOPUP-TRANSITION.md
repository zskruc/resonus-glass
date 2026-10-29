# LNPopup 展开与收合预览 / LNPopup presentation preview

`0.8.4.1-amll.26` · Android `versionCode 109` · `preview/amll-player`

此版本按用户选定的 [LNPopupUI](https://github.com/LeoNatan/LNPopupUI) 展开／收合交互适配 Android，播放器静止布局、图标、字号、玻璃光学参数及保存的调节档案不变。当前是供三星测试的 APK；未经本版本的实机录制验收，不将源码测试或构建成功称为逐帧一致、持续 120fps 或无抖动的证明。

This preview adapts the selected LNPopupUI opening/closing interaction to Android. Settled player layout, icons, typography, optical parameters and saved tuning profiles are unchanged. It is an APK for Samsung testing; source tests and a successful build do not establish device-level frame matching, sustained 120fps or absence of jitter.

## 引用与适配 / Source and adaptation

- Wrapper: `LeoNatan/LNPopupUI` at `60853564423524c9ed15cc74c5969d3e1ca666f1`.
- Implementation: `LeoNatan/LNPopupController` at `2e20c7e1bc8990d58d81c74b8a17df9b5b433a1a`, `Private/LNPopupController.mm` and `Private/TransitionAnimators/`.
- Copyright (c) 2015-2025 Léo Natan, MIT. [Complete license](../licenses/LNPOPUPCONTROLLER-MIT.txt); [notices](../THIRD_PARTY_NOTICES.md).

上游使用 UIKit 属性动画、Portal 图层及 Apple 玻璃环境，不能直接运行在 Android。此处用 Reanimated 的 UI 线程进度与两个固定布局的原生裁切宿主实现相应行为，不引入 UIKit 私有接口、不每帧截图、不在 JS 线程逐帧改变布局。

Upstream uses UIKit property animation, portal layers and Apple glass. This adaptation uses UI-thread Reanimated progress with two fixed-layout native clip hosts. It imports no UIKit private APIs, takes no per-frame screenshots and performs no per-frame JS layout writes.

## 行为 / Behavior

- Mini 点按或明确上拉按 Automatic 的收起状态 Snap 模型完整展开；大播放器在原有封面／信息下拉区域中跟手收合。歌词滚动和播放控件的输入范围保留。
- 容器边界、圆角、封面及 mini/tabs 的显隐由同一进度驱动；内容保持原布局，独立控件滑入及来源页面景深缩放撤销。
- 松手后以约 500ms 的弹簧意图完成或回弹；点击阻尼比 1.0，手势 0.87。Reanimated 的时长按其感知时长换算，不能等同于 UIKit 求解器。
- 内容显隐参考上游 10%／15% 关键帧阶段，映射到可逆进度；中途反向保留当前透明度。封面裁切和清晰度交接使用独立的几何进度，不跟随内容淡入曲线。
- 每段过渡只测量端点；关闭落到 Mini 的静止封面坐标。保留 owner／generation、路由来源、动画修订号及 p=0 交接，完成后才移除播放器路由。
- 背景和交互内容分别保留全屏布局、使用同一裁切轮廓；原生内容宿主允许正常子控件输入，背景宿主继续忽略触摸。Android 后台保留完整 scene 的 `.24` 修复继续保留。

- Tapping or clearly pulling up the mini snaps open, matching Automatic in its compact state. The existing cover/metadata downward area drags the full player; lyric scrolling and transport input boundaries remain.
- One progress coordinates container bounds, corners, artwork and mini/tabs visibility. Content retains its layout, without a separate controls slide or originating-page depth zoom.
- Release completes or rebounds with the source's approximately 500ms spring intent, damping ratio 1.0 for tap and .87 for gesture. Reanimated duration conversion does not reproduce UIKit's solver exactly.
- Source 10%/15% foreground phases are mapped to reversible progress; reversal anchors preserve current alpha. Artwork crop/resolution handoff uses geometry, independently of foreground fade.
- Endpoints are measured once per transaction; closing lands on the resting mini cover. Owner/generation, originating route, animation revision and p=0 handoff prevent stale completion from changing a newer player. Route removal follows completion.
- Background and interactive content retain separate full-screen native hosts with identical clipping. Content permits child input while the background remains decorative. The `.24` Android background-scene retention fix remains.

## 三星检查重点 / Samsung acceptance focus

1. 从首页、专辑、歌单分别点按 Mini 展开，确认静止布局与当前版本一致。
2. 从封面模式和歌词信息区下拉：拖动期间封面与容器连续缩小，松手收合后 Mini/Tabs 同时就位。
3. 下拉后反向向上并松手、快速返回、反复开合，检查回弹、点击、裁切及封面落点。
4. 检查播放器按钮、歌曲／艺人跳转、歌词滚动及深浅模式；从歌词进入后台再返回，确认 `.24` 修复未回退。

1. Open from Home, album and playlist; verify unchanged settled layout.
2. Pull from artwork or lyric header; check continuous cover/container shrink and synchronized mini/tabs arrival.
3. Reverse/cancel a pull, rapidly Back, and repeat presentation; check rebound, input, clipping and artwork landing.
4. Check controls, title/artist navigation, lyric scrolling and appearance changes; background from lyrics and return to check the retained-scene fix.

## `.26` 上拉手势修复 / `.26` upward gesture fix

三星 `.25` 实测发现 Mini 的上拉未触发展开。Android RNGH 在 Pan 激活时调用 `resetProgress()`，开始事件可能同时给出零横纵位移；此前在开始事件中用 `abs(x) >= abs(y)` 立即锁轴，因而误判为横向。`.26` 在开始时保留未定方向，等待首个超过微小抖动范围的移动事件后只锁定一次方向。点按展开、播放器布局、玻璃参数和 `.25` 收合模型保持不变。

Samsung `.25` testing found mini upward swipes did not open. Android RNGH resets Pan progress on activation, so its start event can report zero X/Y translation. Choosing an axis immediately with `abs(x) >= abs(y)` locked that gesture horizontally. `.26` leaves direction undecided until the first movement beyond small touch jitter and then locks it once. Tap presentation, player layout, glass tuning and the `.25` closing model remain unchanged.

`.26` 的 625 项应用测试、类型和翻译检查通过。新增 7 项实际 Mini 组件测试在修复前源码上有 5 项失败，修复后全部通过；改动未增加现有 lint 警告。此次未改原生或光学代码，147 项原生测试的源码与 `.25` 相同。最终 APK 核对及三星复测状态以下方记录为准。

All 625 app tests, typechecking and translation checks pass for `.26`. The seven new mounted mini-component tests fail five cases against the original source and all pass after the fix; no new lint warnings were added. Native/optical source is unchanged from the 147-test `.25` native result. Final package verification and Samsung retest status are recorded below.

`.26` ARM64 Release 已构建成功，包名 `com.zskruc.resonus.glasspreview`、版本 `109` 与原签名核对通过，可覆盖升级。手机已断开，本包尚未安装；上拉实机复测待重新连接。

The `.26` ARM64 release is built with package `com.zskruc.resonus.glasspreview`, version code `109` and the original signing certificate verified for in-place update. The phone was disconnected; this package is not installed and upward gesture device acceptance awaits reconnection.

APK: `Resonus-Glass-AMLL-v0.8.4.1-amll.26-arm64-v8a.apk`
SHA-256: `fd743e38704497b7862b063d6339c2187613b5fe148fe74c2684b4dd1cc6e4b6`

## `.25` 实机记录 / `.25` device record

`.25` 已以原包名、原签名覆盖安装到三星，首次安装时间保持不变。实测确认点按 Mini 展开、歌词按钮、歌词信息区下拉收合、封面下拉缩小、反向取消后恢复完整播放器，以及取消后打开输出设备、打开播放队列并返回可用；当前测试进程未记录 JavaScript 错误。上拉展开重复未触发，不能作为通过验收；已定位并在 `.26` 修复，待下次连接复测。录制及截图仅留本地，有限样本不证明持续 120fps 或逐帧一致。

`.25` was installed in place on Samsung with the existing package/certificate and unchanged first-install time. Device checks confirmed mini tap opening, the lyric button and header dismissal, cover drag shrink, reverse-cancel restoring the full player, output access after cancellation, and queue opening/return. No JavaScript errors were logged for the test process. Repeated upward intents did not open and are explicitly not accepted; `.26` corrects the identified admission issue pending reconnection. Captures remain local; these samples establish neither sustained 120fps nor frame identity.

## `.25` 构建检查 / `.25` build verification

618 项应用测试、147 项玻璃模块原生测试、类型与翻译检查通过；改动源码 lint 无错误。ARM64 Release APK 已构建成功，核对为 `.25` / `108`、`com.zskruc.resonus.glasspreview`，签名与 `.24` 相同，可覆盖升级；未卸载、安装或操作手机。

All 618 app tests, 147 glass-module native tests, typechecking and translation checks pass; targeted source lint has no errors. The ARM64 release APK is built and verified as `.25` / `108`, package `com.zskruc.resonus.glasspreview`, with the same certificate as `.24` for an in-place update. No phone installation, uninstall or operation was performed in this round.

APK: `Resonus-Glass-AMLL-v0.8.4.1-amll.25-arm64-v8a.apk`
SHA-256: `3a019eff6f84f18157c546912684c80f10cf189eb16304739ecf58f3bee50382`
