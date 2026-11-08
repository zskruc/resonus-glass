# 0.8.7.1-preview.2

Android `versionCode 148` · ARM64 · 2026-11-09 · **预发布 / Prerelease**

本版发布此前未上架的 `147–148` 两批选择性上游适配，包含四项修复及六组可选功能。保留当前 Apple Music／Spotify 页面、AMLL 播放器、艺人图片取色和已保存的玻璃参数。

## 中文

### 本轮新增与修复（148）

- 探索的「已下载」可筛选本机歌曲、专辑、艺人和歌单；全部歌曲均已下载的歌单显示下载标记。
- **设置 → 外观 → 音乐库分类**：拖动排序、显示或隐藏分类；专辑浏览增加「专辑艺人」排序。
- 播客可按新旧或标题排序，播放顺序与列表一致；整档下载先确认缺失集数和已知总时长。
- 保存队列时记忆播放速度，恢复期间不会用旧结果覆盖新的手动选择，保留现有音调校正。
- 逐字歌词保持同一英文单词不被拆行；取消 Mini Player 上拉时清理未完成的播放器触摸层。
- 下载诊断增加经过脱敏的失败分类与格式信息，暂停、取消不误计为失败。
- DLNA 增加新歌曲加载后的重复播放保护和更多曲终判定。
- 修复玻璃弹窗关闭时可能把原生点击事件当作完成回调造成的崩溃；补齐播客操作的简体中文，并确保仅修改翻译时 APK 内字典也会更新。

### 同时发布的前一批适配（147）

- 音乐库刷新失败保留已有内容；补充艺人菜单、离线标识和创建歌单后直接打开。
- 歌单拖动排序使用覆盖层，每次落下串行保存最新顺序；普通浏览继续使用原列表。
- 播客收藏、已播标记、进度续播和下载管理；逐节目启用的新集自动下载仅在确认 Wi-Fi 时运行，启动、恢复前台或刷新时检查，每批最多 3 集，不是进程终止后的常驻 RSS 扫描。
- 有声书书架与章节进度，设置中可启用保存及调整续播回退；默认关闭进度保存。
- 本地播放次数按账号隔离，保留旧数据恢复副本；补充队列归属校验、设置底部留白及 DLNA 状态衔接。

### 已验证的范围

- **1,338 项 JavaScript／TypeScript 测试、23 项原生 JUnit 测试通过**；类型、翻译和字典检查通过。ESLint 为 0 错误、146 警告。
- Samsung SM-S9380／Android 17 已检查下载分类、完整下载标记、分类排序／隐藏、专辑艺人排序、倍速更新后记忆、播客顺序与下载确认，以及播放器展开、下拉返回和退后台恢复。
- 最终包复测关闭播放速度弹窗成功，记录中未出现新的致命异常、ANR 或 OOM。未据此承诺持续 120 fps、长时间内存恒定或所有页面无异常；DLNA 仍需真实接收设备验证。
- 本次没有整档下载播客，也未重新验证所有后台下载、带标签的有声书续播或每首歌词。原始私人日志和屏幕不作为公开附件。

## English

This release publishes the previously local code `147–148` adaptations. Existing Apple Music/Spotify layouts, AMLL player, artist palette and saved glass profiles are retained.

- Browse local downloads across songs, albums, artists and playlists, with complete-download playlist badges. Reorder/hide library categories under **Settings → Appearance → Library categories**, and sort albums by album artist.
- Sort podcast episodes with matching playback order; confirm a whole-show download using missing-episode counts and known duration.
- Preserve playback speed with the saved queue, keep timed syllables of one word together, guard canceled player reveals, and add credential-safe download failure diagnostics.
- Improve DLNA repeated-play protection and end detection. Fix shared glass-card close callbacks receiving native press events, translate podcast actions and refresh bundled dictionaries for translation-only changes.
- Code `147` also adds safer library refresh and playlist reorder persistence, profile-owned play counts, podcast favorites/resume/download management, optional audiobook chapter resume, settings padding and cast-state fixes. Podcast automatic downloads check for new episodes at startup, foreground return or refresh, require confirmed Wi-Fi, and admit at most three episodes per batch; no RSS polling runs after process termination.

**Validation:** 1,338 JS/TS tests and 23 native JUnit tests passed, alongside type and translation checks. ESLint has 0 errors and 146 warnings. Samsung SM-S9380/Android 17 checks cover downloaded categories, badges, category preferences, album-artist sorting, saved speed, podcast ordering/confirmation, player open/pull-down, card closing and background return. Final-package logs showed no new fatal exception, ANR or OOM in this scoped run. Physical DLNA receivers, sustained frame rates, long-session memory, whole-feed downloads and every audiobook/lyric case remain outside this acceptance.

## APK

[下载预发布 / Download prerelease](https://github.com/zskruc/resonus-glass/releases/tag/v0.8.7.1-preview.2)

- File: `Resonus-Glass-v0.8.7.1-preview.2-code148-arm64-v8a.apk`
- Size: `46,075,328` bytes
- Package: `com.zskruc.resonus.glasspreview`
- Built source: `d569ab49f782cd76280599382c7bf4bc08707302` (the release tag also includes subsequent documentation-only commits)
- SHA-256: `b3e12101c41c2178b7832a3730f5cc41096cfd53653e6fd33cde210f880ad645`

沿用现有 Glass 包名与签名，覆盖安装以保留登录及离线资料。此预发布需手动下载，不进入 App 的正式更新检查。

Uses the existing Glass package and signing identity. Update in place to retain sign-in and offline data. This prerelease requires manual download and is excluded from the app's stable update check.

Sources and detailed boundaries: [code 148 adaptation](./UPSTREAM-ADAPTATION-20261109.md) · [code 147 adaptation](./UPSTREAM-0.8.7-ADAPTATION-20261103.md).
