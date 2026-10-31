# 非播放器交互动效调研 / Navigation and panel motion options

2026-11-01。当前为调研建议，本轮没有引入动效依赖，也未替换 Mini Player 动效。

## 当前表现的来源 / Current behavior

本地 `src/app/_layout.tsx` 普通详情页使用 `fade`，Android 设置页 `none`；`src/hooks/useBottomSheetAnim.ts` 的玻璃卡片使用固定 180／120 ms timing，缩放 .96→1 配合少量位移，缺少入口到内容的连续空间关系。下载／图片准备造成的等待需要另外处理，换曲线不能消除数据加载。

Detail routes currently fade, Android settings disable transitions, and floating cards use short fixed timing. This gives limited spatial continuity. Animation changes cannot remove actual data/image loading delays.

## 候选 / Candidates

| 优先级 | 开源项目与来源 | 可改善的场景 | 本项目适配判断 |
| --- | --- | --- | --- |
| 1 | [React Navigation Native Stack](https://reactnavigation.org/docs/native-stack-navigator/) | 歌单、专辑、艺人页进入与返回采用有方向的推进 | 项目已有 Expo Router / Screens，低成本，无需加库；`slide_from_right` 已在本地类型中。Android 使用其原生 Fragment 过渡；iOS 专属手势参数不能直接类推 Android。 |
| 1 | [Reanimated](https://github.com/software-mansion/react-native-reanimated)，[弹簧文档](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/) | 右侧玻璃菜单从按钮位置展开、回收，遮罩同步，按压反馈 | 已有 4.5.1；中低成本。保留玻璃组件，只统一可中断、可反向的位移／缩放／透明度进度，避免动画结束后才换内容。 |
| 2 | [react-native-screen-transitions](https://github.com/eds2002/react-native-screen-transitions)，[React Navigation 官方示范](https://reactnavigation.org/blog/2026/04/27/building-custom-screen-transitions/) | 歌单／专辑封面连续放大成详情，反向缩回；zoom、bounds、手势返回 | 效果最贴近入口连贯展开，成本中高。[Expo Router 集成仍为 Alpha](https://screen-transitions.esjr.org/expo-router/)，需验证 Expo 57 内置导航上下文；其原生适配也改变透明 modal／动画所有权，应先单页隔离试验。 |
| 2 | [Gorhom Bottom Sheet](https://github.com/gorhom/react-native-bottom-sheet)，[自定义背景](https://gorhom.dev/react-native-bottom-sheet/custom-background) | 队列、下载管理、选择歌单等大型可拖动面板，停靠、回弹、键盘配合 | 成本中。支持 Android/Expo/列表协同，可对接自定义玻璃背景，仍须验证现有玻璃采样、FlashList 与行横滑手势；不直接替代右侧锚定菜单。 |
| 3 | [TrueSheet](https://github.com/lodev09/react-native-true-sheet)，[平台背景差异](https://sheet.lodev09.com/guides/backgrounds) | 原生底部面板，多段停靠与键盘避让 | 成本中高。Apple Liquid Glass 为 iOS 能力，Android 默认为 Material，需要另接本项目玻璃；对当前目标不比 Gorhom 明显占优。 |

公开规模参考（读取时约数，非实测评分）：React Navigation 24.5k、Reanimated 11k、RN Screen Transitions 1.7k、Gorhom Bottom Sheet 9.1k、TrueSheet 2.1k GitHub stars。以上均为 MIT；实际集成需保留许可与归属。社区规模不能保证本项目帧率。

The candidate projects use MIT licensing. Repository stars are approximate community-size indicators rather than performance ratings. Android gesture ownership and the existing glass capture lifecycle require device validation.

## 推荐顺序 / Suggested order

先用已安装的原生导航处理有方向的详情页过渡，现有 Reanimated 处理菜单和卡片。希望点击封面连续展开时，单独试 RN Screen Transitions；多段拖动面板再考虑 Gorhom。不要一次替换全局导航、玻璃背景和滚动宿主。

Start with the installed native navigation and Reanimated for page/panel continuity. Evaluate Screen Transitions in one isolated cover-to-detail flow; consider Gorhom separately for draggable sheets.

[LNPopupUI](https://github.com/LeoNatan/LNPopupUI) 与 [Primuse](https://github.com/chenqi92/primuse) 面向 Apple 原生平台，适合学习交互，不可直接作为 RN Android 动画依赖。Reanimated 自带 [Shared Element Transitions](https://docs.swmansion.com/react-native-reanimated/docs/api/sharedElementTransitions/) 仍属实验功能，不作为稳定全局迁移依据。
