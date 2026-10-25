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
| 开发预览 | `0.8.4.1-ampp.4` | `77` | 本地测试 APK，尚未发布为正式 Release |

当前开发预览在 `preview/ampp-dock` 分支上适配 AM++ 的 mini player、底部导航材质和折叠动画；「设置 → 玻璃调节」可在 AM++ 参考、开源默认参数和旧参数之间切换。对应范围及其他候选功能见 [AM++ 适配说明](./docs/AMPP-ADAPTATION.md)。之前的 Kyant 默认材质预览保留在 `preview/kyant-defaults` 分支。预览版不代表正式版已经具备相同改动，也不构成所有页面持续达到 120 fps 的保证；具体内容以对应源码、APK 版本和验证记录为准。

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
| 原生材质实现 | [Liquid Glass 模块](./modules/liquid-glass/README.md) |
| 上游更新流程 | [上游维护说明](./docs/UPSTREAM.md) |
| 签名与发布 | [发布说明](./RELEASING.md) |
| 原项目功能 | [上游 README](./docs/UPSTREAM-README.md) |
| 界面翻译 | [翻译指南](./TRANSLATING.md) |

提交问题或建议请使用 [本仓库 Issues](https://github.com/zskruc/resonus-glass/issues)，中文和英文均可。请附上 Glass 版本、设备和 Android 版本、复现步骤，并说明问题是否只在本分支出现；仅由 Glass 定制造成的问题请在这里反馈。

## 许可证与致谢

- [Resonus](https://github.com/juananzzz/resonus)：原作者 **juananzzz** 及原项目贡献者；本衍生项目继续采用 **GPL-3.0-or-later**，见 [LICENSE](./LICENSE)。支持原作者可前往其 [Ko-fi](https://ko-fi.com/juananzzz)。
- [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass)：**Apache-2.0**。原生材质依赖 Backdrop 1.0.0，并适配其 Bottom Tabs 示例；[许可证](./modules/liquid-glass/ANDROID_LIQUID_GLASS_LICENSE)。
- [sdegenaar/liquid_glass_widgets](https://github.com/sdegenaar/liquid_glass_widgets)：**MIT**，Copyright © 2024–2026 Sebastian Degenaar。参考并适配其联动布局和最小化控制器；未引入 Flutter 引擎；[许可证](./modules/liquid-glass/LIQUID_GLASS_WIDGETS_LICENSE)。
- Primuse：歌词动效的部分实现遵循 **MIT**，详见 [第三方声明](./THIRD_PARTY_NOTICES.md)。

原项目图标、其他依赖和原有第三方声明继续保留各自权利与许可。
