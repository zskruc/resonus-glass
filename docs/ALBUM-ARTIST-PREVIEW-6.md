# 艺人式专辑页预览 / Artist-style album preview

`0.8.5.1-preview.6` / Android `versionCode 128`，2026-11-01。

## 布局 / Layout

专辑新增「艺人页布局」，与艺人、歌单复用满幅图片页头。Apple Music 风格使用同一静态模糊延伸、封面取色、居中标题、艺人链接和 48／72／48 播放控制；Spotify 风格对应其满幅艺人页布局。专辑仍显示分级、流派、年份、歌曲数与时长；歌曲行、重复条目、多碟分组、收藏、下载、封面查看和更多操作继续沿用原实现。点击艺人直达艺人页，多艺人先选择。播放／暂停只操作来源为当前专辑的队列；其他来源播放时点击本页播放会启动当前专辑。

滚动复用歌单版的 UI 线程路径、测量标题衔接和同源顶栏副本；不是每帧重新提取颜色或生成模糊。页脚版权和同艺人作品使用同一局部颜色。播放器、Mini Player、玻璃调节参数、页面与面板过渡动效本轮未更改。

Albums can now use the same full-width artist header as playlists. Apple Music reuses its static image field, local palette, centered heading, artist link and 48/72/48 playback controls. Spotify uses its matching full-width artist composition. Explicit/genre metadata, album information, recycler identity, multi-disc labels, favorites, download, cover viewer and overflow operations remain. Playback toggles the current album queue only; another source starts this album. Measured UI-thread scrolling and the predecoded navigation copy are reused. Footer text inherits the local palette. Player/glass tuning and navigation/panel motion are unchanged in this preview.

## 选择与回切 / Selection and rollback

**设置 → 外观 → 专辑页风格 → 艺人页布局**。可立即切回 **Volta** 或 **Minidisc**；两个旧排版仅在 Apple Music 风格下适用，Spotify 对应旧紧凑页。新账户默认艺人页布局，既有账户明确保存的旧选择继续保留，需在设置选中预览。选择按账户保存、导入／导出和恢复默认。

**Settings → Appearance → Album page style → Artist page layout** enables this preview. Volta and Minidisc restore their earlier Apple Music compositions; Spotify retains its original compact composition for those choices. New profiles default to artist. Explicit existing preferences are preserved, so existing profiles select the preview in settings.

`.preview.5` 安装包及源码检查点 `6a501b01` 保留；优先用设置回切，不必卸载或降级。

The previous APK and source checkpoint remain available. Prefer the in-app preference over uninstalling or downgrading.

## 验证 / Validation

980 项自动化测试通过。新回归覆盖两主题与三专辑布局切换时 FlashList 实例、引用、滚动宿主、选中、重复歌曲索引、多碟标签不变；执行真实艺人跳转／合作艺人选择和当前专辑播放／暂停回调。歌单非导航名称行不截获原封面点击。类型与翻译检查通过。定向 lint 无错误，专辑页原有 76 条 ref 规则警告与基线相同。

All 980 tests passed, including preserved list/scroll/selection/occurrence/disc identity across two themes and three album styles, actual artist link/picker callbacks, album queue playback, and non-navigating playlist owner touch passthrough. Type and translation checks passed. Focused lint found no errors; the album route retains the same 76 existing ref-rule warnings as its baseline.

APK 已构建：`artifacts/Resonus-Glass-v0.8.5.1-preview.6-arm64-v8a.apk`，45,691,320 bytes。SHA-256 `e1e4943dcf104b84e40f3c1e306e1f26ea0db11890eb56e02d638702e1a9484f`；包名 `com.zskruc.resonus.glasspreview`、版本 `128` 与签名一致。最终 Metro sourcemap 中六个相关生产文件逐字匹配源码。本版已覆盖安装到三星 SM-S9380。在原有浅色／Apple Music 配置下检查「幸福」和「FEAR and DREAMS (Live)」：满幅页头、滚动后固定小标题、艺人点击后返回、封面打开／关闭，以及 Volta／Minidisc 回切均已验证。最后选回艺人布局并停在「幸福」。本轮进程日志未发现 fatal、OOM 或 ANR 标记；这是短时交互验证，未进行长时压力或帧率测量。原 30 秒息屏及关闭充电常亮已恢复。

The APK was built and verified for version, package and the existing signing certificate. The final bundle source map exactly matches the six changed production files. Installed on Samsung SM-S9380. In the existing light/Apple Music configuration, Happiness and FEAR and DREAMS (Live) verified the full-width hero, compact scroll title, artist navigation/back, cover viewer and Volta/Minidisc rollback. Artist layout was restored, ending on Happiness. The scoped process log showed no fatal/OOM/ANR markers; this short interaction check does not establish sustained performance or measured frame rate. Original 30-second timeout and charging-wake setting were restored.
