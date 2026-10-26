# 统一玻璃面板 / Unified glass panels

**验证状态：.12 APK 已构建校验，尚未安装，实机待验。** 463 项应用测试、118 项玻璃模块测试及静态检查通过。`.10`、`.11` 曾安装测试，但全弹窗浅／深色、键盘和异步交互的视觉验收仍未完成。正文保留共享面板与同步底栏规则；源码回归不等于设备视觉或帧率验收。

**Validation status: .12 APK built and verified; not installed, device checks pending.** All 463 app tests, 118 glass-module tests and static checks pass. `.10`/`.11` were installed earlier, but complete light/dark popup, keyboard and asynchronous-interaction appearance acceptance remains pending. Shared-panel and synchronized-dock contracts remain below; source regressions do not establish appearance or delivered frame rate.

## 中文

### 统一入口与材质

以 [ArtistPickerSheet](../src/components/ArtistPickerSheet.tsx) 的浮动卡片为应用弹窗基准：一个玻璃面、28 个布局单位圆角、卡片内标题和关闭入口、卡片外轻遮罩。新弹窗优先复用以下入口，避免各自复制材质参数：

| 入口 | 职责 |
| --- | --- |
| [MenuGlassBackdrop](../src/components/MenuGlassBackdrop.tsx) | 唯一的面板材质入口；读取当前主题、玻璃模式和已选配方，传入原生玻璃，保留不可用时的主题色回退。 |
| [MenuGlassCardFrame](../src/components/MenuGlassCard.tsx) | 浮动卡片位置、安全区、宽高边界、28 圆角、单个材质面、外部遮罩和遮罩点击关闭。 |
| [MenuGlassCardHeader](../src/components/MenuGlassCard.tsx) | 标题、可选副标题和有无障碍标签的关闭按钮；歌曲／媒体菜单可保留自己的封面与信息标题。 |
| [MenuGlassPanel](../src/components/MenuGlassCard.tsx) | 已有锚点或自定义容器中的同源单面板，例如设置下拉选择；默认圆角同为 28。 |
| [SheetModal](../src/components/SheetModal.tsx) / [Dialog](../src/components/Dialog.tsx) | 在统一外观之上提供打开、关闭、输入、确认及内容滚动。 |

“单个材质面”指卡片底层只放一份 `MenuGlassBackdrop`，内容位于同一面板内；标题、表单、行容器和输入框不再各自叠一层背景采样。关闭按钮等独立交互控件仍可保留自己的控件样式。遮罩属于卡片外部，深色主题为黑色 18% 不透明度，浅色主题为 10%；它不替代卡片材质。原生入口使用 `isolateModalForeground`，避免把弹窗自身的前景再次当作背景。

### 覆盖范围

| 应用入口 | 实现证据与约定 |
| --- | --- |
| 艺术家选择 | [ArtistPickerSheet](../src/components/ArtistPickerSheet.tsx)：统一卡片、标题、关闭、可滚动艺术家列表。 |
| 歌曲／专辑等媒体菜单 | [SongMenuSheet](../src/components/SongMenuSheet.tsx)、[MediaMenuSheet](../src/components/MediaMenuSheet.tsx)：整张菜单共用一个面，保留原有封面、动作、子菜单与业务回调。 |
| 歌单选择、创建及重复项确认 | [PlaylistPickerSheet](../src/components/PlaylistPickerSheet.tsx)、[Dialog](../src/components/Dialog.tsx)：提示可在已有 Modal 窗口内替换内容，避免两个原生弹窗同时露出。 |
| 设置选择与颜色编辑 | [SettingsUI](../src/components/SettingsUI.tsx)、[ColorPickerDialog](../src/components/ColorPickerDialog.tsx)、[资料库来源选择](../src/app/settings/library.tsx)：锚定选择使用 `MenuGlassPanel`，独立表单使用卡片外壳。 |
| 编辑与添加 | [PlaylistEditSheet](../src/components/PlaylistEditSheet.tsx)、[RadioEditSheet](../src/components/RadioEditSheet.tsx)、[PodcastAddSheet](../src/components/PodcastAddSheet.tsx)：保留字段、校验、封面操作和键盘交互，使用同源材质。 |
| 通用确认、下载与导入反馈 | [Dialog](../src/components/Dialog.tsx)、[下载设置](../src/app/settings/downloads.tsx)、[字体设置](../src/app/settings/font.tsx)：应用内确认／错误信息复用统一外壳；具体动作仍由调用方负责。 |

操作系统提供的文件／目录选择、分享、权限等系统窗口保留系统呈现。[CoverViewer](../src/components/CoverViewer.tsx) 的全屏封面查看也不套用此卡片模板；它内部需要的确认或密码提示可以复用 `Dialog`。

