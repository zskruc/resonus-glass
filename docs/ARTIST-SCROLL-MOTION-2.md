# 艺人页上滑运动修正 / Artist scroll motion correction

原始验证版为本地 `0.8.5.1-motion.2` / Android `versionCode 130`，2026-11-01，继承本地 Screen Transitions／Gorhom 实验。正式候选 `v0.8.5.1` / `versionCode 132` 从公开 `.preview.6` 单独移植本页的上滑修复，并补充原生遮罩脱离窗口时的位图释放；不包含那两项转场／面板实验。下文 1,003 项测试、实机片段和 APK 校验值仅记录原始验证包，不能代替正式包的构建和实机验收；正式分支当前 987 项测试、类型与翻译检查通过。最终构建与本轮性能记录见[正式版说明](./RELEASE-0.8.5.1.md)。

The original motion.2 experiment used code 130 and included the separate transition/sheet experiment. Stable 0.8.5.1/code 131 selectively ports this scroll correction onto preview.6 and adds native mask cleanup on detachment. The 1,003-test count, APK hash and short device checks below belong to the original experimental package; they do not validate the stable build. The stable branch's 987 tests, type and translation checks pass; its build and device results are tracked separately in the [release notes](./RELEASE-0.8.5.1.md).

## 证据与问题 / Evidence

同一三星上保存的 Apple Music 参考：许嵩内容上移 500px，三个面部 ROI 均上移 200px；林子祥内容上移 724px，面部约 288px（有模糊，近似）。这支持可见区图片约以内容 0.4 倍速度移动；静态序列不足以推断 Apple 内部时间曲线或模糊算法。参考及测量仅保留本地，不上传用户截图。

旧实现已由 ScrollView 向上移动 `-scrollY`，又额外 `-scrollY/3`，净速度 1.33 倍，方向与参考相反。只改符号会让固定外框截断尚未淡尽的场，列表回收也可能提前移除整个背景。

Saved same-device reference frames measure a 0.4× photo/content displacement ratio. The previous negative extra parallax produced 1.33× movement. These frames do not reveal Apple’s internal animation timing or shader implementation.

## 修改 / Changes

- 可见区采用 `+0.6×scroll` 补偿，世界坐标净移动 `-0.4×scroll`。只有整幅画面完全离屏后才限制补偿，避免可见区突变。
- 完整照片、原静态渐变模糊场和共同遮罩移到列表／ScrollView 外的持久场景层。只移动完成的面片，不在一个固定窄框内移动像素，也不随列表 Header 回收而消失。
- 艺人页及使用艺人页布局的专辑／歌单共用；Spotify 原照片运动、Volta／Minidisc旧专辑排版不变。歌单搜索展开的基准位移继续由原搜索高度驱动。
- 导航小副本复用同一世界位移和裁切，仍仅用预备好的本地源、≤240 物理像素缓存及渐隐边缘。
- 大名字／官方名字图按实测底边经过导航区域时交接，28–64dp 平滑范围，没有原先4dp空白段，两个可读态不重叠。
- 没有新增滚动时的图片请求、取色、模糊生成或 React 状态写入；保留已准备的静态场、取色、图片比例、播放器与玻璃参数。

The complete cached artwork plane now lives outside scrolling/recycled headers and moves at the measured slower ratio. The same-source navigation copy stays aligned. Name handoff follows actual visual bottom bounds with a broader continuous fade. Existing artwork, material parameters and precomputed fields remain, with UI-thread transforms only during scrolling.

## 原始实验包验证 / Original experimental-build validation

1003 项测试通过，含实测位移、标题与名字图交接、远距离滚动、主图／导航副本同源与静态遮罩、持久面片归属、长歌单 recycler／选中／多碟／重复索引保持；类型、翻译与本轮代码定向 ESLint 均通过。不是 Apple 内部动效的逐帧复刻或持续帧率验收。

All 1003 tests pass, alongside type, translation and focused lint checks. New behavior tests verify reference displacements, title/wordmark handoff, scene ownership, static image requests and preserved list identity. This is an approximation based on the available reference, not a frame-identical Apple implementation.

最终修正版 APK：`artifacts/Resonus-Glass-v0.8.5.1-motion.2-arm64-v8a.apk`，46,631,140 bytes，SHA-256 `6c2f41474e92129917bf65a19faa84807046d511c5848c9542b6f6fab73ab833`。保持原包名与签名，已覆盖安装三星。

首个本地包在进入艺人页时触发 `undefined is not a function`：Worklets 生产转换先捕获了后声明的 helper，实际 closure 为 undefined。修复仅调整无依赖函数的声明顺序；新增真实 Worklets 与 Expo production preset 转换／UI 反序列化回归，不依靠 TypeScript mock 的函数提升掩盖该错误。初包已被修正版替换，不作为交付产物。

三星陈奕迅页实际截图：名字与播放按钮上移520px，三个面部 ROI 均上移208px，RGB 差均为0，验证0.4×位移。顶部／中段／收起／回到顶部检查未再报错；新进程日志中未见该 TypeError、fatal、OOM、ANR 标记。原30秒息屏与关闭充电常亮已恢复。这是该轮短时检查，不代表完整Apple曲线或持续帧率验收。

The final corrected APK has been installed with the existing package/signature. The initial local build exposed a worklet dependency initialization-order error; it was replaced after a minimal declaration-order correction and real production-transform regression coverage. Samsung screenshots measure520px content/208px photo displacement with zero RGB difference across three face regions. Top/middle/collapsed/return checks show no repeated error; original timeout/wake settings are restored. This is scoped device validation, not a full timing/frame-rate equivalence claim.

后续用户报告长时间使用后的严重卡顿。以上短时外观与打开检查不覆盖该问题；正式版补充资源生命周期修正及独立性能复测，不能据旧片段宣称长期流畅。

A later user report identified severe jank after longer use. The short appearance/opening checks above do not cover that case. The stable build adds resource-lifecycle changes and a separate performance retest rather than treating these earlier frames as evidence of long-session smoothness.
