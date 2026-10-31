# Upstream 0.8.5 selective adaptation / 上游 0.8.5 选择性适配

本地预览 `0.8.5.1-preview.1` / Android `versionCode 123`。基于已保留的 `.39` 艺人图片优化，选择性适配上游，保持当前 Apple Music／Spotify 页面风格、AMLL 播放器布局及玻璃参数。

This local preview retains the `.39` artist-image improvements, current UI styles, AMLL player layout and stored glass profiles. It adapts selected upstream changes rather than merging the entire release.

## Sources / 来源

- [v0.8.5 release](https://github.com/juananzzz/resonus/releases/tag/v0.8.5): published 2026-10-31 03:27:50 Asia/Shanghai, pinned at `5a09e6ce01c56ba2e5a14639ea1e32e7faa490bc`.
- Main reviewed for selected follow-ups: `2412e891e31263a75ca651c340ccbda459d2f1ab`. Playlist membership and standard media commands below are main-only follow-ups, not part of the tagged release.
- Local source checkpoint: `a1c48fc0` (`.39`); adaptation branch: `update/upstream-0.8.5-20261031`.
- `docs/UPSTREAM-REVIEW-BASE` is not advanced: this task does not claim a complete review or merge of every intervening upstream commit.

## Included / 本次采用

| Change | Source | Glass adaptation |
| --- | --- | --- |
| Playback-load priority / 播放加载优先级 | [ec6b2cc3](https://github.com/juananzzz/resonus/commit/ec6b2cc3b3a82600fe53d3c3d95d707bc8e4c3b3) | Delay speculative stream warming and automatic cover mirroring until the current source is loaded and not buffering. Token/source/account ownership prevents stale callbacks from releasing a newer hold. Explicit user download jobs retain their existing behavior. Holds release on terminal paths and have a bounded timeout. |
| Localized network and error messages / 网络与错误提示本地化 | 0.8.5 error-message changes | Localize app-generated Navidrome/Subsonic errors and the error-boundary title/retry action in English and Simplified Chinese. Preserve error classifications, response codes, timeouts and server-provided error text. |
| Artist/album search grids / 艺人与专辑搜索网格 | [516ce51d](https://github.com/juananzzz/resonus/commit/516ce51d49db78fbaa1005ff6a27deebab657193) | Use one vertical virtualized grid for an explicit artist/album filter. Keep the All shelves, current card appearance and shared dock scroll handling. Deduplicate IDs and guard account/query transitions. The existing 20-result backend cap is retained; this is not new server pagination. |
| Playlist membership / 歌单成员管理 | [4c14dec5](https://github.com/juananzzz/resonus/commit/4c14dec5fb656c7994f3def5752992f2b875dcd5) | Keep the shared glass picker and show none/partial/all membership. Add only missing selected songs; remove all matching entries when fully present. Use fresh, unfiltered tracklists, read-only/owner checks and serialized edits rather than rewriting the entire playlist. |
| External media skip / 外部媒体切歌 | [609e2123](https://github.com/juananzzz/resonus/commit/609e212341e053fd6ab94afb3b9f9fdf3a063e4e) | Forward standard next/previous player commands to the existing JS queue, alongside existing hardware-key/custom notification callbacks. Native single-item navigation is suppressed. Existing native decoder/network fixes remain in the Expo Audio patch. |

### Playlist safety and limits / 歌单编辑边界

删除按服务器原始索引倒序执行，不使用多资料库过滤后的显示位置；每次后续删除前重新读取并核对序列。服务器返回条目数不完整、权限不允许或歌单发生变化时会中止。离线本地修改使用原始持久化 ID，账号变更不应把旧内容写入新账号。部分成功后重新读取状态。

Subsonic does not expose an atomic tracklist revision for indexed deletion. Another client can still edit between the final read and a write; the conservative rereads narrow but cannot eliminate that protocol-level race. Removing many matching entries makes multiple sequential requests and can take longer than adding one song. A failed batch can be partially applied; the UI refreshes membership instead of pretending the whole batch succeeded.

## Deferred or not applicable / 本次未移植

| Area | Reason |
| --- | --- |
| 0.01 speed steps, pitch preservation/varispeed and BPM | 涉及播放速度与音质表现，单独做完整播放验证后再考虑；本次不改现有播放速度卡片。 Requires separate audio behavior validation. |
| Android Auto fixes (`5c4dc347`, `5049b8fd`, `af9db374`, `e1964b6f`) | 需要车机或对应模拟环境验证，本轮未加入。 Requires its own car-controller validation. |
| DLNA/cast refactor (`739722b1`) and dependent follow-up (`be35651a`) | 投放状态与生命周期变更较大，应成组适配和验证。 Must be adapted as a coherent group. |
| Podcast downloads, favorites, queue/database changes, resume (`1d510bad`), played/auto-download (`93a6301d`) | 功能与持久化范围较大，不能当作独立小补丁接入。 Larger feature/storage integration deferred. |
| Ordinary pill styling (`22f6e2c2`) and global radius schema (`aa63198e`) | 与当前自定义布局、玻璃形状重复或冲突。 Would alter the current custom glass/layout. |
| Android system SeekBar plugin (`a09803cb`) | 不控制主 AMLL 自定义滑条，本轮不加入。 Does not drive the main custom player slider. |
| Bulk Chinese wording changes (`47afe65c`) | 本地已翻译的相同键保留现有用语，只补新增错误与歌单提示。 Existing local wording is retained. |
| iOS Now Playing, AltStore and publishing/build changes | 不适用于本次 Samsung Android APK。 Not applicable to this Android preview. |

长按收藏进歌单、默认封面等级、历史记录语言及完整响应超时已在以前版本适配，不重复覆盖。

Long-hold favorite-to-playlist, default cover tier, history language and complete-response deadlines were already adapted in earlier previews.

## Validation / 验证

- Full app regression suite: **886 passed, 0 failed**, followed by the Navidrome canonical-ID check.
- TypeScript type check: passed.
- Translation/dictionary/generated context check: passed. Obsolete duplicate-add prompt keys were removed after the shared membership picker replaced those prompts.
- Full lint: passed with **0 errors, 134 warnings**. Existing repository warnings remain; scoped checks for the new implementations passed.
- Expo Audio Android release Kotlin compile: passed, retaining the existing native playback patch and adding the external-command callback.
- Actual patched audio extractor harness: **44 successful checks across 10 media files**, covering full playback, duration and seeking. This does not simulate physical external controllers.
- Code review caught and corrected a delayed native pause event that could release a newer playback-load hold; regression cases cover current native state and source/account/player/song ownership.

The initial build-only task did not use the Samsung because the user was using it. The subsequent, separately authorized installation and device checks are recorded below.

## APK / 安装包

- Build: `scripts/build-glass-preview.sh`, signed ARM64 release build completed successfully.
- File: `artifacts/Resonus-Glass-v0.8.5.1-preview.1-arm64-v8a.apk`.
- App: `Resonus Glass`; package: `com.zskruc.resonus.glasspreview`.
- Version: `0.8.5.1-preview.1`; Android version code: `123`; ABI: `arm64-v8a`.
- Size: `45,462,312` bytes.
- APK SHA-256: `6b298b50f30b52c9f360c10e55fd3956ea215232a2280b5b0617c2e887a78ecb`.
- Signing certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching the installed preview signing identity. APK signature verification passed.
- This APK and source branch are local. No GitHub upload/release was performed in this task.

完整构建与检查记录保存在本机忽略目录 `.local-cache/upstream-adapt-085-20261031/`，签名私密配置未纳入版本库。最初按用户要求只构建；之后用户连接三星并授权安装测试，结果如下。

## Samsung validation / 三星实机检查

2026-10-31，Samsung **SM-S9380 / Android 17**。覆盖安装成功，系统回读为 `0.8.5.1-preview.1 / 123`，没有卸载或清除 App 数据。镜像可查看但点击接口持续报 `noWindowsAvailable`，取得用户明确授权后使用 Android 调试接口执行点击和滑动。

- **搜索**：`love` 专辑筛选显示两列竖向网格，完成三段上下滚动；`an` 艺人筛选显示三列网格并完成上下滚动。切回“全部”恢复原有分区；清空关键词后返回原最近搜索。未增加服务器分页或改变既有结果上限。
- **歌单成员**：仅新建唯一命名的临时测试歌单。创建并加入当前歌曲后显示已勾选；点击移除后取消勾选。重新从搜索打开该歌单，搜索结果与详情均显示 **0 首歌曲**，核对写入结果。只读歌单显示锁定。最后删除临时空歌单，并确认同名搜索无结果；未修改用户原有歌单。
- **播放**：播放／暂停、上一曲／下一曲以及四次间隔约 120ms 的快速下一曲／上一曲输入可操作，切歌后封面更新，实际播放计时继续前进。系统会话也记录持续前进的 PLAYING 位置。测试用歌曲至少部分已下载，本轮没有量化未缓存流媒体的首播延迟或验证实际声音质量。
- **生命周期与下拉**：播放器与歌词页各完成一次退后台再返回，稳定画面正常。歌词页顶部向下拖动可返回 Mini Player，来源搜索页、Mini Player 和底栏没有在最终画面错位或叠层。
- **错误记录**：本轮应用日志未发现致命异常或 ANR。系统退出记录最新条目为覆盖安装引起的 `PACKAGE UPDATED`，未出现安装后的新增异常退出。
- **恢复**：已回读确认恢复 **30000ms 息屏 / USB 充电常亮 0**。结束日志采集与镜像进程，歌曲回到原来的 Lover，并处于暂停状态。页面在用户恢复操作后不再自动控制。

### Remaining device coverage / 仍待专门实测

- 新标准 `MediaController` 上下曲接口需要对应客户端或真实外设。`media_session dispatch` 是媒体键路径；经 [AOSP 源码](https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/media/MediaShellCommand.java) 核对，`media_session monitor` 的 next/previous 同样通过 `dispatchMediaButtonEvent`，不能据此宣称新增标准回调已验证。本轮 monitor 仅观察状态，没有发送切歌命令。
- 多选歌曲“部分已有／补缺失”、重复条目、账号切换与服务器并发编辑已有自动回归，未在本轮设备测试中全部重演。
- 本轮是功能检查，没有进行超过 300 首的长列表耐久测试、120fps 帧时间追踪或真实网络故障注入。保存的搜索 gfxinfo 混有页面／输入法操作，不用于宣称滚动达到 120fps。

Private evidence is retained only in `.local-cache/device-085-preview1-20261031/`: installation/version readback, screenshots, app/exit logs and restored settings. No private captures or device logs were added to Git. The application source and APK were not changed during device checks.