### 输入、短屏与关闭事务

卡片已经提供材质，输入框使用自己的轻量填充、边界和文字状态，不再嵌套一块玻璃背景。卡片中的普通行可关闭独立的 `buttonMaterial`；这一点不改变点击、禁用、校验或保存行为。

`MenuGlassCardFrame` 根据实际 Modal 布局和安全区计算可用宽高，而不是只依赖 Activity 尺寸。内容容器应保留 `flexShrink: 1`、`minHeight: 0` 和有边界的滚动；需要输入的滚动区域使用 `keyboardShouldPersistTaps="handled"`。编辑页保留自己的键盘避让。这样短屏、横屏或键盘弹出时，内容能在卡片边界内滚动，确认和关闭入口仍应在设备验收中检查。

统一外观不重写异步生命周期。[useBottomSheetAnim](../src/hooks/useBottomSheetAnim.ts) 负责退出动画及关闭完成顺序；[MenuRequestScope](../src/lib/menuRequest.ts) 和菜单的 session／mounted／closing 检查继续限制旧请求、旧确认、重复关闭及卸载后的回调。后续导航或打开下一弹窗应走现有的关闭完成回调；已有窗口中的创建、确认和密码输入继续使用 `inlineMenu`／`inline`。不能为了换外壳删掉这些守卫，也不能让 A 窗口的迟到结果关闭新打开的 B 窗口。

### Player 退出与底栏衔接

[useAmllPlayerTransition](../src/hooks/useAmllPlayerTransition.ts) 将播放器实际表面位移写入 [playerReveal](../src/lib/playerReveal.ts) 的 UI 线程共享值。拖拽、取消回弹、关闭按钮、返回键和导航关闭共用现有退出流程；本次衔接不改变 dismiss 阈值。

全局底栏位于 Stack 之后，因此仅改变透明度会让底栏浮在尚未移走的播放器上。[PlayerDockUnderlay](../src/components/PlayerDockUnderlay.tsx) 用两个固定全屏容器的相反平移裁剪已揭露区域：外层只露出播放器实际移开的区域，内层反向补偿，使底栏仍固定在屏幕底部。每帧直接读取同一 UI 位移，不另起底栏进入计时动画。

[useTabBar](../src/hooks/useTabBar.ts) 只为打开播放器前确实可见的底栏建立揭露资格；视觉揭露期间，点击、无障碍和原生滚动输入仍受真实路由可见性限制。[GlobalMiniPlayer](../src/components/GlobalMiniPlayer.tsx)、[GlobalTabBar](../src/components/GlobalTabBar.tsx) 和 [BottomScrollEdge](../src/components/BottomScrollEdge.tsx) 在开始退出时准备需要的材质，并在 route pop 首帧接住已完成的揭露值，不再单独淡入。[useLiquidDock](../src/hooks/useLiquidDock.tsx) 保存底层折叠目标和实际进度；返回同一底层页面时恢复其几何状态，同时仍清理旧路由的原生输入所有权。旧 Player 的清理与迟到回调受 owner 检查，不能重置新 Player。

### Tab 点击与透镜溢出

[GlobalTabBar](../src/components/GlobalTabBar.tsx) 的导航门控跟随 `compact` 目标，而非等待 spring 进度精确归零。折叠目标仍有效时，首次点击用于展开；目标已展开且行已可交互时，通过 [tabNavigation](../src/lib/tabNavigation.ts) 及时派发导航。原有可点击范围、拖拽所有权和选择事务保留。

原生选中透镜需要超出 bar 高度绘制。[PlayerDockUnderlay](../src/components/PlayerDockUnderlay.tsx) 的内层提供 `resonus-dock-selection-host` 标记，[AmPlusSelectionOverlay](../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/AmPlusSelectionOverlay.kt) 沿控件祖先链寻找自己的专用 host；不把覆盖层挂到应用窗口外。JS 的 bar 外层允许溢出，真正的 Player 揭露边界仍由全屏裁剪容器约束。正常显示和退出完成后，裁剪边界是全屏，不是 bar 的高度。

这项修正扩大绘制／采样容量，不扩大逻辑 Tab 点击范围，也不改上游透镜变形、spring 或速度参数。原生材质与来源说明见 [LiquidBottomTabsMaterial](../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/LiquidBottomTabsMaterial.kt)、[AmPlusMaterialCapacity](../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/AmPlusMaterialCapacity.kt) 和 [liquid-glass 模块说明](../modules/liquid-glass/README.md)。

### 验证记录入口

