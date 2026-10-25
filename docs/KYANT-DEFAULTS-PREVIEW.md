# Kyant 默认材质预览

本次预览版本为 **0.8.4.1-preview.1 / Android versionCode 68**，用于比较 Kyant 示例组件的原始材质与之前保存的自定义材质。布局、字体、导航位置、折叠门槛、播放器行为及已有的背景采样优化保持当前实现。

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

此修改仅替换原本存在的玻璃材料。之前移除玻璃边框的播放按钮、原生开关和滑条保持现有呈现，没有因上游有 Toggle / Slider 示例而重新增加玻璃层。弹窗大小、圆角、背景遮罩和文字也沿用 App 的现有界面。

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
