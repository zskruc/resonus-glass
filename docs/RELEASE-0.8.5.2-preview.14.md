# 0.8.5.2-preview.14

Android `versionCode 146` · ARM64 · 2026-11-02 · **预发布 / Prerelease**

本版汇总 `136–146` 的 Glass 增量修改，包含可选 Primuse 详情页和此前缓存修复。它不是上游所有更新的完整合并，也不替代 `0.8.5.1` 正式渠道。

## 中文

### 新布局与常听歌曲

- **设置 → 外观 → 专辑页风格 → Primuse**：居中封面、柔和封面背景、专辑取色、重排的专辑名和艺人信息，以及半透明歌曲底板。
- **设置 → 外观 → 歌单页风格 → Primuse**：将同一构图适配到歌单。专辑／歌单选择独立保存，艺人页布局、Volta／Minidisc 专辑和紧凑歌单继续保留。
- 艺人和专辑页新增「常听歌曲」，最多 5 首，按服务器／本地可用的个人播放记录排序，取两者较大值避免重复计次。艺人页利用已经加载的歌曲，不为此额外拉取整个作品库；没有记录时隐藏，不以热门或随机歌曲代替。

参考 [Primuse](https://github.com/chenqi92/primuse) 的专辑构图和取色规则，在 React Native／Kotlin 中适配。背景由本地封面生成一次静态模糊纹理，滚动时移动既有图层；深浅模式分别映射文字对比。Android 采样及模糊与 SwiftUI 存在差异，不承诺逐像素一致。来源与 MIT 许可证见[第三方声明](../THIRD_PARTY_NOTICES.md#optional-primuse-album-and-playlist-presentation)。

### 显示与分隔修复

- 进入时协调封面、模糊背景和内容的就绪状态，退出时共同淡出；冷图仍可能先显示短暂的同色准备背景。
- 缓存重验和重复显示通知不再重新隐藏已显示的页面。高清封面切换为本地文件时保留页头尺寸，避免卡在「正在读取」；错误有可读的渐变回退。
- 搜索展开时向上延伸现有模糊区域，不移动封面或下方渐隐位置；调整背景尺寸、淡出范围及推荐区文字对比。
- 移除碟片标题附近多余的硬边横线，保留歌曲行分隔；Primuse 底板在碟片交界处跳过重复横线。此改动适用于共用歌曲列表的现有专辑布局。

### 高清封面与缓存

- 歌单详情、编辑预览和放大查看请求 1200px 封面，在线升级旧低清缓存；新文件成功保存后再切换，失败或离线保留旧图。低分辨率原始来源无法凭请求尺寸增加细节。[高清封面说明](./PLAYLIST-HD-PREVIEW-136.md)。
- 批量任务启动／继续时实时检查连接并显示阻止原因，承接原检查点。[启动修复](./BULK-CACHE-START-PREVIEW-137.md)。
- 歌词缓存最多 3 个任务并行，避免重复读写；保留逐词计时、暂停和迟到响应保护。外部歌词请求另行串行、节流，并按 `Retry-After` 有限重试；纯音乐结果不再误走额外搜索，超长录音不发送来源不支持的时长。[提速说明](./LYRICS-CACHE-SPEED-PREVIEW-138.md) · [失败项补跑说明](./LYRICS-RECOVERY-PREVIEW-140.md)。
- 外部服务仍可能不可用；失败继续保留为失败或可重试，不伪装成成功或无歌词。保留现有缓存、离线音乐、登录、播放器布局与玻璃参数。

### 检查与边界

- 发布前以 `146` 源码重新完成全部 1169 项测试、类型与翻译检查；此前的 43 项布局／列表回收检查也通过。先前 Primuse 适配另通过原生像素、调色和页面生命周期检查。自动检查不能代替实际帧率与长时使用验证。
- 三星 `142` 的录屏检查覆盖《Unorthodox Jukebox》专辑进入、退出、再次进入与 Bruno Mars 艺人／常听区；采集帧中未观察到中间白屏或封面／背景分开消失。曾先打开过专辑，不能据此认定所有首次联网加载都相同。
- 三星 `145` 已检查 ASMR 页面、搜索和推荐区；`146` 已覆盖安装并确认版本，**本版碟片横线修复尚未实机视觉复核**。不将此前版本的检查写成本版完整复测。
- 本版不保证所有页面都无闪烁、持续 120 fps、长期内存恒定或外部歌词全部成功。当前图库保留原有截图，未为此版新增截图。

## English

### Layouts and personal history

- Select **Settings → Appearance → Album page style → Primuse** for centered artwork, an artwork-colored soft background, revised album/artist typography and translucent track panels.
- Select **Settings → Appearance → Playlist page style → Primuse** for the corresponding playlist composition. Preferences are independent; Artist page layout, Volta/Minidisc albums and Compact playlists remain available.
- Artist and album pages can show up to five **Frequently played songs**, ranked using available personal server/local counts. Taking the larger count avoids counting a synchronized listen twice. Artist pages reuse already loaded songs rather than fetching an entire discography. Empty history stays hidden instead of using popular or random tracks.

The React Native/Kotlin adaptation references [Primuse](https://github.com/chenqi92/primuse)'s album composition and color policy. It prepares a static blurred texture from local artwork and moves existing layers while scrolling, with readable light/dark palettes. Android sampling/blur differs from SwiftUI; pixel identity is not claimed. See [attribution and the MIT license](../THIRD_PARTY_NOTICES.md#optional-primuse-album-and-playlist-presentation).

### Display and cache changes

- Coordinates cover, background and content readiness and their exit fade. Cold artwork can still require a short matching preparation background. Already displayed pages remain visible during same-image cache revalidation. Header measurements survive an HD source URI change to prevent permanent loading; failures settle to a readable gradient.
- Extends blur above the revealed search row without shifting the cover or lower fade, refines background geometry and recommendation contrast, and removes redundant disc-heading lines while retaining normal row dividers.
- Carries forward codes `136–140`: 1200px playlist artwork requests and safe upgrades of older caches, live network checks when starting/resuming bulk tasks, up to three lyric workers, fewer duplicate reads/writes and guarded pause/late-response behavior. External lyric calls are separately serialized/throttled, with bounded `Retry-After` retries and corrected instrumental/long-recording handling.
- The original source can still be low-resolution, and external lyric services can still fail. Failures remain retryable rather than becoming fabricated successes or missing-lyric results. Existing caches, downloaded music, sign-in, player layout and glass profiles remain.

### Validation limits

- Before publication, code `146` passed all 1169 tests, typechecking and translation checks; the earlier 43 layout/recycling checks also passed. Earlier Primuse work also passed native pixel, palette and lifecycle checks. These checks do not establish physical frame rate or long-session stability.
- Samsung recordings from `142` cover entry/exit/re-entry of *Unorthodox Jukebox* and Bruno Mars artist/frequently played content. No intermediate white flash or independently disappearing cover/background was observed in the sampled frames. The album had been opened before; first-ever network loading and all other pages were not established.
- Samsung checks in `145` cover the ASMR page, search and recommendations. Code `146` was installed and version-verified only; **the disc-line fix has not yet received a device visual check**. Prior checks are not presented as a complete retest of this APK.
- No claim is made of universally flash-free navigation, sustained 120 fps, constant long-session memory or successful lyrics for every track. The README retains its existing gallery without new captures.

## APK

[下载预发布 / Download prerelease](https://github.com/zskruc/resonus-glass/releases/tag/v0.8.5.2-preview.14)

- File: `Resonus-Glass-v0.8.5.2-preview.14-code146-arm64-v8a.apk`
- Size: `45,848,212` bytes
- SHA-256: `2a715dd1d6b262439c1ad3ad4155f70a1a94a038aaf393d9d3dff35eb605b274`

沿用现有 Glass 包名和签名，覆盖安装以保留资料；请勿卸载。此预发布需要手动下载，不进入 App 的正式更新检查。

Uses the existing Glass package/signing identity. Update in place to retain data; do not uninstall. This prerelease requires manual download and is excluded from the app's stable update check.