源码回归入口包括 [菜单请求事务](../test/menuRequest.test.ts)、[字体导入提示](../test/fontImportDialog.test.ts)、[PlayerDockUnderlay](../test/playerDockUnderlay.test.ts)、[Player 顶部手势与退出](../test/amllPlayerHeaderGesture.test.ts)、[底层 UI 生命周期](../test/backgroundUiLifecycle.test.ts) 和 [Tab 导航](../test/globalTabBarNavigation.test.ts)。它们用于验证回调顺序、归属和状态交接，不替代原生渲染验收。

`.12` 待验项目：浅／深色材质、菜单切换与异步关闭、短屏键盘可达性、拖拽取消与提交、返回键／点击关闭、折叠底栏恢复、Tab 及时响应，以及透镜上下溢出和 Player 裁剪交界。此前 `.10`／`.11` 的安装不代表这些入口全部已验收；后续填写真实 `.12` 设备结果，不以源码测试推导帧率保证。

## English

### Shared surface and entry points

The floating card in [ArtistPickerSheet](../src/components/ArtistPickerSheet.tsx) is the reference for app-owned panels: one glass surface, a radius of 28 layout units, a title and close control inside the card, and a light scrim outside it. Reuse these entry points rather than copying material parameters:

| Entry point | Responsibility |
| --- | --- |
| [MenuGlassBackdrop](../src/components/MenuGlassBackdrop.tsx) | The panel material source. It resolves the theme, glass mode and selected recipe, passes the result to native glass, and retains the themed fallback. |
| [MenuGlassCardFrame](../src/components/MenuGlassCard.tsx) | Floating placement, safe areas, bounded dimensions, radius 28, one material surface, the external scrim and scrim dismissal. |
| [MenuGlassCardHeader](../src/components/MenuGlassCard.tsx) | Title, optional subtitle and an accessible close button. Song/media menus retain their cover and metadata headers. |
| [MenuGlassPanel](../src/components/MenuGlassCard.tsx) | The same single surface within an existing anchor or custom container, such as a settings dropdown; its default radius is also 28. |
| [SheetModal](../src/components/SheetModal.tsx) / [Dialog](../src/components/Dialog.tsx) | Opening, dismissal, input, confirmation and scrolling on top of the shared appearance. |

One surface means one `MenuGlassBackdrop` beneath the card content. Headers, forms, row containers and text fields do not each capture another background. Independent controls such as the close button can retain their control styling. The external black scrim has opacity 0.18 in dark mode and 0.10 in light mode; it does not replace the glass material. The native material uses `isolateModalForeground` to exclude the panel's own foreground from its background source.

### Scope

| App entry | Source and contract |
| --- | --- |
| Artist selection | [ArtistPickerSheet](../src/components/ArtistPickerSheet.tsx): shared card, title, close control and scrollable artist list. |
| Song and media menus | [SongMenuSheet](../src/components/SongMenuSheet.tsx), [MediaMenuSheet](../src/components/MediaMenuSheet.tsx): one surface for the entire menu, retaining artwork, actions, submenus and business callbacks. |
| Playlist selection, creation and duplicate confirmation | [PlaylistPickerSheet](../src/components/PlaylistPickerSheet.tsx), [Dialog](../src/components/Dialog.tsx): prompts can replace content in the existing Modal window to avoid exposing two native windows together. |
| Settings choices and color editing | [SettingsUI](../src/components/SettingsUI.tsx), [ColorPickerDialog](../src/components/ColorPickerDialog.tsx), [library source selection](../src/app/settings/library.tsx): anchored choices use `MenuGlassPanel`; separate forms use the card frame. |
| Editors and add forms | [PlaylistEditSheet](../src/components/PlaylistEditSheet.tsx), [RadioEditSheet](../src/components/RadioEditSheet.tsx), [PodcastAddSheet](../src/components/PodcastAddSheet.tsx): the shared material retains fields, validation, artwork operations and keyboard behavior. |
| General confirmations, downloads and import feedback | [Dialog](../src/components/Dialog.tsx), [download settings](../src/app/settings/downloads.tsx), [font settings](../src/app/settings/font.tsx): app-owned confirmation/error content uses the shared shell; callers retain responsibility for the action. |

Operating-system file/folder pickers, sharing and permission windows retain their system presentation. The full-screen [CoverViewer](../src/components/CoverViewer.tsx) is outside this card template; its nested confirmation or password prompt may still reuse `Dialog`.

### Inputs, constrained screens and close transactions

The card already supplies the material. Inputs use a lightweight fill, boundary and text state without nesting another glass backdrop. Ordinary rows inside a panel may disable their own `buttonMaterial`; click, disabled, validation and save semantics remain intact.

