# 播客改版 / Podcast redesign

`0.8.7.1-preview.5` · Android `versionCode 151` · ARM64 · 2026-11-09

## 页面

节目详情复用当前 Primuse 风格专辑页的居中封面、取色、背景纹理、标题字重和整体显隐。操作区按播客用途改为「播放／继续收听」和「订阅」，单集放入连续圆角面板，显示日期、时长、剩余时间、真实收听进度和已下载状态。顶部保留返回、排序、下载确认和节目菜单；简介可展开。

列表支持全部、未播、听到一半、已下载，以及发布者提供的分季。连载节目默认从旧到新播放，用户已有排序优先。播客库增加跨节目的「继续收听／最新未播／已下载」，使用原有数据库分页读取，列表维持虚拟化；不会为展示跨节目列表而逐一读取全部 RSS。已有地区榜单、分类、搜索、先预览再订阅均保留。

## 收听与管理

- 点击单集正文进入详情，单集播放按钮继续使用现有播放器与续播记录。
- 单集笔记保留段落、标题、列表和链接，识别时间点，可直接从该位置播放。订阅源提供的内嵌章节直接展示；JSON 章节按需获取，有取消、20 秒截止和 512 KiB 上限。
- 文字稿仅展示发布者实际提供的链接；不生成或假造缺失文字稿，不解析远程音频的 ID3 章节。
- 单集菜单增加「下一集播放／加入队列」；节目菜单可确认后全部标已播，保留下载文件。
- 「节目设置」可为每个节目独立设置跳过片头／片尾、连续播放，并恢复默认。默认不跳过片头片尾、连续播放开启；未知时长和过短单集不会被片头片尾规则跳过。手动定位到片尾时尊重该次定位。
- 播客库右侧的订阅管理入口支持 OPML 文件选择、去重预览、串行导入、进度、停止、失败重试与导出。导入不下载音频，完成项在停止后保留；导出不包含 App 账号，带明显鉴权参数的地址会明确排除。
- 已有后台下载、下载管理、自动下载新集、收藏、睡眠计时、播放速度和快进快退继续使用原实现。

## 来源与范围

已有订阅需要刷新订阅源后才能补齐此前未保存的季数、章节和文字稿元数据。外部 JSON 章节保存在当前会话缓存，内嵌章节随单集持久保存。

功能对照 [Primuse `1916718e`](https://github.com/chenqi92/primuse/tree/1916718e0acb8706cc8a84d2495503c749d8d47d) 当前播客实现（该固定版本为 AGPL-3.0），在本 App 的 React Native、SQLite 和音频队列中独立适配；视觉复用本仓库已有的 Primuse 风格专辑组件。保留其已有来源声明。

没有迁移 iCloud、StoreKit、Siri／CarPlay 等苹果平台能力；未加入 AI 文字稿、本地音频自动归类、文件夹／标签，以及订阅源未提供的内容。普通订阅保持现有手动刷新方式；自动新集下载仍沿用原有受控刷新，未另增长期轮询。

本预览未推送 GitHub，也未发布 Release。设备上的 9 档用户指定订阅沿用原数据库；升级不需要重新订阅。

## English

Podcast shows now share the existing Primuse album cover layout, palette, background and unified presentation, while retaining subscription, listening progress and download behavior. Episode panels show dates, time remaining and real progress, with unplayed, in-progress, downloaded and publisher season filters. Cross-show listening lists are paged from the existing database.

New features include native show notes and seekable timestamps, publisher-supplied embedded/JSON chapters and transcript links, OPML preview/import/export, queue actions, atomic bulk played marking and profile-owned per-show intro/outro/continuous playback choices. Existing music player layouts, saved glass settings and the background download engine remain.

Platform-specific Apple integrations, generated transcripts, remote audio chapter extraction, folders/tags and unavailable publisher content are outside this preview. No new polling service, native dependency, GitHub push or Release is introduced.

## 验证 / Validation

1,514 项自动测试全部通过，包含真实 SQLite 分页搜索／事务回滚、挂起写入与账号切换、实际组件的单集时间点操作、OPML 导入和旧播放／订阅回归。TypeScript、翻译完整性及差异检查通过；ESLint 0 错误，148 条既有警告。APK 构建与后续设备检查单独登记，自动测试不能代替三星的最终外观与手势检查。


## APK

- File: `Resonus-Glass-v0.8.7.1-preview.5-code151-arm64-v8a.apk`
- Built source: `fcbd1a42fe4ad269f2113c30b8ad0a2ff2a9ab4e`
- Size: `46,416,240` bytes
- SHA-256: `2f15f42d7fd8501945ef5424ce88a5718421f224d133d2bec09527af7b266a56`
- Package: `com.zskruc.resonus.glasspreview` · ARM64 · Android `151`

首轮三星实测补充修复：浅色单集播放操作增加明确的主题色填充；单集列表改用 Animated.FlatList，修复将 Reanimated 事件对象传给原生列表导致的滚动闪退。调用栈精确落在 VirtualizedList 的 onScroll；新增回归使用真实形态的不可直接调用处理对象，并实际派发滚动。全仓同类调用已检查，未发现第二处相同接法。

最终 APK 已覆盖安装至三星 SM-S9380（Android 17）。针对性实测确认节目页、浅色单集播放按钮、单集笔记滚动到底部及返回、跨节目「继续聆听」的真实进度正常。最终进程在这轮检查中持续运行，日志未出现此前的 onScroll 异常或播放错误。

《科技乱炖》在用户原有网络配置中加入精确的音频域名例外后，最终 APK 的同一单集连续播放进度从 70.386 秒推进到 638.187 秒，缓冲同时增长，原生播放器无错误。测试结束已暂停，并恢复原来的 30 秒息屏和关闭充电常亮设置。未对手机外放听感、所有订阅的全部音频、全局帧率或长期内存稳定性作验收结论。

The final APK was installed on a Samsung SM-S9380 running Android 17. Targeted checks covered the show header, readable light-mode episode playback, scrolling show notes to the bottom and returning, and real resume progress. One episode advanced continuously for more than nine minutes after a precise exception in the existing network profile. Playback was paused and the original power settings restored afterwards. This is not an all-pages frame-rate or long-term memory certification.
