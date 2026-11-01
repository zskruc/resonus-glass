# Resonus Glass 0.8.5.1 候选 / Candidate

2026-11-01 · ARM64 Android · `versionCode 132`

## 发布范围 / Release scope

本版以公开 `0.8.5.1-preview.6` 为基线，单独整合艺人页上滑修复与 Android 原生遮罩生命周期补丁，待实机验证通过后再进入正式更新渠道。此前的双界面风格、可选专辑／歌单布局、下载管理、封面／歌词缓存、音乐工具和选择性上游适配继续保留。React Native Screen Transitions／Gorhom Bottom Sheet 仍属于独立本地实验，不随此版发布。

This unpublished candidate starts from the published preview.6 baseline and selectively adds the artist-scroll correction and native Android mask-lifecycle patch. It retains the existing UI choices, album/playlist layouts, downloads, artwork/lyrics caching, music tools and reviewed upstream adaptations. The separate RN Screen Transitions/Gorhom experiment is excluded.

## 当前状态 / Current status

**尚未发布正式 Release。** 首个 `versionCode 131` 包虽通过编译、987 项检查和短时布局检查，在同一艺人／专辑连续跳转中仍复现资源增长：第4对跳转时 Bitmap 分配为361,977KB，第8对为816,115KB。因此该包不作为正式交付。`132` 候选进一步限制保留页面的原生图片资源，保留页面数据、滚动和选择状态；需下一轮三星复测，不能据静态检查宣称长期流畅。

**No stable release is published yet.** Code 131 passed the build, 987 checks and short layout checks but failed deep navigation: allocated Bitmap memory rose from361,977KB after four artist/album pairs to816,115KB after eight. It is rejected for stable publication. Candidate132 additionally bounds retained-page image ownership while preserving page/scroll/selection state; device validation is still required.

## 132 候选的资源生命周期修正 / Candidate132 resource ownership

根导航独立订阅页面归属，保留 tabs、最近两个不透明页面和相关播放器／歌词／队列下层。转场前后资源在动画结束前同时保留；较旧页面先提交原生 Image／Mask／名字句柄的释放，再由 React Activity 停驻，页面数据、滚动与选择状态不被重建。统一 Cover 门禁覆盖专辑横排、相关艺人与歌曲封面；主图、导航副本和播放器／歌词大图另有门禁。全局 Mini Player 与共享封面覆盖层保持独立生命周期。

同 URI 重新显示时，旧图片回调不能影响新图片。真实 React 回归覆盖12组连续艺人／专辑跳转，图片和 Mask host 数量有界，并检查状态身份、透明下层、迟到回调及 Suspense 下名字句柄归属。此项是实际 React 生命周期测试，不是 Android 原生内存或帧率验收。

The independent navigation observer retains tabs, the latest two opaque pages and relevant player/lyrics/queue underlays, keeping both sides through transitions. Older pages commit native image/mask/handle release before React Activity parks their preserved state. Real React tests cover twelve artist/album navigation pairs, bounded host ownership, state identity, transparent underlays, stale callbacks and native-name handle ownership. Android memory and frame-time validation is still pending.

## 本次修改 / Changes

- **照片移动与标题交接**：根据同设备参考帧，将可见区照片位移调整为内容位移约 0.4 倍；姓名和官方名字图按真实底边经过顶栏的位置连续交接。参考画面不足以推断 Apple 内部的完整曲线或着色器。
- **完整渐变场**：照片、已经生成的静态模糊延伸和共同遮罩在列表外的同一持久层移动，避免固定边界截断渐变或 Header 回收时提前移除背景。使用艺人页布局的专辑／歌单同步采用，滚动过程中不新增图片请求、取色或模糊生成。
- **打开艺人页报错**：无依赖 Worklet helper 先于调用者初始化；真实生产转换回归覆盖曾发生的 `undefined is not a function`。
- **原生遮罩资源**：Android 页面脱离窗口时释放 MaskedView 的大尺寸位图，重新连接时重建；遮罩元素移除时也清理旧位图。保留页面对象不再同时保留这份可重建位图。此项是资源生命周期修正，不凭代码修改断言已根治全部卡顿。

The photo now follows the reference-derived slower motion, while title handoff uses measured name/wordmark bounds. The complete prepared image field persists outside scrolling/recycled headers. A worklet initialization-order correction prevents the artist-page opening error. Native masks release their rebuildable bitmap when detached and recreate it on return; this resource fix alone is not proof that every source of jank is resolved.

播放器静止布局、保存的玻璃参数、用户资料和已完成离线下载保持原设置。照片移动与裁切的实现细节、原实验包记录见[艺人上滑说明](./ARTIST-SCROLL-MOTION-2.md)。

## 验证与边界 / Validation and limits

- 本候选分支 **1005 项应用测试、类型与翻译检查通过**。原始 `.motion.2` 的 1,003 项测试和安装包哈希属于另一条带转场实验的分支，不能代替本版的验证。
- 修复前，在已有长时间运行进程的实际艺人页滚动中，带应用与 Surface 归属校验的记录包含 **80 个有效应用 Surface 帧**：帧时长中位数约 **109.36 ms**，目标时长约 **8.33 ms**。该记录确认了严重迟帧，但不是完整物理屏幕 FPS，也不能单独把全部延迟归因于某一组件。
- 早先不符合目标进程归属检查的对照记录不用于性能结论。原始跟踪、设备日志及私人参考截图仅保留本地，不上传。

All 1005 app tests, type and translation checks pass on this candidate branch. The prior experimental build's test count/hash is historical and does not validate this APK. A guarded pre-fix trace of an existing long-lived process contains 80 actual application Surface frames, with median duration 109.36 ms against an 8.33 ms target. These are application frame durations, not complete physical-display FPS; the trace establishes severe late frames without assigning every delay to one component. A prior control trace that failed process attribution is excluded.

<!-- RELEASE_FINAL_VERIFICATION -->
**发布前待补：** 原生构建、最终 APK 的版本／签名／SHA-256，以及本轮三星实机的上滑、页面返回和连续滚动结果。当前尚未据此声明卡顿已完全修复或持续达到 120 fps。

**Before publication:** complete the native build, verify the final APK version/signature/SHA-256, and record this build's Samsung scroll, navigation-return and sustained-scroll checks. No claim of fully resolved jank or sustained 120 fps is made at this stage.
<!-- /RELEASE_FINAL_VERIFICATION -->

## 安装 / Install

本候选尚未发布。实机验证通过后，将在本仓库 Release 提供 `Resonus-Glass-v0.8.5.1-arm64-v8a.apk`。包名为 `com.zskruc.resonus.glasspreview`，沿用现有 Glass 签名，可覆盖更新保留资料；不要先卸载。原版 Resonus 使用独立包名，不能与本 APK 互相覆盖。

This candidate is unpublished. After device validation, the repository release will provide `Resonus-Glass-v0.8.5.1-arm64-v8a.apk`. It retains the existing Glass package and signing identity for in-place updates. Do not uninstall first. The upstream Resonus app has a different package identity.
