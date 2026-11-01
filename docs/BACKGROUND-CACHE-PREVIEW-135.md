# 锁屏与后台缓存 / Background caching

`0.8.5.2-preview.3` · Android `versionCode 135` · 本地测试版。

## 修正

- 批量封面与歌词缓存不再在 Android 切后台时主动暂停。音乐下载与资料缓存通过同一原生协调器申请独立任务；结束其中一个任务不会停止另一个。
- Android 14 及以上采用用户发起的数据传输任务（UIDT），旧 Android 采用 dataSync 前台服务与仅在任务期间持有的部分唤醒锁。二者不会同时运行。保留现有 React 运行时，以任务级 HeadlessJS 保证后台计时、重试和后续队列调度继续执行。
- 后台通知显示合并进度，并提供全部暂停、全部取消。所有任务结束后释放原生任务与计时租约；普通浏览不申请后台运行。
- 暂停、取消、切换账号、离线和仅 Wi‑Fi 限制继续生效。原生任务丢失、网络授权不匹配或系统中止会暂停并保留资料缓存检查点，不伪装成仍在继续下载。
- 启动、停止按精确任务令牌归属处理，覆盖等待系统启动时取消、旧启动结果晚到、通知事件与启动结果乱序，以及两类任务并发的情况。

## 范围

从前台主动开始的缓存可以继续在锁屏和切后台时运行。这不等于强行停止、重启手机或进程被杀后自动恢复：本版没有创建新的冷启动运行时，也没有绕过系统停止操作。资料缓存保留既有磁盘检查点，音乐仍采用现有下载队列和文件提交规则。

UIDT 的网络授权必须与实际默认网络一致；不会为了下载将整个播放器进程绑定到另一张网络。通知授权只影响通知可见性，不用于判断任务是否已取得原生保护。

## 验证

1076 项应用测试、规范 ID、完整类型、翻译及所改生产文件 ESLint 检查通过。实际生产 Kotlin 协调器通过 34 项生命周期断言；ARM64 Release 构建通过。最终 APK 的 9 个改动生产源码与 bundle 一致，Hermes、包名、版本、签名和 ABI 均已核验。私有设备记录和账户信息不进入公开仓库。

APK：`Resonus-Glass-v0.8.5.2-preview.3-code135-arm64-v8a.apk`，45,769,252 bytes，SHA-256：`7dae00e7647d732d04222e5c57f0dfd65c0c327349b3fbc906969e2ba0af3df4`。生产源码提交 `636b8b2735731d5f27cb854534fb4b8653cacea6`。

本轮电脑未检测到三星，未安装或改动手机设置。锁屏、切后台的真实进度，以及两类缓存并行和通知操作仍待实机验证；不能以自动检查代替真实锁屏验收。本包尚未发布为正式 GitHub Release。

## English

Explicit artwork/lyrics caching and offline music downloads now share a token-scoped Android background coordinator. Android 14+ uses a user-initiated data transfer job; older versions use a dataSync foreground service. A scoped HeadlessJS task keeps the existing runtime's timers operational. Notification controls pause or cancel the work, and all protection is released when no jobs remain. Account, connectivity, Wi-Fi-only and explicit stop policies remain authoritative. Force-stop/reboot resurrection is outside this preview's scope.
