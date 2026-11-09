# Resonus Glass 0.8.7.1-preview.7 · 153

本版为本机测试包，等待三星实机验收。当前已发布到 GitHub 的版本仍为 `0.8.7.1-preview.6（152）`；本版新功能没有推送或发布 Release。既有 Apple Music／Spotify 页面样式、播放器布局和玻璃参数保留。

This is a local test build awaiting Samsung validation. GitHub remains on the published `0.8.7.1-preview.6 (152)`. The new features have not been pushed or released. Existing page styles, player composition and saved glass profiles remain available.

## 已适配的 17 项 / The 17 adaptations

| # | 功能 / Feature | 入口与行为 / Entry and behavior |
|---|---|---|
| 1 | 首页与搜索布局 / Home and search layouts | 设置 → 音乐工具与自定义 → 首页与搜索布局。栏目可改封面卡、列表或横向网格，1–3 行、封面尺寸与数量；搜索可调整排序、显隐与密度。默认、紧凑及封面优先预设不改既有栏目顺序。 |
| 2 | 个人资料与外观备份 / Personal and appearance backup | 设置 → 个人资料备份与恢复。收藏、评分、自建歌单、书签、歌词编辑、收听统计、外观、字体文件及完整玻璃调节参数；导入先预览匹配与评分冲突。音乐文件和账号密码不导出。 |
| 3 | 歌词导出 / Lyric export | 歌曲菜单 → 编辑并导出歌词。LRC、SRT、TXT；区分原时钟与显示偏移，无时间歌词仅导出 TXT。 |
| 4 | 本机歌词编辑 / Local lyric editing | 同一页面可编辑正文、译文和时间，真实逐词歌词保留逐词结构；可撤销编辑或恢复原来源，不改服务器文件。 |
| 5 | 电台发现 / Radio discovery | 音乐工具 → 发现网络电台；Radio Browser 地区热门、搜索、明确试听后保存到本机。原有服务器电台继续保留。 |
| 6 | 播客与电台整理 / Media organization | 播客／电台页的文件夹入口，或音乐工具 → 文件夹与标签。单文件夹、多标签、筛选、批量移动及加减标签。删文件夹不退订节目。 |
| 7 | 新桌面小组件 / Additional Android widgets | 音乐工具 → 桌面小组件：继续播客、近 30 天收听统计、当前歌词。系统确认后添加；未安装的类型不启动额外资料查询。 |
| 8 | 本机歌曲纠错 / Local metadata corrections | 歌曲菜单 → 本机歌曲信息纠错。歌名、艺人、专辑、年份、流派及曲序等显示修正，可预览与撤销；音频、服务器标签、下载 ID 保留。 |
| 9 | Wi-Fi 网页传歌 / Wi-Fi transfer | 音乐工具 → Wi-Fi 音乐传输。手动开启、复制临时地址，在同一 Wi-Fi 浏览器上传音乐或下载手机选定的文件，显示传输进度。 |
| 10 | 拼音与首字母搜索 / Pinyin search | 音乐工具 → 曲库拼音搜索。显式构建可取消的本机信息索引；支持中文、全拼、首字母和可获得的路径字段。不是下载整个音乐库的音频。 |
| 11 | 规则情景选歌 / Listening intentions | 音乐工具 → 听歌情景。根据已有标签、年代、时长和收听资料推荐，先预览再播放，可置顶或隐藏；不进行 AI 音频分析。 |
| 12 | 独立收听会话 / Separate listening sessions | 音乐工具 → 收听会话、连续曲组与章节。可开启音乐、播客、电台与有声书分别记忆，明确点选后恢复队列、位置及播放模式。 |
| 13 | 随机连续曲组 / Linked shuffle groups | 歌曲菜单 → 随机播放连续曲组。将同专辑相邻曲目关联，普通／加权随机均按组处理；未设置关联时保留原有行为，顺序播客不打乱。 |
| 14 | 艺人完整别名 / Exact artist aliases | 艺人页菜单 → 艺人完整别名，预填当前艺人；明确输入完整别名、预览影响后应用，可撤销。只归一显示，不自动合并相似人名或改 Navidrome ID。 |
| 15 | 缺曲占位与找回 / Missing-track recovery | 歌单菜单 → 歌单缺曲找回。打开过的歌单保存本机快照；导入歌单／备份时保留缺曲位置，完整曲库扫描后确认匹配再原位补回，保留重复歌曲。非歌单的未匹配收藏与评分有独立待恢复页。 |
| 16 | 分语言歌词字体 / Lyric fonts by language | 外观或音乐工具 → 按语言设置歌词字体。中文、拉丁文字、日文与韩文可独立选择；默认继承现有字体，保留字号、字重与逐词几何。 |
| 17 | 章节导入及章末停止 / Chapters and chapter-end stop | 歌曲菜单 → 章节与章节结束停止。TXT／JSON 时间校验、预览后应用本机覆盖，可恢复发布者章节；支持当前章或指定章结束停止。 |

