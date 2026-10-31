# 歌单双布局与音乐工具 / Playlist layouts and music tools

开发预览 / Development preview：`0.8.5.1-preview.3`，Android `versionCode 125`。

本轮保留现有播放器静止布局、玻璃参数与用户资料，在此基础上重排歌单详情，并接入此前列出的七项音乐工具。以下说明区分已实现功能、使用边界和下一轮建议。构建及验证收据在本文末尾登记。

This preview retains the settled player layout, glass profiles and user data while updating playlist details and implementing the seven previously listed music tools. Implemented behavior, limits and future suggestions are separated below. Build and validation receipts belong at the end of this document.

## 歌单页面 / Playlist pages

**设置 → 外观 → 界面风格**继续切换 Apple Music／Spotify。两种风格使用同一曲库、播放队列和歌单资料，分别排版：

- Apple Music 风格：紧凑居中封面，居中的标题、创建者及元数据；播放与随机播放为并排的带文字按钮，下载、收藏等辅助操作集中在下方。
- Spotify 风格：封面同样缩小，信息左对齐；辅助操作、随机播放与右侧圆形播放按钮位于一条操作区。
- 封面按窗口宽高适配，Apple Music 上限 216dp，Spotify 上限 232dp，并受屏幕高度约 26% 的限制；保留完整方形封面，不通过裁掉图片缩短页面。长描述默认两行，可展开。
- 继续使用既有虚拟化歌曲列表与歌单成员管理。未添加随滚动实时重算的封面模糊，也没有改动 Volta／Minidisc 专辑页切换。

**Settings → Appearance → UI style** continues to select Apple Music or Spotify. Both share the same library, playback and playlists. Apple Music uses centered compact artwork/information, paired labeled Play/Shuffle buttons and a separate utility row. Spotify keeps left-aligned information and an action row with utilities, shuffle and a right-hand circular Play button. Artwork fits the viewport, capped at 216dp/232dp respectively and approximately 26% of screen height. Covers remain square, descriptions expand from two lines, and the existing virtualized track list remains. No scrolling artwork-blur calculation or album-style change is introduced.

## 七项功能 / Seven tools

### 1. 单曲歌词校时 / Per-song lyric timing

入口：**设置 → 播放器 → 歌词工具**，或歌曲的 **⋯ → 歌词工具**。设置入口使用当前歌曲，歌曲菜单入口使用选中的歌曲。

同步歌词可提前／延后最多 15 秒，滑条按 100ms 调节，精调可到 10ms，并可恢复该歌曲的零偏移。负数提前显示，正数延后显示。各播放界面从同一歌词入口读取偏移，行、逐字与和声时间一起平移；未同步的纯文本无法校时。参数按账户与歌曲保存，原歌词文件、服务端内容及下载副本不被改写。

Open **Settings → Player → Lyrics tools** for the current song or **song ⋯ → Lyrics tools** for the selected song. Synchronized lyrics shift up to ±15 seconds, with 100ms steps, 10ms fine adjustment and a per-song reset. Negative values show lyrics earlier. Shared lyric data shifts line, word and background-vocal timing together across player views. Unsynchronized text cannot be timed. Account-scoped offsets do not rewrite source/server/downloaded lyrics.

### 2. 歌单导入／导出 / Playlist exchange

入口：**设置 → 音乐库 → 音乐工具 → 歌单导入与导出**；歌单详情 **⋯ → 歌单导入与导出**额外提供该歌单的导出操作。

1. 选择 M3U、M3U8 或 Resonus JSON 文件，最多 5MB、10,000 个条目。
2. 分页读取当前启用曲库，按标题、艺人、专辑和时长等资料匹配。查看每一条结果；有歧义时选择候选，也可搜索曲库、跳过条目或导出未匹配清单。
3. 编辑名称，选择“将已匹配歌曲导入新歌单”。仅创建独立的新歌单，不替换或重写已有歌单；保留已选歌曲的原顺序及重复条目。网络失败可能留下空或部分新歌单，页面会明确提示。

