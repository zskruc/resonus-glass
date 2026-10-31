# Volta 风格双界面预览 / Volta-inspired dual UI preview

`0.8.4.1-amll.38` · Android `versionCode 121` · `preview/amll-player`

`.37` 修正实机发现的空队列离线恢复后新下载误暂停，以及名字图首帧几何同步；`.38` 完成整张艺人背景照片的 Android 默认焦点暗层修复。照片、模糊与玻璃参数保持不变。验证进度见下方本轮预览说明。

`.35`／`.36` 新增同源艺人顶栏、名字图互斥、Volta 专辑同排操作、底栏后台恢复，以及封面歌词缓存和音频下载管理。构建与实机验收范围见[本轮预览说明](./PREVIEW-35-36-CACHE-AND-DOWNLOADS.md)。下文保留 `.34` 及更早版本的视觉记录。

`.34` 仅补充实机发现的中央细节过早模糊：延后清晰图交接、减轻最大模糊，V4 缓存避免旧色场复用。已对齐的颜色、照片尺寸及最终渐隐不变。

`.33` 接入经同图核验的官方艺人名字图；名字图向上扩展，保留原文字量测与无障碍信息。
Ayano Tsuji 对照进一步将照片恢复屏宽正方形，不再多放大约 12.5%；色场独立延伸至
约 `1.35W`，从 `0.52W` 开始统一一次渐隐。PNG 不再包含第二次渐隐，原生缓存为 V3。
RGB 三通道采用同一亮度偏移，保留素色场景的通道差值；播放器和玻璃参数不变。
详细来源与验证记录见 [本轮适配说明](./UPSTREAM-PR-ADAPTATION-20261031.md)。

## .32 改动 / .32 changes

Apple Music 风格下新增独立的 **设置 → 外观 → 专辑页样式 → Volta / Minidisc**，
默认 Volta，按服务器资料保存；Spotify 专辑页不变。Minidisc 使用原项目居中封面、
资料、播放胶囊及随机／下载操作层级，保留现有 FlashList、选择与播放功能。

`.31` 已把早期的条带延伸替换为一次准备的二维静态模糊场；`.32` 再从原图未裁切的
上方边角取页面背景，避免白毛衣、棕色外套被用作整页底色。服装的横向颜色仍保留在
照片的模糊延伸中。取色采用连续 RGB 亮度约束，官方元数据命中与本地边角回退共用
同一规则；不按艺人名称硬编码颜色。模糊／透明度采用整段连续曲线，清晰图片的遮罩
不再因模糊图到达而更换范围，预备图出现使用短淡入。

已保存三星 Apple Music 与 Resonus `.31` 的陈奕迅、林子祥对照。原图及自动检查
可核实底色和曲线修正，但不能代替 `.32` 的实机视觉验收。四个上游 PR、检查和 APK
记录见 [适配说明](./UPSTREAM-PR-ADAPTATION-20261031.md)。下文 `.30` 为历史实现及验证，
不能作为当前模糊算法或当前版本已完成实机验收的依据。

The `.32` preview adds an independently persisted Volta/Minidisc album choice
within Apple Music style. Spotify pages and the player/glass settings remain
unchanged. Artist page colors now come from the original scene corners, while
clothing stays in the static blurred extension. Continuous tone/fade curves
replace threshold halving and segmented easing; the sharp mask no longer jumps
when a prepared field arrives. Samsung references were captured for Eason Chan
and George Lam. Device acceptance of this new build is recorded separately;
the `.30` implementation and checks below are historical.

## 使用方式

进入 **设置 → 外观 → 界面风格**，选择 **Apple Music风格** 或 **Spotify风格**。
选择立即生效，并按当前服务器资料保存。旧版本没有这个字段时继续使用
Spotify 风格；切换不覆盖原有主题、字体、播放器布局、首页配置、玻璃调节、
账号、下载或播放队列。重置设置时恢复 Spotify 风格。

