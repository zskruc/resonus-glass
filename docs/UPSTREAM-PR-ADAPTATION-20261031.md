# Upstream PR adaptation / 上游 PR 适配

Target preview: `0.8.4.1-amll.34`, Android version code `117`.

`.32` / 115 was built and installed as an intermediate preview before the
additional artist-name artwork and Ayano Tsuji refinement requests.

These are selective source adaptations to the existing Resonus Glass branch,
not wholesale replacements of upstream screens. Existing uncommitted Volta
work, the player layout, LNPopup presentation and glass settings are retained.

| PR | Pinned source commit | Scope |
| --- | --- | --- |
| [#304](https://github.com/juananzzz/resonus/pull/304) | `8f3a6957da0e3d89e24ad7af7418f96c56e14398` | History dates use the selected app locale. |
| [#302](https://github.com/juananzzz/resonus/pull/302) | `1215e7429f68f8cae92ad5530900eb1fc1543a56` | Both cover URL backends default to the existing `COVER.card` size. Explicit thumb/full requests keep their sizes. |
| [#301](https://github.com/juananzzz/resonus/pull/301) | `8db70c54185a1a60816616cf05b0c23739f98fbf` | Prioritize source loading over optional warming; limit background cover/warm work and invalidate obsolete work. The upstream draft needs additional race fixes in this fork. |
| [#299](https://github.com/juananzzz/resonus/pull/299) | `7b4ec08fa866be17dc17104df27e098ae97f9724` | Long-press the favorite button in Mini Player, AMLL or legacy player to open the existing playlist picker. Ordinary taps and list-row gestures keep their behavior. |

## 中文

- 历史日期按所选语言显示；封面默认尺寸统一到已有的卡片尺寸。
- #301 在等候资源后重新检查离线、资料及队列归属；加载与预热必须各自保留所有权，旧任务不得释放新任务或覆盖新队列。
- 共享限制只覆盖后台镜像封面和可选流预热。原生音频、图片及其他客户端仍有各自的连接调度，不能据此宣称整个 App 永远有一个空闲连接。
- #299 复用现有加入歌单窗口；仅播放器收藏按钮启用长按，电台和播客不提供此操作，列表选择手势不变。
- 专辑页另加入 [Minidisc](https://github.com/Loriage/Minidisc) 样式，可在外观设置中与 Volta 切换。默认 Volta，仅在 Apple Music 界面风格下生效；Spotify 专辑页保留原布局。来源及许可见第三方声明。

自动检查：732 项应用测试通过，类型及翻译检查通过；ArtistArtworkMath V3 的 14 项原生像素／曲线／指纹测试通过，静态检查 0 错误、119 条警告。新播放请求测试另经独立只读复核。构建成功，原包名与签名核验通过；本版本实机结果另记。

APK：`artifacts/Resonus-Glass-v0.8.4.1-amll.34-arm64-v8a.apk`，45,289,388 字节，
SHA-256 `3143a5a119b0a9f5db927aa4532e49b2111034b2353534d2f2c68848bc2b3908`。

实机状态：`.33` / 116 已覆盖安装并在三星检查四位艺人。Taylor 官方银纹名字图正常显示；Taylor、陈奕迅、Ayano 的正文底色与参考一致，林子祥各通道相差 1。Ayano 的照片尺寸与边缘渐隐已对齐，但中央琴弦／衣服细节仍过早模糊。Volta／Minidisc 专辑切换与 mini player 长按收藏打开歌单均通过实际操作，未加入歌曲或改变收藏，专辑样式已恢复 Volta。

`.34` 只修上述剩余的细节交接：清晰层从 `0.55W` 到 `0.85W` 过渡；模糊从 `0.62W` 到 `1.35W` 增加。离线以真实生产像素算法比较 8／10／12／18px 最大 sigma，8px 的参考误差最小，故选用 8px。颜色、照片几何、最终淡出、艺术字、播放器与玻璃参数都不变；原生缓存版本为 V4，指纹算法不变。14 项原生测试通过，实际最终显示仍需 `.34` 安装后复核。

`.34` / 117 已按原包名与签名覆盖安装，未清理资料、缓存或下载。安装后手机锁屏，最后一轮实机画面尚待用户解锁复核；临时显示设置已恢复原来的 30 秒息屏和关闭充电常亮，没有更改夜间模式。不要把 `.33` 的实机截图或 V4 的离线合成标成 `.34` 已完成视觉验收。

最终补充：用户再次解锁后，先显式唤醒屏幕并同时确认 Awake／Keyguard 关闭，成功取得 `.34` 的 Ayano 顶部、滚动中段及 Taylor 顶部有效截图。官方名字图正常；Ayano／Taylor 正文底色分别为 `#717062`／`#070706`，与参考一致。Ayano 人物比例及统一渐隐保持正确，琴头、手部、琴身的参考像素误差相比 `.33` 分别从 4.95→3.39、7.68→3.82、12.15→3.12，细节明显恢复；中段未见硬边、错色或跳图。局部细节仍比原生参考稍柔和，不宣称逐像素或全 App 长时帧率一致。此次流程自动恢复 30 秒息屏与关闭充电常亮。有效证据保存在忽略的本地 `device34-20261031` 目录；此前黑图继续保留为失败采集记录，不作为通过依据。

补充采集：用户回复解锁后取得的 `.34` 三张 PNG 均为纯黑，已拒绝作为验收证据；当前进程崩溃缓冲为空，不能据此判断 App 黑屏或崩溃。后续同时等待屏幕 Awake、Keyguard 关闭及无锁屏超时覆盖的流程，在 150 秒内未检测到可采集状态并退出；finally 已恢复原显示设置。最终照片细节仍未完成实机验收。

艺人图片恢复后，保存了三星 Apple Music 与旧预览同照片的对照。边缘正文底色实测：陈奕迅参考 `#0a0a08`、旧预览 `#6d6e6c`；林子祥参考 `#67686c`、旧预览 `#847165`。根因是旧预览优先采用照片下方的白毛衣／棕衣颜色。新实现从未裁切原图的上方两角作有界网格采样及中位数统计，背景与衣服延伸分离；公开 Apple 元数据仍只接受同一图片资产的精确匹配，离线时无需它也可取色。对极暗照片保留原色，明亮背景连续调整 RGB 对比度，不在阈值处突然减半。原图生产采样与配色测试距离上述参考各通道不超过 6，但这不等于整张页面像素一致。

`.33` 按 Ayano Tsuji 的原图／截图配准修正：照片按屏宽正方形展示，消除此前约 12.5% 的额外放大；标题与按钮的布局高度保留。背景独立延伸到约 `1.35W`，从约 `0.52W` 开始单次线性渐隐，避免 PNG 与清晰层重复抬高透明度。取色改为对 RGB 三通道减去同一亮度偏移，保留素色照片的橄榄色等通道差值；Ayano、许嵩、林子祥、刀郎、陈奕迅的参考共用同一规则。

原生色场仍只准备一次，工作宽度最多 240 像素、解码最长边最多 480；没有引入全屏实时模糊或滚动时重新取色。V3 PNG 只负责渐进模糊，最终渐隐由外层唯一遮罩负责。缓存版本更新为 3，防止复用旧渐变。

官方艺人名字图只读取经核验的 Apple ArtistDetailHeader.artistLogo，保留原 PNG 颜色、纹理和透明度，无官方图或缺少可用本地字节时保留普通文字。照片 URL 已被服务器隐藏时，名字只用来发现候选；当前照片与官方候选必须先通过有界的 16×16 原图内容指纹核验，再接受艺人身份及名字图。候选核验最多三张、总预算有限，离线不会启动候选下载；原始照片不上传给第三方。标题保留原文字的量测／无障碍信息，图片向上扩展，不下推按钮。公开名字图元数据和图片均有缓存，未把 Apple 资源打入 APK。艺人图片曾失效的缺图画面不视为视觉验收通过。

## English

The history locale and default cover tier are small backend-independent fixes.
The #301 adaptation additionally guards ownership across rapid playback
changes, queued work and offline/profile changes. Its shared background budget
does not replace the independent native network dispatchers. Preloading remains
optional and off by default.

The #299 action is opt-in for player favorite controls, including the custom
AMLL player. It opens the existing picker without toggling the favorite or
changing layouts. Stations and podcasts are excluded.

Album presentation can separately select Volta or Minidisc within Apple Music
style, retaining Volta as the default and keeping Spotify pages unchanged.
Player layout, stored glass parameters and user downloads are retained.

Validation: 732 app tests, typechecking, translations and 14 native artist
pixel/curve/fingerprint tests pass; lint reports zero errors and 119 warnings. Samsung
references exposed clothing-contaminated body colors in the previous preview.
The new bounded corner sampler and continuous RGB treatment separate the scene
background from the clothing extension. Production-image samples compare within
6 RGB channel values of the measured two-artist body references. This does not
establish pixel-identical layouts or sustained frame rates. The ARM64 APK built
successfully with the existing package and signing certificate; device acceptance
is recorded separately.
