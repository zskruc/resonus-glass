# Kyant 默认材质预览

本次预览版本为 **0.8.4.1-preview.4 / Android versionCode 71**，用于比较 Kyant 示例组件的原始材质与之前保存的自定义材质。布局、字体、导航位置、折叠门槛、播放器行为及已有的背景采样优化保持当前实现。

## 来源与范围

参数参照 [AndroidLiquidGlass 的 kmp 源码](https://github.com/Kyant0/AndroidLiquidGlass/tree/65ab177e90e5c1d8c62e70cf7755841982da65f6)，固定提交为 `65ab177e90e5c1d8c62e70cf7755841982da65f6`（tag `2.0.1`）。同时核对了 App 所使用的 [Backdrop 1.0.0 源码](https://github.com/Kyant0/AndroidLiquidGlass/tree/eada9a8600142c1bd6a5c5fc143d06f599cdfaef)，提交为 `eada9a8600142c1bd6a5c5fc143d06f599cdfaef`；下列材质数值在两版一致，Android 依赖继续使用 `1.0.0`。

上游 [README](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/README.md#L13-L21) 说明库不提供统一的高层组件，所列控件是示例。`blur()` 的半径与 `lens()` 的高度、强度没有统一数值默认值。因此，本预览按用途对应不同示例，没有将一组数值强行用于全部表面，也不将这些值称作 Apple 的私有参数。

## App 中的材料对应

以下 `lens` 两个值依次是 `refractionHeight`、`refractionAmount`；JS 属性 `refraction` 对应后者。所有距离均为 dp。

| App 中的现有玻璃表面 | 上游对应 | 模糊 | lens 高度 / 强度 | 景深 / 色散 | 表面填色 |
| --- | --- | --- | --- | --- | --- |
| mini player，包括折叠和展开 | LiquidButton | 2 | 12 / 24 | 关 / 关 | 透明，无专辑封面染色 |
| 普通 GlassBackdrop、输入容器等现有玻璃表面 | LiquidButton | 2 | 12 / 24 | 关 / 关 | 透明 |
| 主导航外壳、右侧独立搜索按钮 | LiquidBottomTabs 外壳 | 8 | 24 / 24 | 关 / 关 | 浅色 `#FAFAFA` 40%；深色 `#121212` 40% |
| 主导航的选中镜片 | LiquidBottomTabs 选中层 | 不另加模糊 | `10p / 14p` | 关 / 开 | 休止态为浅色黑 / 深色白的 `10%(1-p)`；按压再叠黑色 `3%p` |
| prominent GlassBackdrop、菜单和弹窗卡片 | DialogContent | 浅色 16；深色 8 | 24 / 48 | 开 / 关 | 浅色 `#FAFAFA` 60%；深色 `#121212` 40% |

`p` 是按压进度，范围为 0–1，不是 mini player 的折叠进度。主导航按压时也恢复上游辅助材质层的 `24p / 24p` 镜片与随 `p` 出现的高光，供选中镜片取样；该辅助层只录制、不显示，不复制文字，也不增加屏幕捕获，静止时不创建。mini player 没有上游同名示例，因此选用无填色的 LiquidButton 胶囊材料；这是本 App 的组件映射。

preview.1/2 仅替换原本存在的玻璃材料。preview.3 按新的需求恢复对应 LiquidButton 的操作按钮，并将全 App 的开关和滑条分别接入原生 LiquidToggle、LiquidSlider。设置整行、歌曲列表项、封面、色样和文本链接仍采用各自的容器交互，避免把列表内容重复渲染为独立玻璃按钮。弹窗大小、背景遮罩和文字沿用 App 的现有界面。

对应的上游证据：

- [LiquidButton 参数与无填色默认](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidButton.kt#L35-L99)。
- [LiquidBottomTabs 主题颜色](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidBottomTabs.kt#L68-L74)、[外壳](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidBottomTabs.kt#L166-L180)、[选中镜片](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/LiquidBottomTabs.kt#L241-L282)。
- [DialogContent 材料与主题差异](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/destinations/DialogContent.kt#L42-L70)。

## 高光、阴影和颜色处理

Button 和 Tabs 材料直接使用库的 `Highlight.Default`：宽 0.5dp、高光模糊 0.25dp、总 alpha 1，白色强度 0.5、Plus 混合、方向 45°、falloff 1。Dialog 使用 `Highlight.Plain`，宽度和模糊相同，白色强度为 0.38、Plus 混合。这里的“总 alpha”与高光样式内的白色强度是两项不同参数。

这些材料恢复 `Shadow.Default`：半径 24dp、偏移 `(0,4dp)`、黑色 alpha 0.1、总 alpha 1。普通表面不增加内阴影。主导航选中镜片的高光和外阴影随 `p` 显现，内阴影为半径 `8p`、偏移 `(0,8p)`、黑色 alpha 0.15、总 alpha `p`。

Button 和 Tabs 的 `vibrancy()` 使用饱和度 1.5。Dialog 也使用饱和度 1.5，浅色主题的 brightness 为 0.2，深色为 0；对比度保持 1。

源码证据：[drawBackdrop 的默认装饰](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/DrawBackdropModifier.kt#L80-L92)、[Highlight](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/highlight/Highlight.kt#L10-L26)、[HighlightStyle](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/highlight/HighlightStyle.kt#L32-L80)、[Shadow](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/shadow/Shadow.kt#L14-L19)、[InnerShadow](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/shadow/InnerShadow.kt#L17-L22)、[vibrancy](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/backdrop/src/commonMain/kotlin/com/kyant/backdrop/effects/ColorFilter.kt#L29-L44)。

## 为什么默认预览不叠底部背景模糊

此前的 BottomScrollEdge 是本 App 额外添加的整片底边背景模糊，并非 LiquidButton / LiquidBottomTabs 示例材质的一部分。它会让控件先采到已经模糊的背景，再叠加自身模糊，影响这次默认参数比较。

在「开源默认参数」模式下，BottomScrollEdge 不挂载原生玻璃视图，也不显示其渐变遮罩。mini player 不启用仅为旧底边模糊服务的原始背景补丁，直接使用同一份页面背景，由自己的 2dp 模糊与镜片处理。主导航和搜索同理由各自的 8dp 材料处理背景。自定义及旧参考模式仍保留原有底边模糊逻辑。

上游另有 [ProgressiveBlurContent](https://github.com/Kyant0/AndroidLiquidGlass/blob/65ab177e90e5c1d8c62e70cf7755841982da65f6/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/destinations/ProgressiveBlurContent.kt#L23-L64) 的独立演示；它不属于上述控件的默认材料，本预览没有再将其叠入底栏。

## 旧参数的保留与选择

首次进入此预览时，外观模式默认为 `kyantDefault`。模式读取使用新的 `resonus.glass-appearance.v2` 键，避免旧版保存在 v1 中的模式选择覆盖本次默认预览。

原有三个自定义参数组继续保存在 `resonus.glass-tuning.v1`，不自动删除或覆盖。「开源默认参数」模式忽略这些覆盖值；切回「自定义参数」即可使用原有值，旧参考模式也保留。只有明确点击保存才保存当前模式与参数。


## preview.2 的标签切换同步修复

默认材质参数与 preview.1 相同。本轮修复导航与背景采样的同步路径：

- 已挂载且位于前台的标签导航器直接接收带目标 key 的 JUMP_TO；艺人、专辑等外层页面仍使用清栈导航，保留路由参数。
- 普通点击不再先让选中镜片弹回旧标签，再弹向新标签；拖动取消的回弹仍保留。短按释放不再额外等待 120ms。
- 选中位置随页面提交在 layout effect 更新；避免点击路径同步读取 UI 线程共享值，页面恢复也不重复触发零距离折叠展开动画。
- 玻璃背景同时跟踪外层页面与实际活动标签。切换标签时立即推进页面代数，拒收旧标签的异步画面，并走现有按显示帧更新的采样路径。
- 子导航器延迟挂载时，在布局变化后重新发现；找到容器后停止监听，普通绘制帧不扫描整棵界面树。
- 新画面发布和页面清空后批量应用 Compose 绘制通知；官方材质等待画面时保持自身透明度，不临时提高到 0.82。

后台页面冻结、原有异步采样背压、空闲刷新限制、布局及滚动触发阈值保持原有策略。


## preview.3：原生控件与持续前台高刷请求

- 所有 `GlassSwitch` 使用共享背景的原生 LiquidToggle；设置、登录、分享、编辑播放列表等原生 Switch 入口统一接入。轨道为官方绿色（浅色 `#34C759`、深色 `#30D158`），白色静止滑块，按压时 blur `8(1-p)`、lens `5p / 10p`，启用官方色散、Ambient 高光及默认阴影。
- 所有 `GlassSlider` 使用 LiquidSlider；播放进度和设置滑条统一接入，轨道为官方蓝色（浅色 `#0088FF`、深色 `#0091FF`），按压时 blur `8(1-p)`、lens `10p / 14p`。保留原来的范围、步长、禁用和提交语义，垂直滚动导致的取消不提交播放跳转；零时长不产生虚假的可拖动范围。
- 控件默认弹簧和拖动形变由原生 Compose 执行，JS 只接收值事件；静止白色滑块不参与采样，按压及有限回弹尾部复用原有共享采样，没有常驻额外的捕获器。
- 普通操作按钮使用 LiquidButton 的透明材料；明确着色的主按钮使用官方 Hue 混色与 75% 色层。按钮整体按压放大和阻尼位移由 UI 线程执行，保留现有布局、文字、点击及无障碍功能。按钮按压提亮为默认 8%；当前 RN 按钮未复刻官方 RuntimeShader 的跟手径向光斑。
- 前台刷新率由独立的原生窗口策略请求 `120 Hz`，覆盖 Activity、RN Modal 及发现的弹窗，并在恢复前台、挂载、焦点和布局变化时校正。配置插件使重新生成 Android 工程后仍保留策略；后台恢复原窗口属性，没有定时轮询、持续重绘或系统全局设置。
- 120 Hz 请求与实际 120 fps 分别判断。系统温控、省电策略和硬件仍有最终决定权；该策略不能掩盖超出 8.33 ms 的实际渲染耗时。三星当前的 `hasArrSupport=false`，不能仅凭 Android 15 的 ARR 文档将设备上的降刷唯一归因于 ARR。

对应实现见 [原生控件](../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/LiquidGlassControls.kt) 与 [高刷策略](../modules/high-refresh/README.md)。本轮实机验证状态随 APK 验证记录另行记录，未验证的连接状态不写成已通过。


## preview.4：移动玻璃的绘制通知合批

preview.3 实测确认窗口持续请求 120 Hz，但长列表滚动仍有真实漏帧；不能把屏幕刷新率当作实际 120 fps。新增的列表收藏等玻璃按钮随歌曲行移动，原来的几何更新逐个发送全局 Compose 通知，会把同一帧内多个控件的重绘反复唤醒。

本轮将同一帧的位置变更先更新完，再统一应用绘制通知；保留当帧位置校正和旧异步画面拒收，不降低背景采样率，不修改官方玻璃参数，也不加入像素读回。结果以对应 APK 的实机验证记录为准。
