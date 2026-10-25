# 上游更新与 Glass 维护

本仓库的默认分支为 `glass`，上游为 [juananzzz/resonus](https://github.com/juananzzz/resonus) 的 `main`。Glass 使用选择性移植：保留自己的玻璃界面和交互，同时审查适合合入的上游修复。源码具有共同的上游历史，但初次公开的 Glass 改动合并为一个可审查提交，不包含本机私有开发记录。

## 在 GitHub 查看更新

1. 打开 [Actions → Check upstream updates](https://github.com/zskruc/resonus-glass/actions/workflows/upstream-check.yml)。
2. 选择 **Run workflow**，分支选择 `glass`，运行检查。
3. 完成后查看该次运行的 **Summary**，下载 `upstream-comparison-…` 附件。

报告包含上次审查后的提交、变更文件、更新日志差异，以及完整的上游更新日志。此操作只读取源码、生成报告，不会自动合并、修改分支、创建 PR 或发布安装包，也没有定时任务。

`docs/UPSTREAM-REVIEW-BASE` 记录上次**审查**的上游提交。初始值为 `e587bd5b7ccd43713390ee827bb67338fba306b5`；这次公开基线已经审查到该处，合入了选定的后台恢复、进度、歌词排序、搜索、超时和封面隐私修复，**并未完整合并上游 0.8.4**。因此首次检查可能没有“上次审查以来”的新提交，但上游仍有未采用的功能。

不要仅按“Git 显示尚未合并的提交数量”判断需要更新。选择性移植、合并整理和重写补丁会导致相同修复拥有不同提交；报告中的 patch 等价筛选也只能识别完全等价的改动，不能代替代码检查。

## 本机检查与更新

首次获取源码：

```bash
git clone https://github.com/zskruc/resonus-glass.git
cd resonus-glass
git switch glass
git remote add upstream https://github.com/juananzzz/resonus.git
```

已有本机仓库时，先用 `git remote -v` 确认：自己的仓库是 `origin`，原项目是 `upstream`；不要把 Glass 提交推送到原项目。开发资料应放在本机开发目录，避免把依赖、安装包或缓存同步到文稿云盘。

```bash
bash scripts/check-upstream.sh
```

脚本要求完整 Git 历史，通过固定的上游公开地址获取 `main`，输出到被忽略的 `artifacts/upstream-check/`。不会切换分支或修改工作区源码；需要离线查看时，可保留报告。若上游历史被重写导致审查基准不再属于 `main`，脚本会停止，先检查原因，不自动改写基准。

选定更新后，在独立候选分支上处理：

```bash
git switch glass
git pull --ff-only origin glass
git switch -c update/upstream-YYYYMMDD
git fetch --no-tags upstream main
# 先读报告和具体补丁，再对选定提交逐项操作：
git cherry-pick -x <upstream-commit>
```

操作前提交或妥善保存本地修改。若发生冲突，逐处检查后再继续；需要撤销这次尝试时使用 `git cherry-pick --abort`。不要用强推、整文件覆盖或 `reset --hard` 来跳过冲突。不能直接移植的修复可以手工适配，并在提交说明中记录原上游提交和取舍。

维护者完成一轮审查后，在同一个候选分支更新 `docs/UPSTREAM-REVIEW-BASE` 为最后确实审查过的上游完整 SHA，并在 PR 中说明本轮合入、跳过及待验证的部分。只有部分看过的提交，不能把整个上游最新位置标为已审查。

完成测试后，把候选分支推送到自己的仓库并向 `glass` 创建 PR。检查与人工验证通过后再合并，不要用 GitHub 的 **Sync fork / Discard changes** 或直接覆盖 `glass` 来更新。本仓库有意使用独立仓库，更新依靠上述上游对照与候选分支流程。

## 验证与安装包

现有 Checks、Translations、Canonical ids 和 Native harness 流程继续保留；相应推送检查支持 `glass` 和 `main`，PR 按各流程范围检查。更新前后应执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm i18n:check
```

涉及 Android 播放解码时补跑 `pnpm harness:extractor`。涉及界面或原生模块时，构建后在设备检查滚动、菜单、mini player、折叠/展开、后台返回、在线播放与离线歌曲；通过测试不代表所有手机都已获得相同帧率。

[Actions → Glass ARM64 test APK](https://github.com/zskruc/resonus-glass/actions/workflows/glass-apk.yml) 提供手动 ARM64 构建，运行时选择要验证的分支；产物位于该次运行的附件中，包含 APK、校验值和测试说明。流程使用 Glass 独立包名，并在每次运行时生成一次性测试签名，密钥只在临时 runner 使用，结束后清理；不需要上传个人签名密钥，也不会创建 GitHub Release。

**CI 测试 APK 无法覆盖手机上现有的 Resonus Glass，也无法覆盖其他次 CI 构建。** 测试应使用独立设备或测试配置。不要为了绕过签名不一致卸载现有 App，否则会丢失登录、设置和离线下载。要保留资料覆盖更新，需由维护者在本机使用与当前安装相同的签名生成 APK；签名密钥不随源码公开。

原上游签名发布、原版测试 APK 和 iOS IPA 流程仍保留，但仅在 `juananzzz/resonus` 仓库运行。在本仓库它们会跳过，避免把原版应用或上游标签误作 Glass 发布。
