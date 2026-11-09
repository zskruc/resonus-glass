# Background playback power / 后台播放功耗

Issue: [upstream #321](https://github.com/juananzzz/resonus/issues/321).
Preview: `0.8.7.1-preview.24`, Android code `170`.

## 中文

本轮只调整后台执行和持久化路径，保留页面布局、玻璃参数和前台动画。

- Android 音频原生层同时检查实际当前源、已预载下一首和 JS 对后续网络来源的保守提示。只有明确本地文件窗口才使用 LOCAL 唤醒模式；网络或未知来源仍使用 NETWORK，并在装入下一网络源之前升级。
- 普通后台播放的周期状态由 500ms 降为 5000ms；前台和依赖精确心跳的交叉淡入淡出、章节停止、静音跳过、播客片尾跳过及睡眠定时仍保持原精度。暂停、空闲及备用播放器不保留无用周期任务。暂停、定位、加载、错误、曲终和原生无缝切换继续通过即时事件报告。
- 压缩音频卸载只在后台、单个有限时长项目、非循环、1×、无 EQ／ReplayGain／淡出等处理时请求。原生再次核对真实媒体项数、参数和采样状态；加入下一首前禁用。设备或格式不支持时使用普通路径。
- 当前 Media3 为 1.9.0，存在后来在 1.9.3 修复的压缩卸载／无缝列表问题，因此不将卸载推广到双曲原生队列。`powerStatus` 和现有诊断报告分别显示请求、允许和实际卸载／休眠回调，不能把请求视为已经启用。
- UPnP 普通后台或灭屏时降低查询频率；返回前台和操作通过原生合批唤醒立即查询。失联、恢复、交接和曲终确认采用真实经过时间，保留原 30 秒失联等阈值，不随轮询间隔放大。普通受控设备在已知曲末最后 10 秒仍每秒查询。
- Android Auto 取消独立的每秒 JS 位置定时器，复用播放器既有事件；前台普通位置最多每秒一次、后台每 5 秒。车机按实际倍速在原生侧外推进度，缓冲时冻结；手动定位及播放状态变化即时更新。
- 完整队列仅在内容或播放方式变化时写入加密存储；纯进度使用约数百字节的双槽检查点，前台最多每 20 秒、后台每 120 秒，明确保存操作可立即写。检查点必须与完整队列的持久代际、顺序签名、所选 occurrence 和账号匹配。清空队列保留墓碑并撤销检查点；旧队列无检查点时保持兼容。
- 完整队列仍限制 500 首，但保存窗口包含实际当前歌曲，避免当前下标超过 499 时错误恢复另一首。账号／来源变更、失败写入和旧异步完成不能为新队列提交进度。

这里的账号隔离针对新增进度检查点；不声称重新设计了旧版共享的离线完整队列键。

### 验证边界

音频 JVM 回归运行实际生产 `BaseAudioPlayer`／`PlaybackPowerPolicy`，用虚拟时钟核对通知频率、暂停无轮询、即时事件和释放。UPnP 原生测试核对真实时间门槛及合批唤醒；检查点使用真实临时文件测试旧记录、账号 ABA、并发写入和失败恢复。完整音频补丁已从官方 Expo Audio 57.0.4 重放，并对 23 个文件逐字节核验。

这些检查不代表实际设备一定进入硬件卸载，也不提供电量改善百分比。物理 DLNA 接收器行为和长时间续航需要独立实机记录。已有歌曲、订阅和缓存不会因本轮功耗优化被清理。

最终代码通过 1,756 项 JavaScript／TypeScript 回归，以及 51 项相关原生检查
（音频策略及实际 ticker 8 项、车载时钟 6 项、UPnP 37 项）。类型及翻译检查通过；
定向 ESLint 为 0 错误，诊断页保留一项原有渲染时读取时间的警告。
诊断的空档阈值会跟随预期心跳间隔，避免把正常的 5 秒更新和快速前后台切换误报为停顿。

## English

This adapts issue #321 without replacing the existing UI or glass settings.
Native audio chooses local/network wake protection conservatively, reduces
ordinary background status updates to five seconds, and cancels idle timers.
Timing-sensitive playback features retain their existing heartbeat precision.
Offload is an optional, explicitly gated single-item path, not a claim that a
device supports it; Media3 1.9.0 gapless queues remain excluded.

UPnP polling follows lifecycle/screen state and wakes promptly for interactions;
failure and transition confirmation use elapsed-time deadlines. Position-only
persistence uses small generation-bound, profile-owned checkpoints instead of
rewriting an unchanged encrypted queue. Existing full queue keys remain
compatible, including their older offline-key limitations.

Production-code JVM and filesystem regressions cover the changed paths.
The final suite passes 1,756 JS/TS checks and 51 relevant native checks.
Real battery savings, device offload and physical renderer behavior require
separate device measurements.

Sources: [Media3 offload guidance](https://developer.android.com/media/media3/exoplayer/battery-consumption),
[Media3 1.9.3 release notes](https://github.com/androidx/media/blob/release/RELEASENOTES.md#193-2026-03-13).
