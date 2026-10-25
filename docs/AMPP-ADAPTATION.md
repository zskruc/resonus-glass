# AM++ 参考与适配 / AM++ reference and adaptation

## 来源 / Sources

- 参考仓库：[Kifranei/AM-plus-plus](https://github.com/Kifranei/AM-plus-plus)，本轮核对提交 [`97fa2e4efc9ec7476daca383221f55b5d10f847c`](https://github.com/Kifranei/AM-plus-plus/tree/97fa2e4efc9ec7476daca383221f55b5d10f847c)。
- 玻璃部分继续以 [AndroidLiquidGlass / Backdrop 2.0.1](https://github.com/Kyant0/AndroidLiquidGlass/tree/65ab177e90e5c1d8c62e70cf7755841982da65f6) 为来源；AM++ 的参数和宿主适配是另一层，不等于 Apple 的内部实现。
- 用户提供的[小红书短链](https://xhslink.cn/o/39iP9z7oZFo)指向笔记 `6ad2c6f00000000018011ee6`。公开访问最终进入登录页，本轮未取得帖子正文或视频；下面的判断依据仓库可读源码与说明，不能声称已核对视频中的全部细节。

The reviewed AM++ snapshot is pinned above. Its glass layer builds on the same Kyant reference, with additional host integration and layout rules. The supplied Xiaohongshu link redirects to a login page; its post/video was not available through public access. The findings here therefore describe the repository, not an inspection of that video.

## 接入边界 / Integration boundary

AM++ 是 Apple Music 的 Xposed 增强模块。Resonus Glass 拥有自己的播放器、导航和数据源，因此应适配布局、动画与渲染代码；Apple Music 的反射入口、宿主版本档案和 Xposed 注入不能直接作为本 App 的依赖。已有登录、播放队列、下载、歌曲导航和无障碍行为继续由 Resonus 实现。

AM++ is an Xposed enhancement module for Apple Music. Resonus can adapt rendering, geometry and motion, while keeping its own player, navigation and data model. Apple Music hooks and version-specific host contracts are not reusable drop-in dependencies.

本轮实施范围与验证结果由对应预览版本记录；以下候选不表示已经实现。

The preview's implementation and validation are recorded separately. The candidates below are not a list of completed features.

## 其他可考虑的功能 / Other candidates

| 候选 | Resonus 当前情况与适配方式 | 优先级 |
| --- | --- | --- |
| 歌词焦点模糊 | 已有「模糊非当前歌词」和浏览时暂停逻辑。AM++ 的前后方向半径、300ms 过渡与停止浏览后恢复可作为另一个预设；应复用现有歌词视图，先测可见行的渲染成本。 | 高：已有基础，适合单独对比 |
| 歌词专用字体 | 已有全 App 自定义字体、歌词大小与字重。可增加独立的歌词字体选择，复用本地导入能力，让界面和歌词分别设置；字体由用户导入，不随包复制第三方字体。 | 中高 |
| 宽屏播放器与歌词双栏 | 当前横屏为封面与控制区域并排。AM++ 的左侧封面加控制、右侧歌词是一种不同布局，可为平板/横屏单独适配，并保留窄屏和多窗口回退。 | 中：需重新布局及设备验收 |
| mini player 到全屏的连续变形 | 可把 mini 的矩形、圆角和封面位置作为展开动画起点。当前已有上拉展开，需要与路由、返回和歌词页共同实现共享过渡，不能只换玻璃参数。 | 中：先稳定底栏与触摸 |
| 本地 TTML 歌词与翻译管理 | AM++ 有导入、转换、备份和在线补全；Resonus 当前主要是本地/服务器歌词及 LRCLIB。需新增 TTML 解析、与本地/服务器歌曲的映射、逐字与多声部处理。Apple Music ID 不能自动对应自托管歌曲。 | 后续独立功能 |
| CJK 行尾逐字高亮 | AM++ 修正的是 Apple Music 原生 rush-gradient 的末字边缘。Resonus 用自己的 KaraokeWords，能借鉴行尾高亮的视觉目标，需要在自己的逐字渲染器里实现。 | 后续歌词优化 |
| 一级导航页预热 | 适合检查首次进入资料库时的等待。Resonus 已有页面保留/冻结，应按当前路由和数据加载方式重做，限制启动时的工作量；不是提高持续滚动帧率的通用办法。 | 低于稳定滚动和底栏 |

English overview:

- **High priority:** compare an additional lyric-focus blur preset using the existing lyric list and manual-browsing pause behavior.
- **Medium priority:** independent lyric fonts, a tablet/landscape player-and-lyrics layout, and a continuous mini-to-player transition.
- **Separate future work:** TTML import/translation/backups require a Resonus song mapping and parser; Apple Music IDs are not interchangeable with self-hosted song IDs.
- **Renderer-specific work:** CJK terminal highlighting must be adapted to Resonus's own word renderer rather than copying Apple Music hooks.
- **Lower priority:** selective navigation prewarming may improve first entry, but adds startup work and does not guarantee sustained frame rates.

## 许可证与资源 / Licenses and assets

AM++ 主项目采用 GPL-3.0；Kyant 的 Backdrop/示例采用 Apache-2.0。移植的具体文件须保留来源、许可证及修改记录，不能只依据主项目许可证判断所有子目录。AM++ 的第三方声明还列有 MIT 歌词模糊、GPL 的歌词修正、AGPL 的部分平板参考以及不属于 GPL 的 Apple 图像。未采用的代码与图像不应整包复制；若采用额外来源，应按对应条款单独核对和声明。

AM++'s main project is GPL-3.0; Kyant's Backdrop and catalog components are Apache-2.0. Preserve provenance and notices for the actual files adapted. AM++ also documents MIT lyric-blur code, GPL lyric fixes, AGPL tablet references and Apple images outside the GPL grant. Do not copy whole resource trees under the assumption that one project license covers every asset.

参考：[AM++ 第三方声明](https://github.com/Kifranei/AM-plus-plus/blob/97fa2e4efc9ec7476daca383221f55b5d10f847c/THIRD_PARTY_NOTICES.md)、[功能范围与验收矩阵](https://github.com/Kifranei/AM-plus-plus/blob/97fa2e4efc9ec7476daca383221f55b5d10f847c/docs/feature-preservation.md)。

## 本轮预览 / This preview

`0.8.4.1-ampp.4` / Android versionCode `77`，源码分支 `preview/ampp-dock`。

- 新增可切换的「AM++ 参考」外观；它只替换本轮 dock 的布局、材质与动画，其他控件保留 Kyant 默认材料。旧的 Kyant 默认、参考及自定义外观仍可选，原有参数不覆盖。
- 手机 nav56dp、mini43dp、边距16dp、间隔8dp、底部额外16dp；展开时搜索并入导航，折叠时在右侧独立出现，左侧保留当前页面图标。
- mini 与 tabs 使用主题40%填色、4dp背景模糊；mini/独立搜索使用随尺寸限制的边缘折射，tabs使用24/24镜片。mini 的主题填色不从封面取色。
- 同一弹簧进度驱动布局；折叠/展开阻尼比.70/.755、刚度250，侧按钮折叠回弹幅度35%、展开100%，mini额外下沉4dp。标签、折叠图标与独立搜索采用各自的显隐窗口。
- mini 按压保持前景与玻璃一起变形，指尖高光使用参考smoothstep falloff并剪裁在胶囊内；折叠后不保留隐形的选中折射层。
- 共享采样继续使用本 App 已有的 WindowBackdrop，不引入 Xposed，不完整复制 AM++ RenderNode 宿主；后者要求与所有玻璃消费者严格分离的源，不能直接套进当前 RN 界面树。没有升级现有Backdrop依赖。
- 保留原有滚动触发门槛、详情页联动、点击导航同步、上拉播放器、横滑切歌、长按停止和120Hz前台窗口请求。没有移植其他候选歌词/平板功能。

This optional phone-dock preview adapts the material, compact proportions, springs, content gates and clipped press light. Resonus retains its own playback, navigation, shared capture and refresh policy. Existing appearance modes remain selectable and custom parameters are not replaced. The listed lyric/tablet candidates are not implemented by this preview. Validation must be read as the measured preview's results, not a claim of pixel identity or constant120 FPS.

### 安全交互与设置页绘制 / Interaction and settings rendering

底栏正在折叠或展开时，点击导航会先展开；到达展开端点后才切换页面。AM++ 原版允许在部分过渡区间继续选择，本版为固定的RN文字层采用更严格门控，避免缩窄时重叠命中区误选其他tab。该差异不是像素级或行为完全一致的复制。

设置页普通卡片对已知纯色页面背景采用静态背景源，材质参数不变；模态菜单、输入、按钮、预览样本和浮动底栏继续使用真实背景。静止的白色开关/滑块采用等价的白色+原阴影路径，按压及动画时恢复完整玻璃，并清理过期拖动速度任务。实际收益由同页前后滚动记录验证。

During a dock morph, a navigation tap expands first; navigation resumes at the expanded endpoint. This stricter RN hit-test gate differs from AM++'s transition selection. Plain settings cards use an explicitly declared uniform source, while dialogs, samples and the dock retain real capture. Resting opaque thumbs retain their white surface and original shadow without recording hidden optical layers; active gestures still use the full material.

在静态、不透明、无景深及无色散的普通设置卡片上，Backdrop的Clamp blur和仅移动坐标的lens对平色源不改变色值；安全条件满足时省略这些无视觉贡献的运算，保留饱和度、形状、高光、阴影和填色。透明或动态来源、特殊padding、自定义和其他材质仍使用原链。

For eligible opaque uniform settings sources, Clamp blur and coordinate-only lens sampling leave the color unchanged. The native path omits those redundant operations while retaining vibrancy, shape, highlight, shadow and surface fill. Nonuniform, translucent, custom and special-padding cases keep the full path.

### AM++ 设置分组容器 / AM++ settings grouping

AM++ 参考模式下，设置分组背景采用纯色系统卡片，不再把非交互的大容器当作LiquidButton。开关、滑条、操作按钮、真实浮动菜单和底栏继续各自的玻璃材料。Kyant及其他比较模式保留原卡片材质和上述静态源优化。这个范围区别避免为整组几十行内容反复建立大型玻璃图层，布局、分隔线、描述和触摸行为不变。

In AM++ reference mode, noninteractive settings groups use plain system-style cards rather than stretching a LiquidButton material across a large container. Toggles, sliders, action buttons, floating menus and the dock retain their respective glass materials. Comparison modes retain their existing card materials with the static-source optimization.