导出为便携元数据 JSON 或使用相对音乐路径的 M3U8，不导出带账号认证的串流链接。导入文件里的网络地址只是匹配资料，不会下载或播放这些外部链接。离线只匹配当前账户可用的本地资料，联网账户离线创建的歌单沿用原有离线队列同步机制。切换账户、离线来源或启用曲库后，需要重新打开交换页面。

Open **Settings → Library → Music tools → Playlist import and export**, or the playlist detail **⋯** menu to export that list. Choose M3U, M3U8 or Resonus JSON, limited to 5MB/10,000 entries. Review metadata matches against the enabled library, manually resolve ambiguous candidates, search, skip or save an unmatched report. Import creates a separate new list, retaining selected order and duplicate entries. Existing playlists are never replaced; a failed request may leave an explicitly reported empty/partial new list. Exports contain portable metadata or relative music paths, without authenticated stream URLs. External links in imported files are never fetched. Offline matching uses available local data and the existing offline mutation outbox. Reopen after changing account, source or enabled libraries.

### 3. 听歌统计与年度回顾 / Listening statistics and yearly review

入口：**设置 → 音乐库 → 音乐工具 → 听歌统计**。可关闭本机记录，查看最近 7 天、最近 30 天或指定年份的听歌时间、不同歌曲数、合格会话数、趋势图及歌曲／艺人排行。

- 秒数来自本版本启用后实际向前播放的采样，按本地日期汇总并持久化到账户隔离的 SQLite。拖动进度、缓冲、长时间缺失采样和后台堆积补发不会补成听歌时长；倍速按真实经过时间计算。
- 一段会话真实听满 30 秒，或较短歌曲的一半后计一次。暂停后继续不重复计次；拖动进度不重复计次；**同一歌曲连续循环视为一段会话**。缺少明确的播放周期事件时，不凭位置跳回零猜测新播放。
- “合格听歌会话”与服务器／原有离线累计播放次数有不同定义。**累计最常播放**入口继续使用原计数，两者不会混加。
- 年报只展示本机实际记录过的数据，不从最近播放列表或服务器累计数推造过去年度；更早年份没有记录就没有听歌时长。移除账户同时移除该账户的本机统计与规则资料。

Open **Settings → Library → Music tools → Listening statistics**. Recording can be disabled; reports cover the last 7/30 days or a year, showing real listening time, distinct songs, qualified sessions, trends and song/artist rankings. Account-scoped SQLite stores local-day aggregates from advancing playback observed in this version. Seeks, buffering, missing/backlogged samples add no fabricated time; speed-adjusted media progress is capped by real elapsed time. A session qualifies after 30 real seconds or half a shorter song. Pause/resume and seeking do not add a session; **continuous same-song repeats form one session**. Existing server/local all-time counters remain a separate ranking. Historical yearly time is never reconstructed from aggregate counts. Removing an account clears its local report/rule data.

### 4. 规则智能歌单 / Saved smart playlists

入口：**设置 → 音乐库 → 音乐工具 → 智能歌单**。可创建、选择、修改、保存和删除本机规则；规则只属于当前账户，不修改服务端歌单。

支持收藏、无已记录播放、最低评分、起止年份、流派／艺人关键词及最近加入范围，条件以 **AND** 组合；按标题、最近加入或最常播放排序，结果上限可选 50／100／200／500。结果可整组播放、加入队列或点击单曲。缺失年份／加入日期的歌曲不会匹配相应条件。“无已记录播放”依赖可用的服务器或本机计数，不代表全历史从未听过。

曲库分页加载，规则计算分批让出执行时间，结果排序限制在设定上限；滚动列表不重算全库。离线只涵盖当前可用资料。源数据变化后可点“刷新曲库”。

