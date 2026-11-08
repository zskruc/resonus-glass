# Primuse-inspired feature preview / Primuse 功能适配预览

`0.8.7.1-preview.3` · Android `versionCode 149` · ARM64 · 2026-11-09

本轮基于已发布的 `0.8.7.1-preview.2`，实现用户选定的第 1、2、3、4、5、6、7、9 项。保留现有播放器、Apple Music／Spotify 页面、玻璃参数与取色。

## 使用入口

1. **设置 → 搜索设置**：搜索中文、英文或常用拼音；结果进入实际设置页，目标存在时滚动并短暂高亮。最近 5 项按账号保存；条件隐藏的选项保持其原有启用条件。
2. **首页 → 为你推荐**：每日精选、旧曲重温、近期发行三张卡片。当天内容保留，可手动换一批；来自真实曲库和可用听歌记录，不要求 AI 服务。可在首页栏目设置调整显示与位置。
3. **歌曲菜单 → 歌词来源**，或 **设置 → 播放器 → 歌词工具 → 歌词来源**：预览本机、缓存及可取得的服务器／LRCLIB 候选，为当前歌曲记住选择；可恢复自动选择。线上检索按钮才请求外部候选。
4. **歌词来源 → 伴随歌词**：选择原文、附译文、附罗马音或两者。显示文件／服务器已有数据，未引入自动翻译或付费翻译服务；逐字时间轴保持原文计时。
5. **设置 → 播放器 → 随机播放偏好**：均匀随机、偏爱常听／少听歌曲、偏爱常听／少听艺人。音乐队列重新随机时使用偏好；显式有序的播客和有声书继续按原顺序。
6. **歌曲菜单／设置 → 播放器 → 长音频与书签**：为 ASMR、演唱会等单曲手动启用位置记忆。播放期间限频保存，暂停和离开前台时补存；点击「继续播放」回退 10 秒。可为当前播放位置加备注书签，点击书签跳播，删除书签或移除本曲记录。普通音乐不会按时长被自动启用。
7. **探索 → 专辑旁的日历入口**，或 **音乐库 → 按年代浏览专辑**：年代、年份与未知年份分组，包含下载筛选和离线专辑。首次分页读取专辑元数据时显示进度，未完成时不把部分分布当全库统计。
8. **搜索 → 已缓存歌词中的结果**：用歌词、译文或罗马音查找本机已存歌曲。首次在后台分批补建旧缓存索引；后续缓存／下载成功后增量更新，不为搜索批量下载尚未缓存的歌词。

长音频最多保留 300 条单曲记录，每曲最多 50 个书签；达到数量上限时不静默删除旧书签。歌词检索结果受本机已有内容限制，尚未缓存的歌词不会被伪称为已搜索到。

## 性能与数据边界

- 首页推荐使用有界候选池、每天保存一次及显式换批。推荐列表播放沿用当前账号的媒体地址，本地／离线文件按当前目录重新解析。
- 设置索引只收录真实设置路由／标签，不索引用户输入的服务器地址或凭据；普通设置滚动不增加逐帧布局测量。
- 歌词索引使用 SQLite FTS5；迁移每批至多 20 首，分批让出执行机会。当前歌词或账号变化时拒绝旧异步结果。
- 位置与书签保存在本机 SQLite，按账号及本地文件夹来源隔离。失败读取不会被空数据覆盖；写入串行化，删除账号后不允许旧待写任务恢复其数据。
- 动画、折射、模糊半径与玻璃材质没有因为本轮功能迁移被替换。构建／自动测试不能代替三星上的实际帧率、触摸与长期内存验收。

## English

This local preview implements settings search with navigation/highlighting, daily cached recommendation cards, per-song lyric candidates, supplied translation/romanization, weighted music shuffle, explicit per-track long-audio resume/bookmarks, decade/year album browsing, and full-text search over cached lyrics. Existing page/player layouts, glass profiles and artwork palettes remain.

Settings search stores only the last five visited setting IDs. Recommendations use bounded real-library candidates and require no AI service. Lyric source selections are local and per song; supplied companion text is displayed without automatic translation. Chapter-ordered queues bypass music shuffle preferences. Long-audio tracking is opt-in per song; Continue rewinds ten seconds, and bookmarks carry notes. Era pages distinguish partial pagination from a completed distribution. Cached lyric search incrementally indexes existing text rather than downloading a whole library of lyrics.

## Reference / 参考

Feature and interaction research used [Primuse `1916718e`](https://github.com/chenqi92/primuse/tree/1916718e0acb8706cc8a84d2495503c749d8d47d) (1.13.0). The current reference revision is AGPL-3.0-licensed, unlike the earlier MIT-pinned sources documented for previous work. These features are independently implemented within the existing TypeScript/React Native/SQLite architecture; no SwiftUI, Apple Translation, CloudKit or iOS binary is embedded. Existing third-party notices remain applicable.

## Build and validation / 构建与验证

- JavaScript／TypeScript 回归 **1421 项通过，0 失败**，并通过 Navidrome canonical-ID 检查。
- 类型、翻译／生成字典与差异格式检查通过。全项目 ESLint 为 **0 错误、146 条既有警告**。
- 包含真实 SQLite FTS5／事务回滚与迁移检查、设置定位和长音频页面的真实组件测试、歌曲来源边界、队列随机排序和书签持久化回归。
- 三星正在由用户使用，本轮构建阶段未操作手机。APK 构建／验包及后续实机结果单独登记，不以自动测试代替设备验收。

No GitHub publication or release is requested for this local preview task.