Apple Music 风格参考 [Volta](https://github.com/countervolts/Volta)，固定源码
`c627a89c703e06101e105e672999ae6e6f303e57`。这是针对现有 Resonus 的界面适配，
不是运行原版 SwiftUI App，也不是 iOS 27 的逐像素复制。

- 首页：大标题、封面主导的精选卡片、较大的内容分组和专辑卡；保留原有版块、排序与快捷入口设置。
- 资料库：播放列表、艺人、专辑、歌曲、收藏等分类入口及虚拟化的最近添加专辑。
- 艺人：大图、渐进模糊与同色背景衔接、居中名字和操作按钮、精选作品及原有歌曲／唱片目录。
- 专辑、歌单与收藏：居中封面和资料、播放胶囊、随机与下载操作；收藏、排序、菜单及批量选择仍可用。
- 搜索、探索、浏览和设置：统一标题、卡片及列表的字体、间距与信息层级。

当前播放页布局、LNPopup 展开／收合、mini player／底栏几何和保存的光学参数
继续使用原有设置。界面风格与玻璃调节室的材质模式是两个独立选项。

## 艺人页修正（.30 历史记录）

按三星 Apple Music 的刀郎页参考调整艺人头图、名字、按钮与精选卡的高度关系。
名字和按钮上移，精选信息合并进卡片；大名字到顶部标题按真实文字布局交接。
艺人页采用实际展示照片的低饱和深色配色与局部白色文字，独立于 App 的明暗主题。
取色缓存有界，离线只读已有颜色或已确认的本地图片；图片回退时取色源一同变化。

用户确认 `.28`／`.29` 的照片底部仍不符合参考，不能据此前截图把整个效果标为验收。
`.30` 保持原照片的尺寸与裁切，从未渐隐原图的底部取 12dp 条带，保留横向颜色分布，
只沿竖向延伸 96dp，覆盖名字下方与播放按钮后方；先交叠衔接，再逐渐柔化到页面背景。
原图与条带共享视差，最终透明遮罩扩到 `height + 96dp`，原照片底部仍保留颜色，
不会先变成纯底色再出现一段黑条。背景放在头图与按钮的共同容器中，不拦截触摸。
模糊副本最长边仍为 240 物理像素，不使用全屏实时背景模糊，也未新增 Skia 依赖。

`.30` / Android 113 按原签名构建，650 项测试、类型与翻译检查通过，静态检查 0 错误。
APK 已保留在 `artifacts/Resonus-Glass-Artist-v0.8.4.1-amll.30-arm64-v8a.apk`。
`.30` 已按用户后续指令覆盖安装到三星 SM-S9380，核对版本名 `.30`、更新编号 113；
本次仅完成安装，向下延伸效果仍待实机视觉验收。
此前临时息屏／充电常亮及夜间模式设置均已恢复，无待恢复的设备设置。

## 实现与验收范围

列表仍采用已有的分页、FlashList 回收、重复歌曲身份与播放回调。风格改变
不会复制整座音乐库；新的首页横向精选列表限制初始绘制和可视窗口。
艺人模糊只处理低分辨率静态图片图层；没有为浏览页面新增全屏实时背景采样。
封面背景取色约束主文字及次要文字的对比度，并随现有深浅主题重新计算。

本轮应用测试为 **650 项通过**，含设置保存／重载／导入／重置／资料隔离、
两种主题下的极端取色、艺人局部前景覆盖与还原、照片取色缓存／离线／异步隔离，
以及切换风格时的列表回收、重复歌曲选择和触摸归属。
TypeScript 与翻译检查通过。静态检查无错误；已有规则警告仍保留在检查日志中。

使用虚构本地曲库完成 Web 布局检查：320dp／412dp 宽度、深浅主题、简体中文、
风格保存、艺人与专辑跳转、窄屏滚动标题、资料库分类及切回 Spotify。
Web 检查不验证 Android 原生玻璃材质、音频播放、真机触摸或持续帧率。
Web 专用测试适配与虚构服务器只在忽略的本机缓存中；不会打入 APK。

APK 使用现有预览包名 `com.zskruc.resonus.glasspreview` 和既有签名构建，
已覆盖安装至三星 SM-S9380。实机检查了风格切换与切回旧布局、重启后保存、
艺人与专辑跳转、深浅色显示，以及 All Music 的 16 次连续快滑；该段进程未重启，
崩溃缓冲未出现本包记录。这是短时功能检查，不代表持续 120Hz 或长期滚动验收。
测试结束已恢复原来的自动夜间模式、30 秒息屏和关闭充电常亮。
公开来源与许可见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## English

The `.30` artist refinement preserves the original photo crop and extends
only its unfaded bottom 12dp stripe down by 96dp behind the name/control area.
The overlapping extension keeps the horizontal coat/background colors, becomes
softer downward and reaches zero opacity only at the extended bottom. The
photo, stripe and masks share parallax, while the name and controls retain their
layout. Blur samples remain capped at 240 physical pixels; there is no new
full-screen live blur or Skia dependency. The artist's photo-derived dark
palette remains local and offline extraction only reads existing/local caches.

The `.30` APK (Android 113) is built with the existing package/signature.
All 650 tests, typechecking and translation checks pass; lint has no errors.
Following the user's later installation request, the saved APK was installed
on Samsung SM-S9380 and version `.30` / 113 was confirmed. This step covered
installation only; the extension still requires Samsung visual acceptance. Earlier `.28`/`.29` images do not establish acceptance of this new
extension. Temporary device display/night settings were restored.

Open **Settings → Appearance → UI style**, then select **Apple Music style**
or **Spotify style**. The choice takes effect immediately and is stored per
profile. Existing profiles retain Spotify by default. Switching layouts does
not overwrite theme, glass, player, Home configuration, downloads or playback.

The optional layout adapts Volta's artwork-led Home, classified Library,
artist hero and centered album hierarchy to Resonus. Search, Explore, browse
lists and Settings share the alternate typography. Existing player layout,
LNPopup transitions and dock/glass profiles remain separately configurable.

All 650 app tests, typechecking and translation validation pass. Browser
checks use a fictional local catalogue and cover phone widths, both themes,
Chinese labels, navigation and restoring Spotify. They do not establish
native glass appearance, device playback, touch behavior or sustained frame
rates. The ARM64 preview was installed on Samsung SM-S9380. Device smoke
checks covered switching/restoring layouts, persistence after a cold launch,
artist/album navigation, both themes and 16 consecutive All Music swipes.
The process survived that short run and the crash buffer had no entries for
this package; this does not establish sustained 120Hz or long-session stability.
Original auto night mode, 30-second timeout and charging wake settings were
restored. Test fixtures are excluded from the APK.