Open **Settings → Library → Music tools → Smart playlists** to create, edit, save and delete account-local rules. Favorites, no recorded plays, minimum rating, year range, genre/artist text and recently-added filters combine with **AND**. Sort by title, newest or most played, with 50/100/200/500-result limits. Play results or add them to the queue. Unknown year/date tags cannot satisfy corresponding filters; “no recorded plays” reflects available counts. Paged reads, cooperative analysis and bounded ranking run outside list scrolling. Offline rules cover available data; Refresh library explicitly rereads the source. Server playlists are unchanged.

### 5. 静态歌词海报 / Real PNG lyric posters

入口：歌曲 **⋯ → 歌词海报**，或 **歌词工具 → 歌词海报**。选择最多 6 行、420 个字符，选择封面／浅色／深色样式，在预览中确认后点“生成 PNG 并分享”。

实际调用 `react-native-view-shot 5.1.0` 生成 1080px 宽的 PNG，校验图片后交给 Android 系统分享。输出包含封面、所选文字、歌曲与艺人信息；没有封面时显示占位。离线只使用可用缓存，不为绕过离线主动请求封面。此功能是静态图片，未加入 Apple Live Photo／歌词视频。原生截图依赖需要完整 App 构建，不能通过 Expo Go 验证。

Open **song ⋯ → Lyric poster**, or the Lyrics tools page. Select up to 6 lines/420 characters and an artwork/light/dark style, then choose **Create PNG and share**. `react-native-view-shot 5.1.0` creates an actual 1080px-wide PNG; validated output is handed to system sharing. It includes artwork or a placeholder, selected text and track information. Offline artwork stays cache-only. This is a static image, with no Live Photo/video feature. The native capture dependency requires a full build, rather than Expo Go.

### 6. 重复歌曲与版本检查 / Read-only duplicates and versions

入口：**设置 → 音乐库 → 音乐工具 → 重复歌曲与版本**，支持重新扫描与播放候选以便比较。

按规范化的标题、艺人与时长等元数据生成“类似副本”或“可能的不同版本”，保留现场、重制等版本信息，并展示专辑、格式、位深、采样率／码率。使用分页、分批分析与虚拟列表，不在每次滚动时分组。未知艺人不会被随意合成一个重复组。此功能没有读取音频指纹，不据此保证内容完全相同；没有删除、改标签、清理下载或修改 NAS 文件的操作。

Open **Settings → Library → Music tools → Duplicates and versions**, with rescan and candidate playback. Normalized title/artist/duration metadata suggests similar copies or possible alternate versions, retaining version and quality details. Paging, cooperative grouping and a virtualized result list avoid rescanning on scroll. Unknown artists are not combined indiscriminately. These are metadata suggestions, not audio-fingerprint identity checks. No file, tag, download or NAS deletion is offered.

### 7. 首尾静音跳过 / Bounded edge-silence skipping

入口：**设置 → 播放器 → 跳过首尾静音**，默认 **关闭**。打开后只检查本地／已下载且可解码的音频文件，不为分析暗中下载整首网络音频。

默认阈值为 −60dBFS，最短静音 500ms，**默认仅检查开头和结尾各最多 12 秒**。设置可选择每端 3／6／12／20 秒的有限窗口，不持续扫描整曲或在主界面滚动时分析。原生后台解码完成后保存与账户／文件指纹绑定的结果；未能检查结尾时仅使用已确认的开头边界，失败则正常播放。

只跳首尾，歌曲内部的弱音、停顿及安静乐段保持原样。播放进度、歌词和时间标记保留原文件时间轴；用户拖动进度优先，本次播放不再强制拉回静音边界。恢复播放、循环及交叉淡化沿用原播放器逻辑。该功能可能有短时解码开销，未据自动化检查承诺耗电或恒定帧率。