第 **18 项「隐藏仅一首歌的专辑」未加入**。

Item **18, hiding one-track albums, is excluded**.

## 使用边界 / Practical boundaries

- 全库备份、匹配与确认缺曲需要连接服务器并启用全部服务器音乐库。离线下载子集不会被当作服务器全库。纯本机音乐源可直接扫描。
- 备份恢复默认保留现有评分；恢复歌单创建新列表，不替换原列表。重名／多个版本等待手选，未完成的收藏和评分留在「待恢复」中。跨曲库不会盲套原 ID 的本机编辑与会话。
- 恢复操作有持久化计划。意外中断后核对服务器的实际序列再续接；若用户或其他客户端改变了列表，要求重新核对。少数创建中断的列表会暂时带 `[Resonus restore …]` 名称，续接完成后恢复原名。
- Wi-Fi 传输每文件上限 512 MiB；接收音乐写入手机 `Music/Resonus Glass/Transfer`，不覆盖旧文件。可在本机音乐源扫描后使用。离开传输页、切后台、断开 Wi-Fi 或点停止会结束临时入口；音乐播放及原有后台下载不受此新入口影响。
- 电台和播客目录的可用性、地区内容及网络速度由来源决定；目录试听不会自动开始，保存也不会替服务器创建管理员电台。
- 歌词编辑、元数据和别名都属于本机覆盖。索引是可重建资料缓存，个人备份不包含音频下载或服务器密码。
- 单个章节文件最多 1 MiB／1,000 章，必须递增、无重叠且在已知音频时长内。远程投播不承诺支持本机章末停止。

Full-library operations require a complete online source, not a downloaded subset. Restoration uses previewed metadata matches, preserves existing data by default and journals server mutations for safe retry. Wi-Fi transfer is a foreground, opt-in, temporary local service, with a 512 MiB file limit. Local display/lyric corrections never rewrite the original server tags or audio. Android widgets are native widgets, not an iOS widget runtime.

## 验证 / Validation

本版已经进行 TypeScript、翻译完整性、生产路径与故障重试测试，以及 Android 原生编译。Wi-Fi 原生传输核心使用真实 HTTP 连接测试了上传下载字节一致性、链接、同源限制、体积及路径限制、中断清理与停止。最终测试数量、APK 摘要和签名以本机构建收据为准。

后续三星实测已推进至 `0.8.7.1-preview.9（155）`：验证了新增页面入口、拼音搜索、情景预览、字体回切、文件夹创建删除、个人备份导出、本机歌曲信息保存撤销，以及桌面统计组件的显示和跳转。其间修复了预览版小组件地址、编辑页键盘点击与旧草稿恢复问题。155 另消除了年代卡片对纯色背景的实时整页捕获，并限制年份网格每批加载的封面数量；保留现有布局与玻璃参数。

最终自动测试为 1,613 项通过。年代页两轮实机记录仍有少量慢帧，不能据此宣称全局持续 120 fps 或长期内存问题根治。真实 Wi-Fi 收歌、对真实账号执行备份恢复／缺曲补回，以及完整章节与会话交互仍未完成实机验收。测试临时亮屏设置已还原，测试专用桌面组件已移除，其他组件保留。新功能仍未推送或发布 Release。

Samsung checks continued through preview.9 (155), covering selected new-page, search, editing, export and launcher-widget flows. Era cards now use the actual flat page colour without live full-screen capture; album-grid image batches are bounded. All 1,613 automated tests pass. Sporadic slow frames remain, and this is not a sustained 120 fps or all-feature device acceptance. Real LAN receipt, live-account restore/recovery, and complete chapter/session interactions remain unverified. Temporary power settings and the test widget were cleaned up. These experimental changes remain unpublished.
