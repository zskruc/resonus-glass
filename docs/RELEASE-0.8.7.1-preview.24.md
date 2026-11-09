# Resonus Glass 0.8.7.1-preview.24 · 170

## 中文

本次重点适配 [Resonus 上游 #321](https://github.com/juananzzz/resonus/issues/321) 的后台耗电问题，同时汇总自 152 以来已完成的本地改动。保留现有播放器布局、Apple Music／Spotify 样式选择及已保存的玻璃参数。

### 后台播放省电

- 普通后台播放的周期状态更新由每 500ms 降为每 5 秒；返回前台恢复原频率。暂停、空闲与备用播放器取消无用周期任务。
- 根据实际当前歌曲、已预载下一首和后续网络需求选择播放锁。明确的本地文件播放窗口使用本地模式，网络或未知来源保留网络保护。
- 交叉淡入淡出、睡眠定时、章末停止及跳过静音等依赖精确更新的功能保留原精度；播放、暂停、定位、错误与曲终事件仍即时报告。
- UPnP 普通后台轮询降频，操作和回前台即时唤醒；失联及交接判断使用真实经过时间。Android Auto 复用播放器事件，取消独立的每秒 JS 位置定时器，原生端按实际倍速外推进度。
- 纯进度保存使用与账号、完整队列及所选歌曲绑定的小型双槽检查点，避免反复加密写入完整队列。硬件音频卸载只在受限兼容条件下请求，不强制启用。

实现细节和兼容边界见 [后台功耗说明](./BACKGROUND-POWER-20261110.md)。

### 同步此前的累计改动

- 播客发现先进入页面，再逐步显示首批 7 条节目并按需扩展；支持流式解析，不等待多年目录全部下载、解析后才显示首屏。
- 播客封面和取色在预览与完整目录交接时保持稳定，修复二次加载闪烁。
- 新增播客存储管理：分别统计音频、封面和目录并分类清理；自动下载且已听完的节目在 24 小时后可回收，未订阅且 3 天未访问的目录可回收。订阅、收藏和播放进度保留；启动／回前台低频整理，每天最多一次。
- 优化按年代浏览专辑的封面批次和静态玻璃绘制，共享有容量上限的材质缓存；保留原渲染回退，不改变 Mini Player 与底栏的实时材质。
- 汇总 17 项可选工具，包括个人备份、歌词编辑与导出、电台发现、文件夹与标签、小组件、本机歌曲信息纠错、Wi-Fi 传歌、拼音搜索、听歌情景、独立会话、连续曲组、艺人别名、缺曲找回、分语言字体及章节工具。入口、数据边界和此前的针对性验收见 [功能说明](./PRIMUSE-TOOLS-0.8.7.1-preview.7.md)；该文档保留初次测试包的历史状态，不代表本次尚未发布。

### 验证

- 1,756 项 JavaScript／TypeScript 回归及 51 项本轮相关原生检查通过；类型、翻译、Navidrome ID 检查通过。
- 完整音频补丁从官方 Expo Audio 57.0.4 重放，并核验 23 个文件；APK 中 132 个变更生产源码文件与构建源码一致。
- Samsung SM-S9380 已覆盖安装 170：核对网络播客及本地下载专辑的后台 5 秒／前台 500ms 策略、本地播放锁、暂停后停止定时更新，以及灭屏续播和系统媒体暂停／恢复。本轮应用进程未发现崩溃，临时亮屏设置已还原。
- 尚未进行长时间耗电测量，不提供省电百分比；本轮未验收实际硬件卸载、实体 DLNA 接收器或车机。此前工具的未完成实机范围仍以各自说明为准，不承诺全局持续 120 fps。

### 安装

下载本页 ARM64 APK，可覆盖相同包名及签名的 Resonus Glass；保留原 App，直接覆盖安装即可保留资料。本版仍为预发布，不进入现有正式版本自动更新通道。

## English

This preview adapts the background power concerns in upstream Resonus issue #321 and includes the completed local changes since build 152. Existing player layouts, UI style choices and saved glass tuning remain available.

Ordinary background status updates now run every five seconds instead of 500ms; foreground and timing-sensitive features retain their original cadence. Idle and paused tickers stop. Native playback conservatively distinguishes local files from network sources, including the queued next item. UPnP polling follows lifecycle state and elapsed-time thresholds. Android Auto reuses existing progress events with native speed-aware extrapolation. Small profile-owned, generation-bound progress checkpoints replace repeated unchanged full-queue writes. Audio offload is requested only under restricted compatibility conditions.

Cumulative changes include progressive seven-episode podcast previews, streaming feed parsing, stable artwork/palette handoff, categorized podcast storage management and daily low-frequency cleanup. Eligible automatically downloaded completed episodes can be reclaimed after 24 hours; unvisited unsubscribed catalogs after three days. Subscriptions, favorites and playback progress are retained. Era browsing uses bounded shared static glass resources. Seventeen optional library, backup, lyric, radio, customization and listening tools are also included; see the linked feature documentation for entry points and validation limits.

Validation: 1,756 JS/TS tests and 51 relevant native checks passed, with type, translation and canonical-ID checks. Samsung testing covered stream/local background policies, stopped paused timers, screen-off playback and system media pause/resume. No app-process crash was found in this run. Long-term battery savings, actual hardware offload and physical DLNA/car hardware are not certified by these tests.

The ARM64 APK updates the existing identically signed Glass application in place. This is a prerelease and remains outside the stable automatic update channel.

## APK identity

- Version: `0.8.7.1-preview.24` / Android `170`
- Built source: `b8438b17776579cebc25baf6038f0a0de326305a` (release documentation is committed afterwards)
- Package: `com.zskruc.resonus.glasspreview`
- APK: `Resonus-Glass-v0.8.7.1-preview.24-code170-arm64-v8a.apk`
- SHA-256: `7647b7fd5f168f854fc46b19f4a6119f8613decdd9fc5ddfade4884c223de8d5`
- Size: `47,785,456` bytes
