<p align="center">
  <img src="./assets/images/icon-transparent.png" width="100" alt="Resonus Glass icon" />
</p>

<h1 align="center">Resonus Glass</h1>

<p align="center"><strong>简体中文</strong> · <a href="./README.en.md">English</a></p>

<p align="center">为 Android 定制的 Resonus 玻璃界面衍生版</p>

Resonus Glass 基于 [juananzzz/resonus](https://github.com/juananzzz/resonus)，保留其自托管音乐播放器功能，并为 Android 加入透明折射材质、联动的 mini player 与底部导航、浮动玻璃菜单及可保存的材质调节。

这是独立维护的非官方衍生项目，与原作者、Apple 及其音乐服务没有隶属或认可关系。玻璃效果使用 Android 原生绘制，不是 Apple 私有实现，也不会逐项复现 iOS 的内部参数。开发重点为 Android；上游实验性的 iOS 支持不属于本分支的玻璃效果验证范围。

## 安装

从 [本仓库最新 Release](https://github.com/zskruc/resonus-glass/releases/latest) 下载 **Resonus Glass APK**。`v0.8.4` 对应文件为 `Resonus-Glass-v0.8.4-arm64-v8a.apk`，适用于 ARM64 Android 设备。原项目 Releases 中的 APK 是原版 Resonus，不包含本分支的改动。

Android 13 及以上支持原生折射和定向高光；Android 12 使用 GPU 模糊；更早版本使用界面回退效果。实际效果与流畅度取决于设备和系统状态。

构建时启用 `RESONUS_GLASS_PREVIEW=1`，应用名为 **Resonus Glass**，Android 包名为 `com.zskruc.resonus.glasspreview`，可与原版并存。两者的登录和离线资料互相独立。覆盖更新已有 Glass 安装时，包名和签名必须一致；请勿通过卸载来解决签名不一致，否则会丢失应用内资料。

App 内 **设置 → 关于** 的 GitHub、更新内容和检查更新均指向本仓库；更新摘要读取本仓库 Release 说明，下载安装包也来自同一 Release。检查更新只采用已发布的正式版本，不采用草稿或预发布。

需要自行验证时，可进入 **Actions → Glass ARM64 test APK → Run workflow** 手动构建测试 APK。每次任务使用随机生成的一次性测试签名，不能覆盖当前手机上已有的 Glass 安装，也不能保证与前一次 CI 构建互相覆盖；请使用独立测试设备或模拟器。正式下载以 Releases 中明确标注的安装包为准。

## Glass 的主要改动

- 使用 [AndroidLiquidGlass / Backdrop](https://github.com/Kyant0/AndroidLiquidGlass) 实现屏幕背景采样、折射、模糊和边缘高光，多个控件共享采样。
- mini player 与底部导航随页面拖动联动折叠、展开；搜索独立置于右侧，详情页滚动也可驱动底栏。
- mini player 只显示歌曲名称，支持有边界的横滑切歌；玻璃本身不添加固定底色或根据当前歌曲封面染色。
- 浮动歌曲菜单、播放速度、歌曲信息和相关对话框采用统一圆角玻璃样式。
- 提供 mini player、导航和其他控件的独立材质配置，以及可保存的调节界面。
- 优化列表、导航和菜单的背景采样、过渡及动画生命周期；适配系统字体粗细并补充简体中文设置文本。
- 合入选定的上游后台恢复、播放进度、歌词排序、搜索、网络请求超时及封面地址隐私修复。

以上介绍已发布 Glass 基线的功能。开发预览可能调整材质和控件实现；请同时查看下面的版本说明。更详细的实现和限制见 [Glass 说明](./docs/LIQUID-GLASS-PREVIEW.md) 与 [原生模块说明](./modules/liquid-glass/README.md)。原项目功能和说明保存在 [上游 README](./docs/UPSTREAM-README.md)。

## 版本与上游同步

| 渠道 | 版本 | Android 更新编号 | 获取方式 |
| --- | --- | --- | --- |
| 正式发布 | `0.8.4` | `67` | [GitHub Releases](https://github.com/zskruc/resonus-glass/releases/latest)，App 内检查更新 |
| 开发预览 | `0.8.4.1-amll.38` | `121` | [预发布 APK](https://github.com/zskruc/resonus-glass/releases/tag/v0.8.4.1-amll.38)，实机验收范围见预览记录 |

当前预览加入艺人顶栏衔接与名字图修正、Volta 专辑操作排布、后台底栏恢复、批量封面／歌词缓存，以及独立下载管理。下载管理显示总队列和单曲进度，提供全部开始／暂停／取消，允许同时下载 1–20 首歌曲。实现边界及构建、实机记录见[本轮预览说明](./docs/PREVIEW-35-36-CACHE-AND-DOWNLOADS.md)。

`.32` 适配上游 #304、#302、#301、#299，并补充播放／后台预热的并发归属保护。设置 → 外观 →「专辑页样式」可在 **Volta / Minidisc** 之间切换（Apple Music 风格下生效，默认 Volta）。艺人背景改从原图边角取色，照片下方使用连续的静态模糊与渐隐；保留现有播放器和玻璃参数。来源、检查及限制见 [本轮适配记录](./docs/UPSTREAM-PR-ADAPTATION-20261031.md)。

`.33` 保留上述改动，补充官方艺人名字图、代理图片的本地内容核验和离线缓存；没有官方艺术字时仍显示普通名字。按 Ayano Tsuji 对照修正照片额外放大、素色偏色和过短渐隐，照片、模糊场共用单一最终遮罩；不改变标题及按钮位置。

`.34` 根据三星实机对照，仅延后艺人照片的模糊／清晰细节交接并减轻最大模糊，保留已经匹配的底色、人物尺寸、淡出范围及其他控件。

`.27` 新增参考 [Volta](https://github.com/countervolts/Volta) 的 **Apple Music风格**，可在 **设置 → 外观 → 界面风格** 与 **Spotify风格** 之间切换。首页、资料库、艺人和专辑／歌单详情采用可切换的页面布局，保留现有播放器、玻璃参数及用户资料。范围和验证限制见 [双风格预览说明](./docs/VOLTA-UI-PREVIEW.md)。下方早期版本说明保留为开发历史。

当前开发预览位于 `preview/amll-player` 分支。播放页结合 [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) 派生的原生控件与 SVG，以及独立实现的封面／歌词界面和网格流动背景。「设置 → 播放器 → 播放器布局」可切回 Resonus 原有布局；下方「播放器背景」仅影响原有布局。控件与 SVG 的 **AGPL-3.0-only** 来源、保留的原有许可证和实现范围见 [第三方声明](./THIRD_PARTY_NOTICES.md#amll-player-controls-and-artwork-background-reference) 与 [预览说明](./docs/AMLL-PLAYER-PREVIEW.md)。

`.15` 保留 `.14` 的五项修改：移除播放／歌词页顶部白条，保留原高度、顶部下拉和封面无障碍关闭；移除随机／循环按钮，仅保留原位置的上一首、播放／暂停、下一首，播放模式仍可在菜单设置；返回时冻结底栏已绘制进度，等来源页面状态恢复就绪后再交接，并保留来源页选中透镜透明度；逐字歌词只预备当前与下一行遮罩，下一行延后 720ms 准备，不改模糊、光学或歌词计时；有完整歌单镜像时先显示保存内容并在后台请求服务器，离线复用元数据避免重复 SQL，本地只查询当前歌单的歌曲 ID。没有缓存的首次打开仍可能等待，不能保证所有歌单立即出现。

`.15` 针对 Mini 收回抖动补充两处修复：关闭封面以不含按压／横滑变形的静止位置为目标；入场尚未完成时反向关闭，重新计算端点并保持当前画面连续。开启跑马灯时，Mini 标题保留同一 Marquee 组件树，遮盖时独立暂停时钟并保留位置，返回后续播，不再切换普通文字与跑马灯组件。这些修复仍待实机确认。

早期 `.2` 默认进入大封面页；点击顶部横条、向下拖动或使用系统返回，均退出整个播放器。退出期间保留最后一帧歌词并停止后续动画。竖屏依次为三个播放按钮、歌词／输出／队列、音量条；随机与循环移至更多菜单的可选播放控制组。横屏保留五个播放按钮，底部左侧为输出，右侧为歌词与队列。AMLL 播放按钮去掉封面色圆底，进度条和音量条继续跟随封面主题色；Resonus 原有布局保持原样。

`.3` 将歌词、输出与队列等辅助图标缩至 24dp，保留 48dp 点击区域；点击同步歌词会跳转到该位置并开始播放。歌词继续使用 Resonus 的来源与跳播功能；后续 `.4` 的共用模糊与视口预算见下文。

全 App 开关统一缩小约 16%，布局为 54×44dp，保留 44dp 触摸高度，并为设置文字留出更多横向空间。

「设置 → 玻璃调节」现可独立修改 mini player、导航和其他控件的 AM++ 参数，也可一键恢复并保存全部 AM++ 默认参数；原有自定义配置单独保留。另修复切换玻璃风格后折叠图标继承旧位移的问题，覆盖 AM++、开源默认、iPhone 参考与自定义四种模式。原有 AM++ 适配范围见 [AM++ 说明](./docs/AMPP-ADAPTATION.md)。

本轮已将 Zennmn/AM-plus-plus 固定版本的页面输入控制器、折叠几何、选中透镜独立内容行及速度／按压形变接入源码，适配 Resonus 的播放、导航与窗口接口，保留自定义与非 AM++ 风格。来源文件、原生前景记录及 JSI 桥接的对应关系见 [AM++ 源码接入清单](./docs/AMLL-PLAYER-PREVIEW.md#ampp-source-port)。

`.4` 让全部播放页共用 Resonus 歌词模糊与过渡，按真实视口限制滤镜；恢复底栏点按的完整按压／移动／释放动画，并在设置的外观首页组加入首页标题自定义。共享玻璃记录与透镜只在交互期间运行，背景采样排除缓存透镜，页面导航查找跳过列表内容。歌曲缩略图使用静态首帧，磁盘预取只下载文件并清理请求，避免额外动画解码；播放器动画能力与暂停状态独立保留。

当前 `.26` 测试版采用 [LNPopupUI / LNPopupController](https://github.com/LeoNatan/LNPopupUI) 的展开／收合模型：容器、共享封面与底栏由同一进度协调，Mini 点按／上拉完整展开，大播放器下拉跟手并收合或回弹。保留当前播放器静止布局和全部玻璃参数，复用既有端点及路由交接保护。Android 重实现不包含 UIKit 的 Portal／原生玻璃，也不承诺逐帧相同；本版本已完成三星上拉、收合、回弹及页面返回的有限检查，持续帧率与长期使用不作据此承诺。实现与归属见 [LNPopup 转场说明](./docs/LNPOPUP-TRANSITION.md)，此前动效记录见 [历史说明](./docs/APPLE-MUSIC-TRANSITION.md)。

播放器布局参考用户三星上的 Apple Music：暂停时封面缩至 0.85，使用易读的白色 SVG，歌曲信息行带收藏星标和更多入口；当前仅显示上一首、播放／暂停、下一首三个按钮，保留原位置和短按压／释放反馈。播放进度与音量轨道继续跟随封面主题色。参考截图属于私有测试资料，不公开上传。

Tab 的 UI 线程即时点按反馈、列表稳定 callback ref 修复和统一浮动玻璃弹窗继续保留；弹窗覆盖范围见 [统一面板说明](./docs/UNIFIED-GLASS-PANELS.md)，之前的候选与回滚记录见 [转场研究](./docs/PLAYER-MINI-TRANSITIONS.md)。

`.14` 已安装到三星，已确认顶部白条与主控制区随机／循环按钮移除；本次已缓存 AllMusic 较快显示出歌曲行；没有有效旧版对比或严格的点击端到端计时。用户仍不接受 Mini 收回时的抖动，不能标为修复完成。`.15` ARM64 APK 已构建并核对原签名；558 项应用测试、125 项原生测试、类型与翻译检查通过，lint 为 0 错误、117 项警告；按用户要求暂不安装，待重新连接后检查收回观感和持续表现。

历史 `.13` 已安装，基础视觉检查看到共享封面缩放回位、完整入场、短拉取消／长拉退出、歌词切换与歌词页下拉返回，以及 Mini／Tabs 同步出现；检查期间未出现新的崩溃。这不是 `.15` 的验收，也不证明持续帧率、长列表或长期稳定性。性能证据边界见 [播放列表记录](./docs/PLAYLIST-SCROLL-PERFORMANCE.md)。系统 120Hz 请求、绘制次数和单元测试都不等同于恒定 120 fps；背景保留独立最高约 60 fps 工作预算，预览尚未纳入正式 Release。

Resonus 原有布局开启封面配色时，播放／暂停按钮直接使用当前封面色，和进度条、音量条同步；其背景配色仍保留单独的稳定等待与过渡。AMLL 布局使用独立的原生封面背景和无常驻圆底的播放按钮，滑条主题色保留。

播放轨道颜色取消渐变，并在前台预取相邻歌曲的小封面颜色；缓存命中时随切歌直接更新。首次未读取的封面仍需等待图片读取，期间使用中性色，不继续显示上一首的颜色。

本次修订恢复普通按钮原有外观，并让播放进度条和音量条跟随封面主题色；保留 LiquidToggle、LiquidSlider 的拖动效果、AM++ dock、弹窗和高刷绘制优化。

本轮另加入悬浮弹窗玻璃预设、可点击音质卡片、真实系统输出入口、与手机音量键同步的音量条，以及可选的全屏播放器封面配色。新选项位于「设置 → 播放器 → AM++ 播放器新特性」，封面配色默认关闭，不影响 mini player 和底栏。系统输出选择不可用时会明确回退至系统音量面板。

版本号跟随最近审查的上游正式版基线，但 Glass 采用选择性移植，**不等同于完整的上游 0.8.4**，也未包含后者的全部新功能。具体采用的功能以 [Glass 更新日志](./CHANGELOG.md) 和 [上游修复范围](./docs/LIQUID-GLASS-PREVIEW.md#上游修复范围) 为准。

同一上游基线内继续修改 Glass 时，可以使用第四段修订号，如 `0.8.4.1`；下一个上游基线使用 `0.8.5`。正式发布时，App 版本、Git tag 和 Release 使用同一个版本，Android `versionCode` 每次发布必须递增。版本号一致不表示与原项目安装包可相互覆盖。

本仓库的 `glass` 分支用于保留定制。上游源码仍以 [juananzzz/resonus](https://github.com/juananzzz/resonus) 为准；更新时先比较和验证，再合并适合的修复。自动拉取上游提交并不保证冲突能自动解决，也不能保证自定义玻璃交互始终兼容。同步和检查流程见 [上游更新说明](./docs/UPSTREAM.md)。

## 从源码构建 Android

需要 **Node.js 24、pnpm 11、Java 17、Android SDK Platform 36** 及 Android 构建工具。项目使用 **Expo SDK 57**；版本和依赖以 `package.json`、`pnpm-lock.yaml` 为准。Expo Go 无法加载本项目的本地原生模块。

```bash
git clone https://github.com/zskruc/resonus-glass.git
cd resonus-glass
git switch glass
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm i18n:check
```

将 `ANDROID_HOME` 指向自己的 Android SDK，`JAVA_HOME` 指向 Java 17，然后构建 ARM64 APK：

```bash
export RESONUS_GLASS_PREVIEW=1
bash scripts/build-glass-preview.sh
```

脚本会重新生成 Android 工程，并输出 `artifacts/Resonus-Glass-preview.apk`。本地构建的签名取决于自己的 Android 构建配置；发布签名密钥不随源码公开。Expo 生成目录、依赖、缓存、安装包和私有配置不应提交。正式版本的本机签名、验证及 GitHub Release 流程见 [发布说明](./RELEASING.md)。

需要复用本机签名时，可在 `.local-signing/env.sh` 中配置 `RESONUS_KEYSTORE_FILE`、`RESONUS_KEYSTORE_PASSWORD`、`RESONUS_KEY_ALIAS` 和 `RESONUS_KEY_PASSWORD`。构建脚本会读取这个本机文件；整个 `.local-signing/` 目录已排除在 Git 之外。

## 文档与反馈

本项目提供完整的 [中文首页](./README.md) 与 [English README](./README.en.md)。下列技术文档目前保留各自原有语言。

| 内容 | 链接 |
| --- | --- |
| 版本变化与 APK | [更新日志](./CHANGELOG.md) · [Releases](https://github.com/zskruc/resonus-glass/releases) |
| 功能与验证范围 | [Glass 说明](./docs/LIQUID-GLASS-PREVIEW.md) |
| AMLL 播放器预览 | [布局、背景与验证边界](./docs/AMLL-PLAYER-PREVIEW.md) |
| Apple Music 转场 | [共享封面、独立背景与来源页景深](./docs/APPLE-MUSIC-TRANSITION.md) |
| 播放列表性能 | [现场、修复与未验收范围](./docs/PLAYLIST-SCROLL-PERFORMANCE.md) |
| 原生材质实现 | [Liquid Glass 模块](./modules/liquid-glass/README.md) |
| 上游更新流程 | [上游维护说明](./docs/UPSTREAM.md) |
| 签名与发布 | [发布说明](./RELEASING.md) |
| 原项目功能 | [上游 README](./docs/UPSTREAM-README.md) |
| 界面翻译 | [翻译指南](./TRANSLATING.md) |

提交问题或建议请使用 [本仓库 Issues](https://github.com/zskruc/resonus-glass/issues)，中文和英文均可。请附上 Glass 版本、设备和 Android 版本、复现步骤，并说明问题是否只在本分支出现；仅由 Glass 定制造成的问题请在这里反馈。

## 许可证与致谢

- [Resonus](https://github.com/juananzzz/resonus)：原作者 **juananzzz** 及原项目贡献者；原有源码保留 **GPL-3.0-or-later**，根 [LICENSE](./LICENSE) 不变；本预览新增的 AGPL 派生控件另见下项及第三方声明。支持原作者可前往其 [Ko-fi](https://ko-fi.com/juananzzz)。
- [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass)：**Apache-2.0**。原生材质依赖 Backdrop 1.0.0，并适配其 Bottom Tabs 示例；[许可证](./modules/liquid-glass/ANDROID_LIQUID_GLASS_LICENSE)。
- [sdegenaar/liquid_glass_widgets](https://github.com/sdegenaar/liquid_glass_widgets)：**MIT**，Copyright © 2024–2026 Sebastian Degenaar。参考并适配其联动布局和最小化控制器；未引入 Flutter 引擎；[许可证](./modules/liquid-glass/LIQUID_GLASS_WIDGETS_LICENSE)。
- Primuse：歌词动效的部分实现遵循 **MIT**，详见 [第三方声明](./THIRD_PARTY_NOTICES.md)。
- [f728743/AppleMusicStylePlayer](https://github.com/f728743/AppleMusicStylePlayer)：**MIT**，Copyright © 2025 Alexey Vorobyov。适配共享封面转场、背景轮廓与下拉规则；[完整许可证](./licenses/APPLE-MUSIC-STYLE-PLAYER-MIT.txt)及[实现范围](./docs/APPLE-MUSIC-TRANSITION.md)。
- [LNPopupController](https://github.com/LeoNatan/LNPopupController)：**MIT**，Copyright © 2015-2025 Léo Natan；[完整许可](./licenses/LNPOPUPCONTROLLER-MIT.txt)与[适配范围](./docs/LNPOPUP-TRANSITION.md)。
- [AMLL](https://github.com/amll-dev/applemusic-like-lyrics)：播放控件及选定 SVG 派生自固定版本，保留 **AGPL-3.0-only**、[完整许可证](./licenses/AMLL-AGPL-3.0.txt) 与 [文件来源／组合分发要求](./THIRD_PARTY_NOTICES.md#amll-player-controls-and-artwork-background-reference)。封面网格背景独立实现，未嵌入其 Web 运行库、着色器或动画引擎；不将图标来源声明为 Apple 授权。

原项目图标、其他依赖和原有第三方声明继续保留各自权利与许可。
