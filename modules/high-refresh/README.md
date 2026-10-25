# Foreground high refresh / 前台高刷新率

Resonus Glass requests a 120 Hz UI cadence for its foreground app windows. The
request is independent of routes, playlists, glass surfaces and JavaScript
lifecycles. The `withHighRefresh` config plugin installs the policy before React
Native starts; Expo prebuild can regenerate `android/` without losing it.

Resonus Glass 为所有前台应用窗口请求 120 Hz，策略不依赖页面、播放列表、玻璃控件
或 JavaScript 生命周期。`withHighRefresh` 在 React Native 启动前安装策略，重新生成
Android 项目不会丢失此设置。

Android 15+ adaptive refresh rate treats many View redraws as Normal (usually
60 Hz) after temporary touch and launch boosts expire. The app explicitly sets
`preferredRefreshRate = 120` and opts its windows out of that balanced ARR policy
with `frameRatePowerSavingsBalanced = false`. It does not pin a physical display
mode or change resolution. Public `WindowInspector` discovery on Android 10+
includes React Native modal dialogs and popup windows, not only the Activity.

Android 15 及以上系统的自适应刷新率可能在触摸、启动的临时加速结束后，将普通重绘
归为约 60 Hz。应用显式请求 120 Hz，并对应用窗口关闭这一节能策略；不固定物理显示
模式，不修改屏幕分辨率。Android 10 及以上通过公开的 `WindowInspector` 同时处理
主页面、React Native 弹窗和菜单窗口。

Discovery and repairs run on resume, attach, focus and layout events, with
deduplicated no-op updates. There is no polling, perpetual animation/frame loop,
wake lock or systemwide setting. When the app leaves the foreground, its prior
window preferences are restored. Unit tests cover restoration, ownership of
changed fields, foreground readiness, older APIs and repeated route changes.

策略只在恢复前台、窗口挂载、焦点或布局变化时运行，并跳过重复设置。没有定时轮询、
持续重绘、唤醒锁或全局系统设置。离开前台时恢复窗口原有策略。单元测试覆盖恢复、
外部修改的设置、窗口可用状态、旧系统和反复切页。

The request is an app preference, not a guarantee: Android retains control over
hardware support, battery saver, thermal throttling and higher-priority system
windows. This policy also cannot make expensive JS/GPU work finish within an
8.33 ms frame. Idle static screens need not redraw 120 times per second.

这是应用刷新率请求，Android 仍保留硬件、省电模式、温控和系统窗口的最终决定权。
此策略也不能让耗时的 JS 或 GPU 工作自动缩短到 8.33 毫秒内；静止页面无需每秒重绘
120 次。

References / 参考：

- [Android adaptive refresh rate](https://developer.android.com/develop/ui/views/animations/adaptive-refresh-rate)
- [Android frame-rate API](https://developer.android.com/media/optimize/performance/frame-rate)
