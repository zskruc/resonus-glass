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

No Samsung installation or device test is part of this task: the user is using the phone. Search/card appearance, actual controller behavior, long-playlist scrolling and live playlist edits still need device/server validation.

## APK / 安装包

- Build: `scripts/build-glass-preview.sh`, signed ARM64 release build completed successfully.
- File: `artifacts/Resonus-Glass-v0.8.5.1-preview.1-arm64-v8a.apk`.
- App: `Resonus Glass`; package: `com.zskruc.resonus.glasspreview`.
- Version: `0.8.5.1-preview.1`; Android version code: `123`; ABI: `arm64-v8a`.
- Size: `45,462,312` bytes.
- APK SHA-256: `6b298b50f30b52c9f360c10e55fd3956ea215232a2280b5b0617c2e887a78ecb`.
- Signing certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching the installed preview signing identity. APK signature verification passed.
- This APK and source branch are local. No GitHub upload/release was performed in this task.

完整构建与检查记录保存在本机忽略目录 `.local-cache/upstream-adapt-085-20261031/`，签名私密配置未纳入版本库。此次按用户要求只构建，未连接、安装或操作三星。