Open **Settings → Player → Skip leading and trailing silence**, **off by default**. Only decodable local/downloaded audio is inspected; network tracks are never downloaded just for analysis. Defaults are −60dBFS, 500ms minimum silence and **at most 12 seconds at each edge**; selectable bounded windows are 3/6/12/20 seconds. Background native decoding caches account/file-fingerprinted boundaries. A confirmed head may be used without an analyzed tail; failure falls back to ordinary playback. Quiet interior passages remain. Progress and lyrics retain the original clock, manual seeking wins, and existing resume/repeat/crossfade behavior is retained. Automated checks do not establish battery consumption or constant frame rates.

## 来源与实现 / Provenance and implementation

参考官方 [Primuse 固定版本 `0844235ee835ff3e920514b366e571bb546c9977`](https://github.com/chenqi92/primuse/tree/0844235ee835ff3e920514b366e571bb546c9977)，其 [MIT 许可](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/LICENSE) 为 Copyright © 2026 Welape。借鉴对应功能、数据边界与交互思路，在 Resonus 的 React Native／TypeScript／Kotlin 环境重新实现；没有将整个 SwiftUI App、AVFoundation 或 CoreML 接入 Android，也没有替换现有玻璃实现。此前已声明的派生代码许可证继续保留。

参考模块： [歌词校时文档](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/PrimuseKit/Sources/PrimuseKit/LyricsEditorDocument.swift)、[歌单导入](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Playlist/PlaylistImporter.swift)、[年度分析](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Stats/YearlyReportAnalyzer.swift)、[规则引擎](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Library/SmartPlaylistEngine.swift)、[海报](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Views/Sharing/LyricPoster/LyricPosterRenderer.swift)、[重复检查](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Library/DuplicateDetector.swift)、[静音流](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Audio/AudioSilenceStream.swift)。

The pinned official Primuse revision above is MIT-licensed, Copyright © 2026 Welape. These features adapt its behavior, boundaries and interaction ideas through React Native/TypeScript/Kotlin implementations within Resonus. They do not embed the SwiftUI application, AVFoundation or CoreML, or replace the glass engine. Existing notices for previously derived code remain applicable. PNG capture adds [react-native-view-shot 5.1.0](https://github.com/gre/react-native-view-shot), with its own [MIT license](./licenses/react-native-view-shot-MIT.txt).

## 下一轮候选，本轮未实现 / Future candidates, not implemented here

| 顺序 / Priority | 功能与官方源码 / Feature and official source | 收益 / Benefit | 难度 / Effort |
| --- | --- | --- | --- |
| 1 | [长音频逐曲续播、带备注书签 / Per-item long-audio progress and bookmarks](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Library/SpokenWordStore.swift) | ASMR、演唱会、有声书可在听其他音乐后找回各自位置，按需智能回退；超出现有单次队列恢复。 / Retain each item's position across intervening music, with optional rewind beyond session restoration. | 中 / Medium |
| 2 | [私人曲库标记整份备份／恢复 / Full user-mark backup and restore](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Playlist/LibraryBackupService.swift) | 将收藏、评分、自建歌单按歌曲身份打包；换机或曲库 ID 改变后预览匹配。现有设置备份与单歌单交换无法整体覆盖。 / Preserve favorites, ratings and authored playlists across devices/library IDs, beyond settings or individual playlist exchange. | 中 / Medium |
| 3 | [歌词文件导出 / Lyric file export](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Metadata/LyricsFileExporter.swift) | 导出 LRC／SRT／TXT；可复用本 App 的增强 LRC 序列化，明确原时间轴与显示校时的区别。 / Export LRC/SRT/TXT using existing enhanced-LRC serialization, distinguishing original timestamps from display offsets. | 低—中 / Low–medium |

当前 App 已有队列本地／服务端恢复、曲终停止、下载管理、批量封面／歌词缓存、逐字歌词、ReplayGain、交叉淡化和睡眠定时，不重复作为新功能部署。上述三项只作后续建议。

Local/server queue restoration, stop-after-song, download management, bulk artwork/lyric caching, word-timed lyrics, ReplayGain, crossfade and sleep timers already exist. They are not proposed as new work. The three candidates above remain future suggestions only.

## 验证与安装包 / Validation and APK

- `pnpm typecheck`、`pnpm i18n:check`、`git diff --check` 通过；`pnpm test` **971 项全部通过**，并通过 Navidrome canonical-ID 检查。 / Type, translation and diff checks passed; all **971 tests** and canonical-ID checks passed.
- `pnpm lint` 无错误，仍有 134 条现有项目警告；新增工具页面的定向检查通过。 / ESLint returned no errors and 134 project warnings; focused checks for the new tools passed.
- 实际生产 PCM 扫描器的 JVM 检查 **28 项通过**，`:silence-trim:compileReleaseKotlin` 通过；完整 Android ARM64 release 构建成功，新增分析模块和 PNG 截图模块已包含在 APK 中。 / The production PCM scanner passed **28 JVM checks**, Kotlin compilation passed, and the full ARM64 release build succeeded with the silence and PNG-capture modules included.
- APK：`artifacts/Resonus-Glass-v0.8.5.1-preview.3-arm64-v8a.apk`，45,687,012 bytes；包名 `com.zskruc.resonus.glasspreview`，版本 `0.8.5.1-preview.3` / `125`，ABI `arm64-v8a`，已验证签名与既有测试包一致。 / The APK package, version, ABI and matching existing certificate were verified.
- APK SHA-256：`1487392f3590c10751fc1472bc7b2a8cf76058c632e65c46f73e56f1b25eaa2e`。
- Certificate SHA-256：`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。
- 三星 SM-S9380 已覆盖安装 `.preview.3` / `125`，原登录和资料保留。两种歌单布局已查看并恢复 Apple Music；校时修改后重新打开仍保留，随后恢复原值。海报实际进入系统图片分享面板且预览完整，已取消分享。智能规则显示 100 条结果，重复检查完成 72 组候选，统计记录到真实收听；未创建测试规则、写入服务端歌单或删除音乐。 / Samsung installation retained existing data. Both playlist styles, persisted lyric timing with restoration, complete real-image share preview (cancelled), 100 smart-rule results, 72 duplicate groups and actual listening statistics were observed. No test rule/server playlist or music deletion was committed.
- 连续 20 次歌单快滑与后台返回未出现崩溃、ANR 或底栏错位。系统处于 120Hz；末段 120 帧样本中，109 个相邻帧间隔约 8.3ms，中位间隔 8.32ms。该短测不能代表长时间全部页面恒定满帧。已恢复原 30 秒息屏与关闭充电常亮。 / Twenty fast playlist swipes and background return completed without observed crash/ANR/dock disorder. The display ran at 120Hz; 109 intervals in the final 120-frame sample were approximately 8.3ms (median 8.32ms). This bounded check does not establish sustained performance on every screen. Original screen timeout and charging-awake settings were restored.
- **实机未通过项：**当前已下载 ALAC/M4A 的首尾分析失败；三星 framework extractor 将其标为 `audio/unknown`，未进入原 ALAC 解码分支。该账户已恢复关闭；该问题已在 [`.preview.4` 兼容补包](./M4A-SILENCE-PREVIEW-4.md) 中修复，并通过另一首下载 ALAC 的三星实测，普通播放正常。不能将原生模块编译与 PCM 单元检查视作所有实际容器已可用。 / **Device failure:** the downloaded ALAC/M4A edge scan failed because Samsung's framework extractor labeled it `audio/unknown`. The option was disabled again; ordinary playback works. The [`.preview.4` follow-up](./M4A-SILENCE-PREVIEW-4.md) fixes this and passed a downloaded-ALAC Samsung retest. Compilation or PCM checks alone do not establish container compatibility.
