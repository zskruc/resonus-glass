# Compact Home, artwork accents and settings / 紧凑首页、封面主题色与设置行高

Local preview / 本地测试版：`0.8.5.1-preview.2`，Android `versionCode 124`。

## 本轮修改 / Changes

### 首页「发现」

Apple Music 风格下，发现封面从原来的最大 340dp 改为手机最大 **240dp**、平板最大 280dp；随窗口宽度适配，保留下张卡片的预览。图片保持完整正方形，不通过切掉封面来缩短。信息区改为标题和艺人两行，最小 74dp；手机端典型总高度从约 436dp 缩到 314dp，减少约 28%。加载占位同时使用新尺寸。

这是对紧凑推荐横栏的适配，没有测量或宣称 Apple Music 私有布局的逐像素尺寸。原 Spotify 风格和其他首页栏目不受此次发现卡片尺寸修改影响。

### 主题色

主题设置新增强调色来源：**手动选择 / 跟随专辑封面**。

- 手动模式保留预设色盘、自定义调色盘，以及深／浅模式分别保存的手选颜色。
- 自动模式使用**当前播放歌曲的专辑封面**，改变 App 按钮、开关、选中项等强调色，不以当前浏览的专辑页作为取色对象。
- 复用播放器已有的小封面取色缓存和在途请求，不引入另一套图片解码器或调色依赖。已预热命中时同步应用，不追加 Primuse 的颜色渐变等待；尚未取色时允许等待实际图片处理，不能保证冷图片零延迟。
- 自动颜色独立于手选颜色保存。没有可用封面或取色失败时使用手选色；迟到的旧歌、旧账号结果不能覆盖当前颜色。
- 深浅外观继续走已有可读性校正，按钮文字／图标采用对应前景色。页面背景、封面氛围色和玻璃底色是独立角色；本轮不修改玻璃参数或给 Mini Player 添加封面染色底色。
- 持久化、设置导入／导出和账号切换包含新的来源选项。旧设置没有该字段时保持手动模式。

参考了 [Primuse 的主题颜色角色分层](https://github.com/chenqi92/primuse/tree/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services)。本轮复用 Resonus 现有取色实现并独立实现来源控制，没有复制 Swift／SwiftUI 代码。

### 设置行高

普通、选择、开关及只读信息行共享 **最小 56dp / 上下各 6dp**；保留开关的 44dp 触摸高度，并同步拖排行、网络选项与设置首页分类行。长说明或大字体仍自然增高。滑条的堆叠标签、账户头像头、下载进度等并不是单行选项，保持各自合理布局。

Shared settings-row geometry is a minimum, not a clipped fixed height. Multi-line descriptions and accessibility font sizes remain able to expand. Glass material parameters are unchanged.

## Primuse 可借鉴功能 / Further candidates

核验官方公开源码固定版本 `0844235ee835ff3e920514b366e571bb546c9977`，采用 [MIT 许可](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/LICENSE)。以下是建议，**本轮未额外实现这些功能**；SwiftUI／AVFoundation 不能直接作为 Android 依赖，需要用 React Native／Kotlin 适配。

| 优先级 | 功能与官方实现 | 实用程度 | 难度及建议范围 |
| --- | --- | --- | --- |
| 1 | [单曲歌词校时](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/PrimuseKit/Sources/PrimuseKit/LyricsEditorDocument.swift) | 高 | 低—中。逐曲保存提前／延后毫秒数，逐字与和声一起平移，一键恢复；先不做完整打轴编辑器或覆盖原歌词文件。 |
| 2 | [外部歌单导入／导出](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Playlist/PlaylistImporter.swift) | 高 | 中。先支持 M3U8／JSON，按标题、艺人、时长匹配 Navidrome 曲库；导入前预览，歧义人工选择，保留未匹配清单。 |
| 3 | [听歌统计与年度回顾](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Stats/YearlyReportAnalyzer.swift) | 高 | 中，完整年报中高。复用现有累计计数做总榜；新增事件账本，从启用后记录每日趋势和真实听歌时长。 |
| 4 | [规则智能歌单](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Library/SmartPlaylistEngine.swift) | 高 | 中高。组合最近加入但未播放、评分、年代、流派等规则。本地按数据版本缓存结果，不在滚动过程中重算全库。 |
| 5 | [静态歌词分享海报](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Views/Sharing/LyricPoster/LyricPosterRenderer.swift) | 中 | 中。选择几句歌词，配封面、主题色与歌曲信息导出图片；先不做 Apple Live Photo。重视视觉分享时可提前。 |
| 6 | [重复歌曲／多版本检查](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Library/DuplicateDetector.swift) | 中 | 中。先做只读候选列表，按标题、艺人、时长分组并比较音质；这不是音频指纹，不自动判定现场／重制版为重复，不自动删除 NAS 文件。 |
| 7 | [首尾静音跳过](https://github.com/chenqi92/primuse/blob/0844235ee835ff3e920514b366e571bb546c9977/Primuse/Services/Audio/AudioSilenceStream.swift) | 中 | 高。需适配 Media3 音频处理、歌词时钟、进度和无缝衔接，并评估耗电；建议后做。 |

App 已有下载管理、批量封面／歌词缓存、逐字歌词、点击歌词跳播、均衡器、ReplayGain、交叉淡化、睡眠定时、播放历史及上报，不重复引入另一套实现。

统计边界：`playCounts.ts` 已有本地离线累计次数，服务端 Song／Album 有 `playCount`，最常播放排序也已利用服务端计数。但最近播放历史只保存最近 100 首去重歌曲，来源最近时间和累计总数不能还原过去年份的真实听歌秒数或逐日分布，不能据此补造年度报告。

## 构建与验证 / Build and validation

- 全量 **895 项应用测试通过，0 失败**，Navidrome canonical-ID 检查通过。
- 类型检查、翻译键／占位符及生成的翻译上下文检查通过。
- 完整静态检查：0 错误，134 条项目现有警告。主题色所属文件检查 0 警告；设置行涉及文件保留 3 条原有警告。
- 新增 9 项主题色行为测试，涵盖共享缓存同步取色、迟到结果、手动／自动切换、后台恢复、账号与旧队列保护、设置迁移及导入／导出、深浅模式颜色可读性。
- 真实主题模块检查覆盖黑、白、灰、深蓝、浅紫、红和黄封面色在深浅模式的强调色与按钮前景对比度；没有改动背景角色。设置行计算核对单行、44dp 开关及两行常规内容都可为 56dp，长内容自然增长。
- 未改动原生运行库或新增包依赖。本轮没有安装到三星，没有实机视觉或滚动帧率结论。

Private logs are retained only in `.local-cache/home-theme-preview2-20261031/` and the focused-check logs.

### APK

- Signed ARM64 release build completed successfully using `scripts/build-glass-preview.sh`.
- File: `artifacts/Resonus-Glass-v0.8.5.1-preview.2-arm64-v8a.apk`.
- App/package: `Resonus Glass` / `com.zskruc.resonus.glasspreview`.
- Verified version: `0.8.5.1-preview.2` / `124`; ABI: `arm64-v8a`.
- Size: `45,467,412` bytes.
- APK SHA-256: `1849984e1d67666c5e1d6ccb0757dbbcb54640cbae9c982465c2469f2a704cea`.
- Signature verification passed; certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching the existing preview installation.
- APK and source are local. No installation, phone operation, GitHub upload or release was performed during this task.