`MenuGlassCardFrame` computes available bounds from the actual Modal layout and safe areas, not only Activity dimensions. Content keeps `flexShrink: 1`, `minHeight: 0` and bounded scrolling. Input scroll areas use `keyboardShouldPersistTaps="handled"`, and editors retain keyboard avoidance. This lets content scroll within the card on short screens, in landscape or with the keyboard open. Device checks must still confirm access to confirmation and close controls.

The visual shell does not replace asynchronous ownership. [useBottomSheetAnim](../src/hooks/useBottomSheetAnim.ts) retains exit/completion ordering. [MenuRequestScope](../src/lib/menuRequest.ts) and session/mounted/closing checks reject obsolete requests, old confirmations, duplicate closes and callbacks after unmount. Follow-up navigation or another panel uses the existing close-completion callback; creation, confirmation and password prompts inside an existing window retain `inlineMenu`/`inline`. Changing the shell must not remove these guards or let a late result from window A close a newly opened window B.

### Player dismissal and dock handoff

[useAmllPlayerTransition](../src/hooks/useAmllPlayerTransition.ts) publishes the actual player surface position through the UI-thread values in [playerReveal](../src/lib/playerReveal.ts). Dragging, cancellation, the close button, hardware Back and navigation dismissal share the existing exit flow. The handoff does not change dismissal thresholds.

Global dock components are drawn after Stack. Opacity alone would place them over the part of the player that remains opaque. [PlayerDockUnderlay](../src/components/PlayerDockUnderlay.tsx) clips the revealed region with opposing translations of two fixed full-screen containers: the outer container exposes only the area uncovered by the player; the inner one compensates so the dock stays anchored to the screen bottom. Each frame reads the same UI position, without starting a separate dock entrance timer.

[useTabBar](../src/hooks/useTabBar.ts) grants reveal eligibility only to a dock that was actually visible before the player opened. During visual reveal, real route visibility still gates touch, accessibility and native scroll input. [GlobalMiniPlayer](../src/components/GlobalMiniPlayer.tsx), [GlobalTabBar](../src/components/GlobalTabBar.tsx) and [BottomScrollEdge](../src/components/BottomScrollEdge.tsx) prepare required material when exit begins and retain the completed reveal through the first route-pop frame, avoiding a second fade-in. [useLiquidDock](../src/hooks/useLiquidDock.tsx) saves the underlying collapse target and actual progress, restoring geometry when returning to the same underlying page while clearing old native input ownership. Owner checks prevent an old player's cleanup or delayed callbacks from resetting a newer player.

### Tab dispatch and lens overflow

Navigation gating in [GlobalTabBar](../src/components/GlobalTabBar.tsx) follows the `compact` target instead of waiting for spring progress to reach exactly zero. With a collapse target, the first tap still expands the dock. Once the target is expanded and the row is interactive, [tabNavigation](../src/lib/tabNavigation.ts) dispatches navigation promptly. Existing hit eligibility, drag ownership and selection transactions remain in place.

The native selected lens needs drawing space beyond the bar height. The inner [PlayerDockUnderlay](../src/components/PlayerDockUnderlay.tsx) container provides `resonus-dock-selection-host`. [AmPlusSelectionOverlay](../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/AmPlusSelectionOverlay.kt) finds its own marked host along the control's ancestor chain rather than attaching outside the application window. JS bar ancestors allow overflow; the full-screen reveal container still enforces the actual player boundary. At rest and after dismissal, that boundary is the viewport, not the bar height.

This changes drawing/capture capacity without enlarging logical tab hit areas or changing upstream deformation, springs or velocity parameters. See [LiquidBottomTabsMaterial](../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/LiquidBottomTabsMaterial.kt), [AmPlusMaterialCapacity](../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/AmPlusMaterialCapacity.kt) and the [liquid-glass module notes](../modules/liquid-glass/README.md) for native implementation and provenance.

### Validation record

Source regression entry points include [menu request transactions](../test/menuRequest.test.ts), [font import feedback](../test/fontImportDialog.test.ts), [PlayerDockUnderlay](../test/playerDockUnderlay.test.ts), [player header gestures and dismissal](../test/amllPlayerHeaderGesture.test.ts), [background UI lifecycle](../test/backgroundUiLifecycle.test.ts) and [tab navigation](../test/globalTabBarNavigation.test.ts). They check callback ordering, ownership and state handoff; they do not replace native rendering checks.

Pending for `.12`: light/dark materials, menu changes and asynchronous dismissal, short-screen keyboard access, drag cancellation/commit, Back/button dismissal, folded-dock restoration, timely tab response and lens overflow at the player clip boundary. Earlier `.10`/`.11` installations did not validate every entry. Record actual `.12` device results after testing; source tests do not establish a frame-rate guarantee.
