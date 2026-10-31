# 发布 Resonus Glass Android APK

正式版本发布到 [zskruc/resonus-glass Releases](https://github.com/zskruc/resonus-glass/releases)，默认源码分支为 `glass`。App 的版本检查、更新摘要与 APK 下载读取本仓库已发布的最新正式 Release；草稿和预发布不会触发正式更新提示。

目前正式 APK 在维护者本机使用既有签名构建，再上传到 GitHub Release。保留的上游 `Release APK` 和 iOS IPA 工作流只在原项目仓库运行，不负责发布 Glass。`Glass ARM64 test APK` 工作流每次生成临时测试签名，**不能替代当前手机安装使用的签名，也不能作为覆盖更新的正式安装包**。

## 当前测试版

2026-11-01 发布 `v0.8.5.1-preview.6`，Android `versionCode 128`，使用现有 Glass 包名及签名。它是测试预发布，APK 已完成三星短时交互验证；不会被 `/releases/latest` 选作正式更新。源码及实际范围见 [本轮说明](./docs/ALBUM-ARTIST-PREVIEW-6.md) 与 [Changelog](./CHANGELOG.md)。下文 `v0.8.4` 命令保留为旧正式版流程示例，不代表当前预发布。

预发布使用相应真实版本 tag、`--prerelease` 与版本匹配的 APK；不得把未做三星验收的本地动效实验放进该 tag 或附件。

## 版本与更新内容

- 本次版本为 `0.8.4`，Android `versionCode` 为 `67`，Git tag 为 `v0.8.4`。
- 三段版本跟随最近审查的上游正式版基线，不表示已合并上游的全部功能。发布说明必须列出实际采用的改动与未包含的范围。
- 同一基线内的 Glass 修订可以用第四段，如 `0.8.4.1`；下一上游基线使用 `0.8.5`。当前更新比较支持逐段数字比较。
- 每次发布都递增 `app.json` 的 `expo.android.versionCode`，即使仅修改第四段版本。`expo.version`、Git tag 和 Release 标题中的版本须一致。
- 在 `CHANGELOG.md` 顶部增加 Glass 版本条目。Release 说明使用该条目的正文；保留 `### Added`、`### Changed` 和 `### Fixed` 等英文小节标题，小节内容可以使用中文。App 据这些标题生成更新摘要。

`Source.json` 和上游 iOS 发布资料不属于 Glass Android 发布流程，不要把本次 APK 版本写成原项目 iOS 更新。

## 本机签名

覆盖更新必须继续使用 `com.zskruc.resonus.glasspreview` 包名和原安装的签名。请备份原密钥及其密码；重新生成密钥不能更新已有安装。不要为绕过签名不一致而卸载 App，否则会删除登录资料、设置和离线下载。

在被 Git 忽略的 `.local-signing/env.sh` 中配置：

```bash
export RESONUS_KEYSTORE_FILE='/absolute/local/path/to/existing-release-keystore.jks'
export RESONUS_KEYSTORE_PASSWORD='local-secret'
export RESONUS_KEY_ALIAS='existing-key-alias'
export RESONUS_KEY_PASSWORD='local-secret'
```

示例中的路径、别名和密码需要替换为现有签名配置。构建脚本自动读取此文件。不要把密钥、密码、`env.sh`、私有备份或设备诊断材料提交到仓库、Release 附件或日志；当前流程不需要把它们上传到 GitHub Secrets。

没有上述签名配置时，Android 构建可能退回开发签名；构建成功本身不能证明可以覆盖当前手机。发布前必须检查最终 APK 的证书，与既有正式 APK 或设备上安装包的证书比较。

## 构建与本地验收

使用本机开发目录，按 [README](./README.md#从源码构建-android) 配置 Node.js 24、pnpm 11、Java 17 与 Android SDK。确认工作区内容属于本轮发布，再执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm i18n:check
bash scripts/build-glass-preview.sh
```

涉及播放解码时另跑 `pnpm harness:extractor`。脚本输出 `artifacts/Resonus-Glass-preview.apk`，本次正式文件按版本命名：

```bash
cp artifacts/Resonus-Glass-preview.apk artifacts/Resonus-Glass-v0.8.4-arm64-v8a.apk
(cd artifacts && shasum -a 256 Resonus-Glass-v0.8.4-arm64-v8a.apk > Resonus-Glass-v0.8.4-arm64-v8a.apk.sha256)
```

使用 Android SDK 的 `aapt` 或 `apkanalyzer` 检查版本为 `0.8.4`、更新编号为 `67`、包名为 `com.zskruc.resonus.glasspreview`，并确认 APK 含 ARM64 原生库。用 `apksigner verify --print-certs` 验证签名及证书指纹。工具路径取决于本机 SDK 安装位置。

在支持的设备做覆盖安装，检查关于页、仓库链接、更新内容、检查更新，以及登录、离线资料和主要播放交互。发布说明只写本轮真正完成的验证；没有设备验收时明确记录，不把构建通过当作实机通过。

## GitHub 草稿、核对与发布

以下命令显式选择自己的仓库。先将经过验证的源码提交推送到 `origin` 的 `glass` 分支，再为该提交创建 tag。已发布的 tag 或附件不可直接覆盖；修订版本使用新版本号和更高的 `versionCode`。

```bash
git push origin glass
git tag v0.8.4
git push origin v0.8.4
```

把本轮更新说明保存到被忽略的本地文件，例如 `artifacts/release-notes-v0.8.4.md`。从 `CHANGELOG.md` 提取对应版本的正文，保留英文小节标题；不要使用自动生成的原项目全量提交日志替代 Glass 的实际更新说明。创建草稿并上传 APK 及校验值：

```bash
gh release create v0.8.4 \
  --repo zskruc/resonus-glass \
  --verify-tag \
  --draft \
  --title 'Resonus Glass 0.8.4' \
  --notes-file artifacts/release-notes-v0.8.4.md \
  artifacts/Resonus-Glass-v0.8.4-arm64-v8a.apk \
  artifacts/Resonus-Glass-v0.8.4-arm64-v8a.apk.sha256

gh release view v0.8.4 --repo zskruc/resonus-glass --json tagName,targetCommitish,isDraft,isPrerelease,body,assets
```

确认 tag 指向预期源码、说明只描述本分支实际改动、APK 文件名和大小正确，并从草稿下载附件到本地缓存比对 SHA-256。确认文件可访问后发布为正式 Release：

```bash
gh release edit v0.8.4 --repo zskruc/resonus-glass --draft=false --prerelease=false --latest
gh release view --repo zskruc/resonus-glass --json tagName,url,assets
```

最后检查 [最新 Release 地址](https://github.com/zskruc/resonus-glass/releases/latest) 及 GitHub 的 `/repos/zskruc/resonus-glass/releases/latest` API：应为刚发布的版本，包含正式 APK 和正确的更新说明。App 已安装同版本时，“检查更新”正常结果是没有更高版本；不应通过临时发布虚假高版本来测试更新提示。
