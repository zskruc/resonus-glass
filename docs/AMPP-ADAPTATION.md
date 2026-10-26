# AM++ 参考与适配 / AM++ reference and adaptation

## 来源 / Sources

- 参考仓库：[Kifranei/AM-plus-plus](https://github.com/Kifranei/AM-plus-plus)，本轮核对提交 [`97fa2e4efc9ec7476daca383221f55b5d10f847c`](https://github.com/Kifranei/AM-plus-plus/tree/97fa2e4efc9ec7476daca383221f55b5d10f847c)。
- 玻璃部分继续以 [AndroidLiquidGlass / Backdrop 2.0.1](https://github.com/Kyant0/AndroidLiquidGlass/tree/65ab177e90e5c1d8c62e70cf7755841982da65f6) 为来源；AM++ 的参数和宿主适配是另一层，不等于 Apple 的内部实现。
- 用户提供的[小红书笔记](https://xhslink.cn/o/39iP9z7oZFo)为 Kifranei 的《让Android版AppleMusic更iOS化》，笔记 ID `6ad2c6f00000000018011ee6`。普通网页请求曾进入登录页，随后通过浏览器读到公开正文，并核对了图1与图5：图1包含浮动音质卡片和右侧玻璃更多菜单，图5列出媒体增强插件的功能；其他图片尚未逐一核对。
- 帖子明确将图1–4介绍为[媒体增强插件](https://github.com/Kifranei/AM-plus-plus-media-plugin)预览，并另列[莫奈封面取色插件](https://github.com/Kifranei/AM-plus-plus-monet-plugin)。本轮源码核对分别固定于 [`b9e043c10ee8bdba62f155acba296be566b9b71d`](https://github.com/Kifranei/AM-plus-plus-media-plugin/tree/b9e043c10ee8bdba62f155acba296be566b9b71d) 与 [`0408c9f9dc7d6f4f893e22f847f60dc443cf9f70`](https://github.com/Kifranei/AM-plus-plus-monet-plugin/tree/0408c9f9dc7d6f4f893e22f847f60dc443cf9f70)。作者评论提及的版本与本次读取的主分支快照分开记录，不视为同一份产物。

The reviewed AM++ and two companion-plugin snapshots are pinned above. The public Xiaohongshu post was read in the browser after an initial HTTP login redirect. Images1 and5 were inspected; the remaining images were not individually verified. The post identifies images1–4 as media-plugin previews and links a separate Monet color plugin. A version named in a post/comment is not assumed to match the current repository snapshot.

## 帖子中的三个项目 / The three projects in the post

| 项目 | 对应范围 | 本轮关系 |
| --- | --- | --- |
| AM++ 主项目 | mini player、底部导航、收缩联动，以及歌词和宿主接入等 | 本轮 dock 参考来源 |
| 媒体增强插件 | 播放页玻璃弹窗/更多菜单、系统音频输出入口、设备名、音量条、系统圆角、把手、图片分享和内容导出 | 本轮仅审查候选，未随 dock 预览移植 |
| 莫奈取色插件 | 从专辑封面提取主题色，选择只影响播放页或整个 App | 独立的颜色方案；不是底栏折射实现 |

The main AM++ project supplies the dock reference. The media plugin adds player dialogs, output controls and sharing/export features. Monet supplies cover-derived color roles. Adapting one of these does not implicitly include the other two.

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

## 媒体增强与取色插件候选 / Companion-plugin candidates

以下依据图1、图5、两个插件 README 和相应源码，均未包含在本轮 dock 与设置滚动修复内。

| 候选 | 适配到 Resonus 的方式 | 优先级 |
| --- | --- | --- |
| 三种播放弹窗玻璃外观 | Resonus 已有浮动菜单、睡眠定时、删除确认与歌曲信息等基础，可按媒体插件的对应材质增加可选预设，统一圆角、按钮和文字层级。要继续复用共享采样，不能另加逐弹窗全屏捕获。 | 高：与现有界面最贴近 |
| 输出设备图标与名称 | 保留现有本机/服务器/投放功能，另用 Android 的真实媒体路由信息识别当前有线耳机、蓝牙耳机或音响，显示名称并尝试系统音频输出面板；具体厂商可用性需实机验证。 | 高：界面与功能都实用 |
| 播放页系统音量条 | 可另做与硬件音量键同步的系统媒体音量条；必须区分本机系统音量、App 内音量和远程投放音量，避免互相覆盖。 | 中高 |
| 统一把手与系统顶部圆角 | 按全屏播放器展开进度显示把手，按 Android 圆角能力裁切；需要和 Resonus 现有上拉/下拉过渡一起适配。 | 中 |
| 歌曲/歌词图片卡片 | 使用 Resonus 自己的数据、封面和标识生成图片，通过系统面板分享或保存。Apple Music 的原生卡片生成器和标志不能直接接入。 | 中，独立功能 |
| 莫奈封面主题 | 已有封面主色背景，可增加可选的 Oklab 取色与亮/暗主题角色，后台缩图、缓存、去重，换歌稳定后更新。默认不把它强加到 mini player 或已有玻璃参数上。 | 可选：先保证文字对比度与滚动性能 |
| 词幕集成与内容导出 | 词幕需要接入其提供者接口；静态封面、歌词与介绍可从已有数据导出，动态 MP4/原始 TTML 只有数据源实际提供才可保存，不能由自托管来源凭空补齐。 | 后续独立功能 |

媒体插件的三种预设并非单一“无模糊”开关。读取的源码中，同底栏为4dp模糊、随尺寸限制的24dp边缘透镜与深灰40%填色；同更多菜单为20dp模糊、10/16透镜与中性灰填色；名为“无磨砂（早期效果）”的预设仍使用20dp模糊和20/32透镜，只是不加着色面。菜单的明暗配色和边缘实现还需分别对应，不能仅按选项名称推断参数。

For Resonus, the closest next steps are optional player-dialog recipes and a real output-device label/system picker. A hardware-synchronized volume bar and shareable song/lyric image cards require separate integration. Monet's background24×24 sampling, caching, Oklab palette roles and contrast checks are useful references, but its Apple Music resource hooks are not needed in Resonus. The preset named “No frost” still applies20dp blur in the reviewed source; it means an untinted surface, not zero blur. None of these companion-plugin features is implemented by this dock preview.

## 许可证与资源 / Licenses and assets

AM++ 主项目采用 GPL-3.0；Kyant 的 Backdrop/示例采用 Apache-2.0。移植的具体文件须保留来源、许可证及修改记录，不能只依据主项目许可证判断所有子目录。AM++ 的第三方声明还列有 MIT 歌词模糊、GPL 的歌词修正、AGPL 的部分平板参考以及不属于 GPL 的 Apple 图像。未采用的代码与图像不应整包复制；若采用额外来源，应按对应条款单独核对和声明。

AM++'s main project is GPL-3.0; Kyant's Backdrop and catalog components are Apache-2.0. Preserve provenance and notices for the actual files adapted. AM++ also documents MIT lyric-blur code, GPL lyric fixes, AGPL tablet references and Apple images outside the GPL grant. Do not copy whole resource trees under the assumption that one project license covers every asset.

媒体增强与莫奈插件主代码均声明 GPL-3.0。媒体插件另列 Apache-2.0 的 Kyant/LyricProvider/DexKit，以及来源单独记录的图标和 Apple 扬声器/AirPods 图片；本轮未复制这些资源。莫奈插件将 Oklab 转换归于 Björn Ottosson 的公有领域参考，不包含 Apple Music 代码或素材。后续实际选取代码时，应保留对应提交和第三方声明，而不是将插件 ZIP 直接嵌入 App。

Both companion plugins declare GPL-3.0 for their main code. The media plugin separately records Apache dependencies and icon/image sources; its Apple output-device images were not copied. Monet credits the public-domain Oklab reference and states that it includes no Apple Music code or assets. Any later adaptation must preserve the notices for the files actually used.

参考：[AM++ 第三方声明](https://github.com/Kifranei/AM-plus-plus/blob/97fa2e4efc9ec7476daca383221f55b5d10f847c/THIRD_PARTY_NOTICES.md)、[功能范围与验收矩阵](https://github.com/Kifranei/AM-plus-plus/blob/97fa2e4efc9ec7476daca383221f55b5d10f847c/docs/feature-preservation.md)。

## 本轮预览 / This preview

`0.8.4.1-ampp.5` / Android versionCode `78`，源码分支 `preview/ampp-dock`。

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

## 媒体增强测试版 / Media companion preview

`0.8.4.1-ampp.6` / Android versionCode `79`, branch `preview/ampp-player-features`.
上文“本轮预览”记录的是 dock 版78；本节才是后续实际接入的媒体增强范围。

- 共享浮动卡片加入「与底栏一致／与更多菜单一致／无着色玻璃／之前的外观」选择。默认与底栏一致，设置独立保存，不覆盖 dock 或自定义参数。更多菜单保留自己的中性玻璃材料；之前的外观恢复旧的处理。明亮主题适配浅色填充和深色文字。
- 点击播放页音质标签可打开详情卡片，再进入歌曲信息或音质设置。沿用真实下载/缓存/在线播放选择逻辑；显示的是音源与请求参数，不声称测量耳机 DAC 或最终蓝牙编码。
- 播放器显示实际系统媒体输出名称；设备卡片内另有系统输出入口，原有本机、Jukebox、UPnP/Sonos 选择继续可用。Android34+尝试公开输出面板；厂商不支持时明确提示并回退系统音量面板。
- 本机音量条与系统媒体音量、硬件键同步，投放时只调用已有远程音量接口。观察为事件驱动，隐藏/后台停止，换设备取消旧拖动；写入前再次核对设备ID和硬件范围。没有启动时写音量，也没有新增蓝牙权限、后台轮询或屏幕捕获。
- 可选封面配色仅用于完整播放器，默认关闭。复用现有封面取色，Oklab角色和对比度保护、64项缓存、900ms稳定等待和380ms背景渐变；主题变化直接切换背景以保护文字对比度。没有另加封面下载，也不是原始24×24像素量化器的完整移植。

This later preview implements the listed companion features, while retaining
the dock preview's existing rendering and lifecycle fixes. The glass choice
applies to shared floating cards, not only the player. System output controls
use public platform APIs with an explicitly reported volume-panel fallback.
The volume row separates local STREAM_MUSIC from existing remote volume APIs.
The optional full-player palette reuses existing extraction and never mutates
the mini player, tabs or global theme. No sharing/export/Cimu/TTML/tablet features
are included. Build and on-device validation are recorded for the actual APK;
these features do not establish constant120FPS across all workloads.

## 按钮外观回滚 / Button appearance rollback

`0.8.4.1-ampp.7` / Android versionCode `80` 将普通操作按钮恢复为 catalog
按钮接入前的原始 Pressable 外观：保留调用方的形状、填色、图标、按压样式与
点击语义，取消附加的玻璃胶囊、高光及拉伸位移。GlassPressable API 保持兼容。
LiquidToggle、LiquidSlider 及慢拖修复、静态卡片优化、120Hz 窗口策略、绘制通知
合批、AM++ mini player/tab、媒体增强和浮动弹窗材料均保留。

This revision restores the pre-catalog action-button presentation without
rolling back the switches, sliders, dock, popup recipes, media controls or
refresh/rendering fixes. The mini player's separate AM++ material and motion
remain intact; shared button-motion math is still used there.

同一修订还将播放页和歌词页的进度条、播放页音量条的已填充轨道改为封面
Oklab强调色，独立于可选的全屏背景配色。中性色/缺失封面使用可读的中性色
回退，不强制蓝色；原生轨道以380ms过渡。白色玻璃滑块、轨道几何、慢拖
逻辑和设置页默认蓝色保持原样。播放器与歌词并发取色共享已有提取请求。

Playback progress and volume fills follow the artwork accent even when the
optional background palette is Off. Neutral/missing artwork uses a neutral
fallback. Native fill transitions take380ms, while glass thumbs, gesture
behavior and catalog-blue settings sliders retain their existing implementation.

## 即时轨道颜色 / Immediate track color

`0.8.4.1-ampp.8` / Android versionCode `81` 取消播放轨道380ms颜色渐变。
当前歌曲缓存命中时，进度条和音量条随歌曲属性直接更新。前台以串行且可替换
的待办列表预取当前、实际下一首、上一首的小封面颜色，最多三张，重复封面
去重；队列、账户、离线及前后台变化会停止后续旧任务，没有轮询或整队列下载。
图片解码由原生库后台执行，继续使用原有取色结果和可读强调色。

The track tint now applies without interpolation. A bounded foreground-only
warmup shares the exact synchronous palette cache for the current/next/previous
artwork. Uncached artwork still depends on image availability: the tracks use a
neutral fallback immediately, then apply the actual color once available. The
optional full-player background palette timing and slider gestures are unchanged.

## 即时播放按钮颜色 / Immediate play-button color

`0.8.4.1-ampp.9` / Android versionCode `82` 将播放／暂停按钮的填色和配套
图标色改为直接使用当前封面的控制颜色。启用可选封面配色时，按钮与进度条、
音量条使用同一份同步颜色结果，不再等待背景配色的900ms稳定门槛。背景与
文字角色的过渡、配色开关关闭时的中性按钮、播放／暂停音频逻辑均保持原样。

The optional artwork-colored play/pause button consumes the current control
palette's accent and matched onAccent immediately, alongside both playback
tracks. The delayed background palette and audio play/pause behavior are unchanged.
