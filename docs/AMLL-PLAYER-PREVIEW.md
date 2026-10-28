# AMLL 播放器预览 / AMLL player preview

`0.8.4.1-amll.24` · Android `versionCode 107` · `preview/amll-player`

## 当前 `.24` / Current `.24`

保留 `.23` 的材质提交后刷新，并修复 Android 后台任务预览的播放器图层重叠。Android 进入后台时不再对整个 Stack 和全局浮层启用 Suspense 冻结，避免其隐藏过程运行播放器的布局清理、提前清除独立背景与封面转场状态。页面继续挂载，既有前台工作暂停与导航 `freezeOnBlur` 保留；iOS 与 Web 的原后台冻结行为不变。

`.24` retains the post-commit material refresh and addresses overlapping player layers in Android Recents. Android backgrounding no longer Suspense-freezes the entire Stack and global overlays: hiding that tree ran player layout cleanup and could clear its independent background/transition state before the task snapshot. Pages remain mounted; existing foreground-work suspension and navigation `freezeOnBlur` remain. iOS and Web retain their previous background-freezing behavior.

`.24` / `107` 已以原包名、原签名覆盖安装到三星，首次安装日期保持不变。588 项应用测试、145 项玻璃模块原生测试、类型及翻译检查通过。实机六轮诊断切换的 18 个宿主结果均在新组合后画出正确底色，未再出现断绘；关闭诊断并重启后，再做六轮静止折叠切换及展开深浅切换，外观均正确，主题诊断日志为零。三类已保存参数均为自动底色，其余光学数值与测试前逐项一致。

`.24` / `107` is installed on Samsung with the original package and certificate and unchanged first-install date. All 588 app tests, 145 glass-module native tests, typechecking and translation checks pass. Six traced theme switches produced 18 correct post-commit surface results. With tracing disabled and the process restarted, six more settled compact switches plus expanded dark/light switches retained the correct appearance, with zero theme diagnostic messages. All three saved profiles retain Automatic tint; every other optical value matches the pre-test device values.

在同一专辑来源上，歌词三轮、播放器两轮，以及专辑详情和设置各两轮，共九轮后台任务卡及返回检查通过：保留对应完整背景与布局，没有复现专辑列表透底或不同播放布局混层，返回保留原页面。检查范围为这些实机截图和返回状态，未覆盖全部弹窗、长期后台、系统杀进程恢复或逐帧过渡。测试后恢复原系统自动明暗、30 秒息屏、USB 常亮关闭及原日志属性，停在首页；截图和设备日志仅留本地。

Nine Recents-and-return checks pass: three lyric rounds, two player rounds, two album-detail rounds and two settings rounds. The album-origin lyric/player retained their complete background and layout, without the reported album-list bleed-through or mixed player modes; each returned to its original page. This accepts the captured device states, not every modal, long background sessions, process-death restoration or frame-by-frame transitions. Original system-auto appearance, 30-second timeout, disabled keep-awake and original logging property were restored, leaving Home visible. Screenshots and device logs remain local.

## `.23` 主题绘制时序 / `.23` theme draw ordering

`.23-diag.1` 的三星记录确认：八轮系统主题切换中，JavaScript 解析、原生颜色属性及新 Compose 状态均正确；异常轮次的最后一次实际玻璃绘制发生在新组合提交前，使用了上一主题的颜色，之后静止时没有新的正确绘制。对应背景颜色已经更新，问题不在参数保存或背景取色。

Samsung traces from `.23-diag.1` showed correct JavaScript resolution, native properties and new Compose state throughout eight system-theme changes. In failing rounds, the last real surface draw preceded the new composition commit and used the previous tint; the settled dock did not draw the new tint. The source background had already updated, separating this failure from persistence and backdrop-color selection.

`.23` 在成功组合提交后，按底色、浓度及明暗状态门控一个稳定的下一帧回调，刷新 Compose 宿主并通知共享材质更新。同帧的多次变化合批；相同状态不再申请帧，离开窗口时取消旧回调。模糊、折射、玻璃浓度及其他用户参数不变。

After a successful composition commit, `.23` gates one stable next-frame callback on tint, opacity and appearance. It refreshes the Compose host and shared material; multiple changes in one frame coalesce. Unchanged state schedules no further frames, and detachment cancels old callbacks. Blur, refraction, tint opacity and other user parameters remain unchanged.

## `.22` 补充排查 / `.22` follow-up investigation

在 `.21` 的实机验收中进一步发现：折叠底栏静止时，系统深浅主题已经改变、文字也已更新，玻璃底色仍可能保留上一帧配色；等待五秒仍能复现，改变几何尺寸后才重新绘制。Backdrop 的材质元素关闭了自动失效，但更新绘制回调时只刷新效果缓存，没有要求重画表面。

Device acceptance of `.21` exposed a second issue: a stationary compact dock could retain the previous surface tint after the page and foreground had changed theme. It remained reproducible after five seconds and recovered with a geometry change. Backdrop disables automatic invalidation; updating its draw callbacks refreshed the effect cache without requesting a surface redraw.

`.22` 在材质元素属性更新后补充一次绘制失效。现有按帧效果观察、背景采样、几何容量、着色器和光学参数均保留，不增加静止时自行申请下一帧的循环。补丁范围记录于玻璃模块的 vendor `UPSTREAM.md`。

`.22` explicitly invalidates drawing after material-element property updates. Per-frame effect observation, backdrop capture, geometry capacity, shaders and optical parameters remain unchanged; this does not add a self-scheduling idle-frame loop. The patch is documented in the glass module's vendor `UPSTREAM.md`.

`.22` 的实机重复切换仍可复现静止底栏旧色，因此该补丁单独不作完整验收。后续诊断与提交后刷新处理见 `.23`。

Repeated device switching in `.22` could still leave a settled surface with the old tint, so that patch alone is not accepted as the complete fix. See `.23` for the subsequent trace and post-commit refresh.

## `.21` 自动底色保存 / `.21` automatic tint persistence

修复玻璃调节室“应用到全部控件”丢失自动底色的问题。复制操作保留自动颜色的原始选择，不再将当前主题解析出的浅色或深色保存为固定颜色；从“其他面板”复制自动参数时，也会清除目标控件此前的固定底色。模糊、折射及其他光学参数仍按原有操作复制。

Apply to all controls now preserves the original Automatic tint selection instead of persisting the current theme's resolved light or dark color. Copying an automatic profile from Other surfaces also clears a destination's previous explicit tint. Blur, refraction and other optical values retain the existing copy behavior.

旧版已经保存的固定颜色无法可靠区分是自动误保存还是手动指定，因此不会猜测改写。升级后，对旧配置重新选择一次“自动”并应用全部、保存，即可恢复持续跟随深浅主题；此后切换主题无需再操作玻璃调节室。原有参数和手动指定颜色均保留。

Older fixed colors have no record of whether they were chosen manually or incorrectly resolved from Automatic, so they are not rewritten heuristically. For an affected saved profile, select Automatic once, apply to all and save after updating. Later theme changes follow automatically without reopening the tuning screen. Existing parameters and intentional fixed colors are retained.

588 项应用测试、类型、翻译及改动源码 lint 检查通过。新增回归测试确认旧逻辑会丢失自动颜色，修复后覆盖保存重载、深浅双向反复切换、其他面板清除旧色及固定颜色保留。ARM64 Release APK 构建成功，包名、`.21` / `103` 版本与原签名已核对。初次构建时手机未连接；随后安装到三星的验收发现了上述静止折叠材质的绘制失效问题，因此 `.21` 单独不作为主题切换问题的完整验收通过版本。

All 588 app tests, typechecking, translation checks and targeted source lint pass. New regressions reproduce the old loss of Automatic and cover save/reload, repeated light/dark transitions, clearing stale destination colors and retaining explicit colors. The ARM64 release APK was built with the original application ID and signing certificate, verified as `.21` / `103`. Its initial build had no connected device; later Samsung acceptance exposed the stationary compact-material redraw issue described above, so `.21` alone is not accepted as the complete theme-switch fix.

## `.20` 功能与实机记录 / `.20` features and device record

玻璃调节室模式栏移除“我的参数”入口，其余显示名称缩短为“开源默认”和“iOS参考”。英文对应显示为“Open-source defaults”和“iOS reference”。旧版保存的参数及当前材质选择继续保留，参数摘要兼容旧自定义模式；参考模式说明也不再引导进入已移除的入口。类型、翻译及改动界面 lint 检查通过。

The glass tuning mode row removes Custom parameters and uses the shorter labels Open-source defaults and iOS reference, with matching Chinese labels. Existing saved values and the active material choice are retained; the summary still handles a legacy custom selection. Reference-mode guidance no longer points to the removed entry. Typechecking, translation checks and targeted screen lint pass.

`.20` / `102` 已以原签名覆盖安装到三星，实机确认模式栏仅有 AM++ 参考、开源默认、iOS参考三个入口。该检查未修改或保存参数。

`.20` / `102` is installed on Samsung with the original certificate. The mode row was observed with only AM++ reference, Open-source defaults and iOS reference. No parameters were edited or saved during this check.

## `.19` 功能与实机记录 / `.19` features and device record

播放器下拉收合区域扩大到播放控制区上方，覆盖大封面、歌曲信息与空白区域；进度条、音量及播放按钮继续处理各自操作。手势仅向下激活，短屏和大字体布局仍可向上滚动。歌词页继续使用信息区下拉，不接管歌词滚动和点按跳播。

Downward dismissal now covers the large artwork, metadata and space above the playback block. Seeking, volume and transport retain their own input. Only downward movement activates dismissal, preserving upward column scrolling on short screens and with large text. Lyric mode retains its information-header boundary without taking lyric scrolling or line seeking.

“下一首播放”等共享提示复用 Mini Player 的玻璃组件，跟随相同材质模式、用户参数与模糊开关。正文及操作文字随明暗主题配色，使用仅限字形的轻微描影。播放器只展示歌曲名和艺人名：歌曲名点击进入所属专辑，艺人点击进入艺人详情；多艺人沿用选择列表。缺少详情 ID 时显示普通文字；打开详情时保留播放器状态，返回后可继续操作。

Shared notifications such as Play next reuse Mini Player's glass component, including its material mode, user parameters and blur preference. Text/actions follow the theme with a subtle glyph-only halo. Player metadata displays the song title and artist only: the title opens its album, while the artist opens artist details or the existing collaboration picker. Missing detail IDs remain plain text, and detail routes retain the player beneath them.

ARM64 修正版 APK 已构建，并以原包名与签名覆盖安装到三星，版本核对为 `.19` / `101`，首次安装日期保持不变。584 项应用测试、类型及翻译检查通过，lint 为 0 错误、117 项现有警告。实机确认播放器仅显示歌曲名与艺人两行；点按歌曲名进入所属专辑，点按艺人进入对应详情，两次返回均保留同一首歌的暂停位置。从大封面内部向下滑动后，已回到 Home 与 Mini Player。

The corrected ARM64 APK is installed on Samsung with its original package and certificate, verified as `.19` / `101` with the first-install date unchanged. All 584 app tests, typechecking and translation checks pass; lint reports zero errors and 117 existing warnings. Device checks confirmed the title/artist-only layout: tapping the song title opened its album, and tapping the artist opened the corresponding details. Both returns retained the same track and paused position. A downward swipe starting inside the large artwork returned to Home with Mini Player visible.

本轮导航检查仅覆盖这首歌的单艺人路径，未验收多艺人选择、歌词模式或帧率表现。通知的 Mini Player 材质接线已由源码与组件属性测试核对，本轮没有通知实机画面，尚不作外观验收。此前 `.17` 的录像和帧时间不作为本版的新测量；本轮截图仅留本地。临时 USB 常亮设置已恢复原值，手机已交还。

Navigation checks covered this track's single-artist path only, without validating the collaboration picker, lyric mode or frame-rate performance. Source and component-prop tests verify notification wiring to Mini Player's material, but notification appearance was not captured or visually accepted on device in this round. Earlier `.17` recordings and frame times are not new measurements of this build; this round's screenshots remain local. The temporary USB keep-awake setting was restored to its original value, and the phone was released.

## `.17` 实机记录 / `.17` device record

`.17` 当前构建已在三星设备上以同包名、原签名覆盖安装。574 项应用测试、139 项原生测试、类型与翻译检查通过；lint 为 0 错误、117 项警告。以下封面录像数据来自此前 `.17` 诊断构建，最终包本轮已完成有限的滚动复测；两者均不代表全部页面、长期运行或持续帧率验收。转场继续采用 f728743/AppleMusicStylePlayer 的共享封面与独立背景裁切，详见 [Apple Music 转场说明](./APPLE-MUSIC-TRANSITION.md)。

The current `.17` build is installed on the Samsung device with the same package and original signing certificate. All 574 app tests, 139 native tests, typechecking and translation checks pass; lint reports zero errors and 117 warnings. The artwork recordings below come from the earlier `.17` diagnostic build; the final build has now completed a limited scroll retest. Neither establishes acceptance of every page, long sessions or sustained frame rates. The f728743/AppleMusicStylePlayer shared-artwork and separate-background structure remains; see the [transition guide](./APPLE-MUSIC-TRANSITION.md).

Mini 的退出目标改为在按压与横滑变形之外测量的空封面锚点，保留 Yoga 的实际像素取整；入场仍读取当前已绘制封面。共享封面补齐图像比例与裁切交接。在此前 `.17` 诊断构建的三次收合录像中，端点图像配准的估计缩放为 `0.9925`、水平与垂直平移均为 `0`；`.16` 对应缩放为 `1.1225`。这消除了本次可见的大幅裁切跳变，但不表示像素完全相同；独立解码、缩放与重采样仍可能留下静态差异。

Mini now measures its resting artwork from an empty layout anchor outside press/swipe deformation, preserving Yoga's actual pixel rounding; entry still measures the currently painted cover. Shared artwork also accounts for image aspect and crop handoff. Across three closes recorded with the earlier `.17` diagnostic build, endpoint image registration estimated scale `0.9925` with zero horizontal/vertical shift, versus `1.1225` for `.16`. The large crop change was absent in these samples; independent decoding, scaling and resampling can still produce static pixel differences.

本次三个交接窗口内，同一底栏像素区域的标准差为 `23.75–23.90`，连续帧平均绝对像素差最大为 `0.59`；没有重现 `.16` 某次标准差升至 `41.95` 的单帧闪变。这些区域测量只描述所检查的交接片段，不等于全局无抖动或用户最终视觉验收。

In the three handoff windows, the same tab-region pixel standard deviation stayed at `23.75–23.90`, with maximum consecutive-frame mean absolute pixel difference `0.59`. The single-frame excursion to `41.95` seen once in `.16` did not recur in these samples. These region measurements describe only the inspected handoffs, not globally jitter-free rendering or final visual acceptance.

最终包的有效 All Music 滚动采样覆盖约 8 秒，手势工作量为 45 次快速滑动。927 个应用 Surface 帧中有 14 次 `App Deadline Missed / Late Present`；关联显示帧间隔中位数为 `8.32ms`，P99 为 `16.64ms`、最大 `16.65ms`。949 个完整 UI 帧中，84 个超过 `8.33ms`，其中三个超过 `16.67ms`。仍有短暂慢帧；这不是全局或长期无损 120fps 承诺。缓存、温度与热身未作严格控制，不与此前诊断构建量化比较；错误页面的 `.16` 采样无效，也不用于对比。

The final build's valid All Music scroll capture covers about eight seconds of a 45-swipe workload. Of 927 application Surface frames, 14 report `App Deadline Missed / Late Present`; mapped display-frame intervals have median `8.32ms`, P99 `16.64ms` and maximum `16.65ms`. Of 949 completed outer UI frames, 84 exceed `8.33ms`, including three over `16.67ms`. Short stalls remain; this is not a promise of global or sustained lossless 120fps. Cache, temperature and warmup were not strictly controlled, so no quantitative comparison with the earlier diagnostic build is made. The wrong-page `.16` capture is invalid and is not a comparison baseline.

本轮读取的累计原生计数中，1285 次背景记录全部走 direct 路径；离屏 GPU 图像捕获、异步提交与 `syncAndDraw` 计数均为零，与采样未见离屏 Draw 一致。窗口绘制与原光学滤镜仍有渲染成本。搜索下拉显示原材质已确认；后续点按片段进入了播放器，操作归属未能确认，因此搜索聚焦、取消及返回流程本轮未验收，不登记为通过或已确认故障。

Native counters read after this round report 1285 backdrop recordings, all using the direct path. Offscreen GPU image capture, asynchronous submission and `syncAndDraw` counters are zero, consistent with the trace showing no offscreen Draw passes. Window rendering and the existing optical filters still have a cost. Pull-down Search retained its original material. The later tap sequence was inconclusive after the player opened, so search focus, cancellation and return remain unverified rather than recorded as passes or confirmed failures.

最终 `.17` 构建已移除临时自动开启转场记录的行为；日志、图像和录像仅保存在本地，不作为公开文档附件。

Automatic transition tracing has been removed from the final `.17` build. Logs, images and recordings remain local and are not attached to the public documentation.

## `.14`–`.16` 保留的改动 / Retained `.14`–`.16` changes

`.15` 引入不含按压／横滑变形的 `restingArtwork` 目标与入场反向关闭的连续端点计算；`.17` 再将名义尺寸计算替换为实际布局测量。开启跑马灯时，Mini 保留同一 Marquee 树，独立 `active` 暂停时钟并保留 offset，返回时续播。关闭卸载期间保持旧播放器隐藏，避免在动画监听停止前恢复完整背景。

`.15` introduced a resting artwork destination and continuous endpoint rebasing when an opening reverses; `.17` replaces nominal dimensions with real layout measurement. With marquee titles enabled, Mini retains one Marquee tree and pauses its clock at the existing offset through independent `active` state. During close cleanup the outgoing player remains hidden until its animation observers stop.

保留 `.14` 的播放／歌词页白条移除，保留原高度、顶部下拉、系统返回与封面的无障碍关闭；主控制区仅保留原位置的三个播放按钮，随机／循环模式仍可从菜单设置。底栏在来源 scope 恢复前保留已绘制进度，并保留来源选中透明度。

The `.14` handle removal remains, retaining header height, pull-down/system Back and accessible closing on the artwork. Transport keeps three buttons in their original positions, with shuffle/repeat modes in More. The dock retains painted progress until its origin scope is ready and preserves selected opacity across handoff.

逐字遮罩只准备当前与下一行，下一行延后 720ms 预备；这项两行预算不改变歌词时间轴、行模糊范围或玻璃光学参数。有完整歌单镜像时先显示保存列表，HTTP 在后台更新；离线避免再次解析已有歌曲 SQL，本地查询仅取当前歌单 ID，保留顺序与重复项。没有完整镜像或缓存时，首次点击仍可能等待；已测缓存场景不代表全部歌单、持续性能或恒定 120fps。

Word masks are prepared only for the current/next rows, with next-row preparation delayed by 720ms. This two-row budget changes neither lyric timing, row blur nor glass optics. A complete saved playlist can display while HTTP refreshes in the background; offline metadata avoids duplicate song SQL and local reads request only the current playlist's IDs, preserving order and duplicates. A first opening without complete saved data can still wait. The observed cached case does not establish every playlist's speed, sustained performance or constant 120fps.

## `.13` 历史记录 / Historical `.13` record

`.13` 已安装，曾完成共享封面缩放回位、入场、短拉取消、长拉退出、歌词切换与下拉返回及 Mini／Tabs 同步出现的基础视觉检查；没有据此认定持续性能或长期稳定性通过。Primuse 整页形变已撤销，布局继续参考三星 Apple Music；私有参考截图不公开上传。

`.13` was installed and basic checks covered artwork resizing/landing, entry, short-pull cancellation, long-pull dismissal, lyric switching/return and synchronized Mini/Tabs reveal. They did not establish sustained performance or long-term stability. The Primuse whole-player morph remains removed, with Samsung Apple Music layout reference retained; private screenshots are not published.

## `.12` 历史回滚 / Historical `.12` rollback

当时 ARM64 APK 已构建并核对版本、包名和原签名，463 项应用测试、118 项玻璃模块原生测试及类型、翻译检查通过。该阶段构建待装；随后 `.12` 已安装，但未取得有效的本应用 Player 视觉或持续滚动验收记录。

At that stage the ARM64 APK was built with version, package and original certificate verified; 463 app tests, 118 native glass-module tests, typechecking and translation checks passed. Installation was pending then. `.12` was subsequently installed, but no valid acceptance record for this app's player appearance or sustained scrolling was obtained.

`.12` 当时恢复 `.10` 的入场／退场动效，保留播放器与底栏的同步揭露及返回交接，撤销用户拒绝的 Primuse 形变实验。旋转时稳定 surface owner、独立更新高度的非视觉安全修复继续保留，避免清零 mini 上拉进度。Tab 的 UI 线程即时点按反馈、列表稳定 callback ref 及统一浮动玻璃弹窗仍保留。候选比较见[研究记录](./PLAYER-MINI-TRANSITIONS.md)，后续 `.13` 采用的转场以上方当前说明为准。

In `.12`, entry/dismissal motion returned to `.10`, retaining synchronized dock reveal and route-pop handoff. A separate nonvisual safety fix kept the surface owner stable across rotation and published height independently, preserving an active mini pull. The rejected Primuse morph was removed. UI-thread tab feedback, the stable list callback ref and unified floating glass panels remained. See the [candidate research](./PLAYER-MINI-TRANSITIONS.md) for comparisons and the current guide above for the later `.13` transition.

控件使用 AMLL 派生的白色 SVG，并恢复适合手机的可见大小：上一首／下一首约 36dp、播放约 46dp，辅助图标约 24dp，触摸区至少 44dp。竖屏直接显示随机、上一首、播放／暂停、下一首和循环，采用 80／140ms 短按压／释放反馈，确认点击后立即调用原回调。竖屏根布局预留最多 48dp 底部空间，将封面、歌曲信息及控制区整体上移；次要文字为 0.78 白色透明度。滑条继续采用当前封面主题色。

Controls use AMLL-derived white SVGs at compact phone sizes: approximately 36dp visible skip arrows, 46dp play artwork and 24dp utilities, with at least 44dp touch targets. Portrait exposes shuffle/previous/play-pause/next/repeat. Short 80/140ms press/release feedback keeps confirmed actions immediate. Up to 48dp of bottom breathing room lifts the portrait artwork, metadata and controls; secondary text uses white at 0.78 opacity. Tracks retain current-artwork colors.

来源与许可见下节；长列表热点与未完成的持续实机验收见[性能记录](./PLAYLIST-SCROLL-PERFORMANCE.md)，全弹窗视觉验收见[统一面板说明](./UNIFIED-GLASS-PANELS.md)。不承诺恒定 120 fps。

See the source/license boundaries below, [performance evidence](./PLAYLIST-SCROLL-PERFORMANCE.md) and [panel validation scope](./UNIFIED-GLASS-PANELS.md). Sustained device and complete-popup checks remain pending; constant 120 fps is not claimed.

## `.9` 历史记录 / Historical `.9` record

`0.8.4.1-amll.9` · Android `versionCode 91` · `preview/amll-player`

当时 `.9` APK 已构建并核对原签名，425 项应用测试、113 项玻璃模块测试及两组原生方法回归通过；该阶段尚未安装。这是历史状态，当前构建与实机范围以上方 `.17` 及其链接说明为准。

At that stage the `.9` APK was built with the original certificate; 425 app tests, 113 glass-module tests and both native-method harnesses passed, with installation still pending. This is historical status; the `.17` section and linked guide above describe the current build and validation boundary.

`.9` 的 Player 页可在状态栏下方、大封面上方整片区域下拉退出；歌词页可从顶部小封面、歌曲名与创作者区域下拉，原有阈值保持不变。横屏与短屏按可见标题区域判断，歌词、滑条和控制按钮区域不作为返回手势入口。子页面底栏的来源选项卡继续显示主题色和选中态。

In `.9`, downward dismissal covers the full band between the status bar and large artwork; lyric mode includes its header artwork/title/artist. Existing dismissal thresholds remain intact. Landscape and scrolled short-screen layouts use the visible header bounds without taking lyric, slider or transport input. Pushed pages retain their originating tab’s accent and selected state.

下文保留 `.1`–`.4` 的来源与历史验证；正式下载仍以仓库 Releases 为准。The earlier provenance and `.1`–`.4` validation history remain below. Use repository Releases for stable downloads.

## 来源与实现边界 / Reference and implementation boundary

视觉参考为 [amll-dev/applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics)，固定提交 [`5fee356362353dbb24ce9bea3a62536478040de7`](https://github.com/amll-dev/applemusic-like-lyrics/tree/5fee356362353dbb24ce9bea3a62536478040de7)。核对范围包括 `react-full` 的 [PrebuiltLyricPlayer](https://github.com/amll-dev/applemusic-like-lyrics/tree/5fee356362353dbb24ce9bea3a62536478040de7/packages/react-full/src/components/PrebuiltLyricPlayer)、[竖屏与横屏布局](https://github.com/amll-dev/applemusic-like-lyrics/tree/5fee356362353dbb24ce9bea3a62536478040de7/packages/react-full/src/layout)，以及 Mesh 背景的视觉处理。

AMLL 对应包声明 **AGPL-3.0-only**。当前 [播放控件](../src/components/AmllPlayerControls.tsx)、[控件布局](../src/lib/amllPlayerControls.ts) 与 [选定 SVG](../assets/amll-controls/PROVENANCE.json) 派生自该固定源码，保留 AGPL 来源、[完整许可证](../licenses/AMLL-AGPL-3.0.txt) 与 [第三方声明](../THIRD_PARTY_NOTICES.md#amll-player-controls-and-artwork-background-reference)。封面／歌词视图及 Canvas 网格背景仍是独立原生实现；没有嵌入 AMLL DOM／WebView 运行库、Mesh shader、控制点数组或动画引擎。Resonus 原有 GPL-3.0-or-later 声明及根 LICENSE 保留；组合预览的对应源码与许可要求见上述声明。SVG 来源不代表 Apple／SF Symbols 授权，也不声称像素级一致。

The pinned AMLL package declares **AGPL-3.0-only**. Current [controls](../src/components/AmllPlayerControls.tsx), [control layout](../src/lib/amllPlayerControls.ts) and [selected SVGs](../assets/amll-controls/PROVENANCE.json) derive from that source and retain their provenance, [complete license](../licenses/AMLL-AGPL-3.0.txt) and [third-party notices](../THIRD_PARTY_NOTICES.md#amll-player-controls-and-artwork-background-reference). Cover/lyric views and the Canvas artwork field remain independently implemented, without AMLL’s DOM/WebView runtime, Mesh shader, control-point arrays or animation engine. Original Resonus GPL-3.0-or-later notices and the root LICENSE remain; see the notices for the combined preview’s source/license requirements. SVG provenance is not Apple/SF Symbols permission or a claim of pixel identity.

## 播放页 / Player layout

- 默认进入大封面布局，显示歌曲信息、进度与播放控制。点击封面或歌词按钮切换到歌词模式：小封面与歌曲信息置顶，歌词占满其余区域，隐藏进度、播放和音量控制；当前歌词的定位锚点为歌词区域高度的手机 10%、横屏 42%。
- 同一个封面视图通过原生动画缩放、移动；没有以两张不同封面互相替换。小屏与大字体采用可滚动的内容列，避免封面、文字与控制区域重叠。
- 顶部白条及其点击区域已移除，保留原布局高度、顶部整片下拉和系统返回；现有封面支持无障碍关闭动作。关闭过渡保留已绘制的歌词和原生背景；失焦时冻结当前高亮行、滚动位置、逐字进度与行效果，不再通过提前卸载歌词露出空白区域。恢复可见后再对齐最新播放时间。
- 竖屏大封面页仅显示上一首／播放暂停／下一首三个按钮，保留原位置、歌词／输出／队列与音量条；随机和循环仍在菜单。次要文字使用 0.78 白色透明度，原有业务回调保留。
- 横屏采用约 45% 的封面／控制列与 55% 的歌词列；隐藏歌词时，原来的封面／控制列移向中央。
- 横屏同样仅显示原位置的三个主播放按钮，底部左侧为输出，右侧为歌词与队列。
- 歌词、输出与队列等辅助图标显示为 24dp，点击区域仍为 48dp；不通过放大图形来填满触摸区域。
- 歌词继续使用 Resonus 的本地、服务器与 LRCLIB 数据和跳播逻辑。有时间轴的歌词使用现有逐字与同步渲染，纯文本歌词可单独滚动。
- AMLL 页面点击同步歌词会跳到对应时间；若当前暂停，同时恢复播放，正在播放时继续播放。原有歌词页面未传入此回调时，仍保持仅跳播的行为。
- 所有播放页共用 Resonus 的 `lyricBlurRadius` 强度、前后行差异及过渡；移除 AMLL 独立的前后四行限制。滤镜只分配给真实视口及少量预留的已测量行，远离播放行但仍在屏幕内的文字继续模糊。开关关闭、手动浏览及无当前行时保持清晰，失焦保留最后一帧并停止动画。未移植 AM++ 模糊算法。
- 播放、暂停、切歌、随机、循环、进度、系统或远程音量、音质详情、输出设备、队列和歌曲菜单继续调用已有功能。AMLL 的播放按钮不再显示封面色圆底，进度条与音量条仍直接读取当前封面主题色；Resonus 原有布局的按钮与封面配色偏好保持原样。

The player defaults to the large-cover view. The cover or lyric button switches to a small-cover header and full-page lyrics; progress, transport and volume controls are hidden in lyric mode. Active lyrics anchor at 10% of the lyric region in portrait and 42% in landscape. One cover view moves and scales through native animation; small viewports and accessibility text can scroll rather than overlap.

The visual handle and its tap target are removed while retaining header height, full-header pull-down dismissal and system Back. Accessible closing is available on the existing artwork. The closing transition retains the last lyric frame and native background. Losing focus freezes the highlighted line, scroll offset, word clock and row effects rather than removing the lyrics early; returning to the page realigns them with current playback.

Portrait and landscape show only previous/play-pause/next at their original positions; shuffle/repeat remain in More. Portrait keeps lyrics/output/queue and volume, with secondary text at 0.78 white opacity. Landscape retains output at the lower left and lyrics/queue at the lower right, and its approximately 45% artwork/control and 55% lyric split remains. Existing Resonus lyric, seek, playback, queue, output, volume, quality and menu callbacks remain in use; the previous Resonus layout’s preferences are unchanged.

Auxiliary glyphs such as lyrics, output and queue are 24dp within 48dp touch targets. Tapping a synchronized lyric in the AMLL player seeks to that time and resumes playback if paused; an already-playing song continues. Other lyric views keep seek-only behavior unless they opt into the callback. All player presentations share Resonus's `lyricBlurRadius`, past/future treatment and transitions. The AMLL-only four-row distance cutoff is removed: filters belong only to measured rows in the viewport plus a small margin, so visible lyrics remain blurred even far from the playing line. The disabled/manual-browsing/no-current-line clear states and frozen last frame remain. AM++ blur parameters and its algorithm are not ported.

在 **设置 → 播放器 → 播放器布局** 选择 **Resonus 原有布局**，即可切回之前的播放页，原有偏好不会被清除。下面的 **播放器背景**（纯色／封面颜色／模糊封面）仅适用于 Resonus 原有布局；AMLL 布局使用本页所述的网格背景。

Select **Settings → Player → Player layout → Resonus layout** to restore the previous presentation without clearing its preferences. The **Player background** choices below—Plain, Cover color and Blurred cover—apply only to that Resonus layout. AMLL uses the native artwork field described here.

## 完整封面背景与动画预算 / Spatial artwork background and animation budget

背景保留整张封面的空间颜色分布，先生成低分辨率纹理，再进行颜色整形、柔化、宽范围网格流动和暗角处理；不是用单一主色填满屏幕。网格轨迹与颜色处理由本项目独立实现，与 AMLL 的着色器、控制点和渲染器不同。

- 图片统一由 Expo Image 下载／读取缓存；原生模块只接收本地路径或内容 URI，不另开 HTTP 下载。离线标记的封面仅查询现有缓存，缺图使用中性背景。
- 解码、颜色处理和柔化按新封面执行，使用受限缓存；过期任务不能盖回旧封面。绘制复用一个最长边不超过 256 像素的缓冲区，没有逐帧全屏截图、全屏模糊或位图分配。
- 只有可见、前台且正在播放时才运行背景动画。暂停、隐藏、卸载、进入后台或无可用封面时停止申请动画帧；恢复时沿用暂停的动画相位。
- 缓慢流动的背景独立限制在最高约 **60 fps** 的工作预算。它不修改显示器、窗口或 Surface 的刷新率请求，界面与手势仍采用已有 **120Hz** 请求。背景预算与整页实际帧率不是同一项指标。

The background retains the complete artwork's spatial color distribution in a small texture, then applies color shaping, softening, a broad moving mesh and a vignette. It is not a single dominant-color fill. Its trajectories and filtering are independently implemented, rather than AMLL's shader/control-point renderer. Expo Image alone resolves/downloads images; native code accepts local paths/content URIs. Offline-marked artwork is cache-only, and missing artwork uses a neutral field. Decode/filter work occurs for new covers, stale work is rejected, and a bounded cache and reusable buffer avoid per-frame full-screen capture, blur or bitmap allocation. The buffer's longest edge is at most 256 pixels.

Animation stops while playback is paused, the view is hidden/detached, the app is backgrounded or artwork is unavailable, preserving phase on resume. The slowly moving background has its own approximately **60 fps maximum** work budget. It does not change display/window/Surface refresh requests; UI and gestures retain their existing **120Hz** requests. This budget does not measure or guarantee the entire page's delivered frame rate. See the [native background module](../modules/amll-background/README.md) for implementation details.

## AM++ 参数与底栏修复 / AM++ tuning and dock correction

**设置 → 玻璃调节** 中，AM++ 模式现可分别调节 mini player、导航与其他控件。**恢复 AM++ 默认参数** 一次恢复并保存三个目标；原有「自定义」参数独立保留。保存失败会提示，导出包含当前三个 AM++ 表面的参数。

修复在玻璃风格之间切换后，折叠导航图标可能继承 AM++ 旧位移的问题。AM++、开源默认、iPhone 参考和自定义模式现在都明确设置当前位置，AM++ 原有的回弹跟随继续保留。此修复不改变已设置的滚动触发门槛。

**Settings → Glass tuning** now edits AM++ profiles independently for the mini player, navigation and other controls. **Restore AM++ defaults** resets and saves all three; existing Custom parameters remain separate, save failures are reported and export includes the current AM++ profiles. A dock correction clears inherited AM++ compact-icon offsets when changing among all four appearance modes, while retaining AM++ spring tracking. Existing scroll thresholds are unchanged.

<a id="ampp-source-port"></a>

### 本轮 AM++ 源码接入 / AM++ source port for this round

mini player／底栏的本轮源码接入固定于 [Zennmn/AM-plus-plus](https://github.com/Zennmn/AM-plus-plus) 提交 [`36dd119950b001883d3e31e17586f545d404a7c1`](https://github.com/Zennmn/AM-plus-plus/tree/36dd119950b001883d3e31e17586f545d404a7c1)。下面列出已接入的源码关系，构建与实机验证状态仍以下节为准。

| 上游实现 / Source | 本仓库接入 / Resonus integration |
| --- | --- |
| `GlassBarCollapseInput.kt`、`GlassBarCollapseController.kt` | `AmPlusDockScrollInput.kt` 适配 Resonus 页面与窗口的触摸、边界、方向和尾惯性归属；`TabsMotionHosts.kt`、模块 JSI 接口与 `useLiquidDock.tsx` 将意图连接到 UI 线程共用弹簧。 |
| `GlassScrollCollapse.kt`、`GlassTouchCollapseTracker.kt` | 原生同名阈值累积器与触摸跟踪器，保留方向反转、触摸门槛和抬手速度处理。 |
| `GlassBarCollapse.kt`、`GlassBarCollapseLayout.kt`、`GlassTabGeometry.kt` | 原生同名几何策略，经 `AmPlusDockGeometry.kt` 连接 mini player、导航胶囊和独立搜索的位置与大小。 |
| `LiquidBottomTabs.kt` 的独立折射内容行及速度 × 按压权重 | `LiquidBottomTabsMaterial.kt`、`AmPlusSelectionMotion.kt` 与 `AmPlusTabForeground.kt` 录制当前 RN 图标和文字，为选中透镜提供前景；`AmPlusSelectionOverlay.kt` 将该透镜放在可见内容行之后绘制。 |
| `ViewBackdrop.kt` 的硬件 `RenderNode` 记录桥 | 前景硬件记录用于复用真实字形和布局，不另做位图读回；保留原始 Kyant／Backdrop 的 Apache-2.0 声明及 AM++ 修改归属。 |

宿主的播放、导航和窗口接口均适配 Resonus；源码中的 Xposed 安装流程、Apple Music 私有接口与 Apple 图像资源未作为整份应用运行。现有自定义参数和非 AM++ 风格继续保留。歌词模糊仍复用现有 Resonus 实现，未移植 AM++ 歌词模糊。完整许可与文件映射见 [第三方声明](../THIRD_PARTY_NOTICES.md#am-phone-dock-input-geometry-and-selected-material)。

The source relationships above are implemented against the pinned Zennmn commit. Input/controller ownership is adapted to Resonus windows and pages, with native accumulators/trackers and geometry connected through scalar JSI calls to the shared UI-thread spring. The selected lens uses the current RN foreground row and the source's velocity × press weighting, then draws after the visible row through an overlay. Hardware `RenderNode` recording reuses actual glyph layout without bitmap readback. Original Kyant/Backdrop Apache-2.0 notices and AM++ modification attribution are retained.

Playback, navigation and window interfaces belong to Resonus; this does not run the complete Xposed host, Apple Music private interfaces or Apple image resources. Existing Custom parameters and non-AM++ appearances remain available. Lyric blur stays with Resonus's existing implementation. See the [third-party source mapping](../THIRD_PARTY_NOTICES.md#am-phone-dock-input-geometry-and-selected-material). Build and device acceptance are recorded separately below.

## `.4` 滚动与资源生命周期 / `.4` scrolling and resource lifetime

- AM++ 前景记录与选中透镜限于实际交互；静止、隐藏、失焦及结束交互时停止记录并释放前景／overlay 引用。隐藏子树的 dirty 标志不再驱动自重绘。
- 共享背景采样显式排除选中透镜 overlay，包含 Android 已缓存的显示列表，避免把透镜重新采样进自己的背景。
- 页面导航发现跳过滚动列表；无嵌套导航的页面按导航结构缓存查找结果，歌曲行布局不再触发整棵列表查找。
- 歌曲列表缩略图直接显示，不为每批新行启动交叉淡入；离线封面查询合并同一专辑的并发请求，并将结果限定在最近 512 项。
- 普通列表／卡片和静态背景显式使用首帧位图解码，不为每张缩略图建立动画帧解码器；SVG 和不支持的新格式保留原有解码路径。播放器允许动画的资源不随暂停或失焦切换解码能力；重复启动同一动画改为幂等。磁盘预取仅下载原文件，成功、失败和取消均清理目标请求，静态／动态解码缓存分开。
- 三星历史退出记录中存在动态封面帧解码器的 `OutOfMemoryError`。这证明有过内存耗尽，不证明每次长列表闪退都来自同一调用栈。原始日志保存在本机忽略目录，不发布账号信息或设备日志。

Foreground recording and the selected-lens overlay are limited to actual AM++ interaction, then released. Hidden dirty descendants no longer drive self-invalidating recording. Shared capture explicitly excludes even cached overlay display lists. Navigation discovery skips scroll/list content and caches negative results against navigation structure, so mounting song rows does not rescan them. Song thumbnails avoid per-row crossfades; offline artwork probes share in-flight album requests and retain at most 512 recent results.

Opt-in static decoding returns first-frame bitmaps for ordinary covers/backgrounds, without allocating an animation decoder per thumbnail; vector/unsupported formats retain their existing path. Playback-capable artwork retains its decoder across pause/focus changes, and repeated animation start becomes idempotent. Disk-only prefetch downloads the original data without decoding a drawable and clears its request on success, failure and cancellation. Static/dynamic decoded cache keys remain separate. The version-pinned Expo Image patch is built from source and must be reviewed/rebased when that dependency is upgraded.

Samsung's historical exit/crash records contain an animated-artwork frame-decoder `OutOfMemoryError`. This confirms an earlier memory-exhaustion crash, without establishing that every reported long-list exit has the same cause. Raw logs remain in ignored local storage and are not published.

## 首页标题 / Home heading

在 **设置 → 外观 → 首页 → 首页标题** 自定义大标题。编辑预览即时更新，结束编辑或退出时保存；留空恢复原有问候语／翻译标题规则。导航标签、路由与问候语偏好不受影响，设置按当前资料保存。

Use **Settings → Appearance → Home → Home title** to customize the large heading. The local editing draft previews immediately and commits when editing ends or the page closes. Empty text restores the existing greeting/localized-Home rule. Navigation labels/routes and the independent greeting preference remain unchanged; the title is saved per profile.

## 全局开关尺寸 / Compact global switches

所有开关通过统一入口缩小约 15.6%，布局从 64×48dp 调整为 54×44dp，每行释放 10dp 横向文字空间，保留 44dp 触摸高度。内部拖拽坐标经缩放逆映射，材质、颜色与开关逻辑保持不变；设置、登录、分享、播放列表编辑及玻璃调节页均采用相同尺寸。

All switches use a shared compact wrapper: 54×44dp instead of 64×48dp, approximately 15.6% smaller optically and 10dp less row width. The 44dp touch height is retained, drag coordinates map through the inverse transform, and materials, colors and toggle logic are unchanged. The same size applies to settings, login, sharing, playlist editing and glass tuning.

## 验证状态 / Validation status

### `.4` 检查历史 / `.4` validation history

367 项 JavaScript 测试及 106 项原生测试（玻璃 93、背景 6、高刷 7）通过。ARM64 Release APK 构建成功，核对版本 `0.8.4.1-amll.4`、编号 `86`、原包名与原签名一致。Expo Image 原生源码重新编译成功，发布混淆映射确认新首帧解码器与磁盘预取路径已包含。静态检查无错误，保留 21 条既有代码警告，警告均不在本轮修改行。已覆盖安装到三星，版本核对为 `.4`/86，首次安装日期保持 2026-10-05 17:44:34；首页和封面正常显示，过滤的启动错误日志为空。安装前取得的系统日志来自旧版本，不能当作 `.4` 的帧率或长列表验证。历史日志确认过动态图片解码时的内存耗尽，但此次所有闪退原因及修复效果仍需实机复测。

All 367 JavaScript tests and 106 native tests (93 glass, 6 background, 7 refresh) passed. The ARM64 release APK built successfully; version `0.8.4.1-amll.4`/86, application ID and the existing signing certificate were verified. Expo Image was compiled from source, and the release mapping confirms the new static-decoder and disk-prefetch paths were included. ESLint reports no errors and 21 existing-code warnings, none on modified lines. This APK was installed over the existing Samsung app and verified as `.4`/86; the first-install date remains 2026-10-05 17:44:34. Home artwork rendered and filtered startup errors were empty. Earlier Android logs belong to the previous version and are not `.4` frame-rate or long-list acceptance evidence. Historical logs confirm an animated-image decoding OOM; the causes of all reported exits and this fix's effectiveness still require device testing.

### `.3` 检查历史 / `.3` validation history

TypeScript、翻译检查和改动源码 ESLint 全部通过（无错误、无警告）；346 项 JavaScript 测试与 89 项玻璃模块原生测试通过。ARM64 Release 成功构建，核对版本 `0.8.4.1-amll.3`、编号 `85`、原包名与签名后覆盖安装，首次安装日期仍为 2026-10-05。

三星初查确认：三枚辅助图标为 24dp 视觉／48dp 点击区；暂停时点歌词会跳到对应时间并开始播放；现有歌词模糊显示；主页面滚动可折叠／反向展开，底栏按压与拖动显示实际前景折射层。完整退出录屏保留歌词帧直至页面滑出，抽帧未见此前局部黑屏。应用过滤的崩溃与前景录制错误日志为空。操作后保留暂停状态，未修改账号或下载数据。

系统仍报告 120Hz 覆盖策略；本轮没有完整帧时间／持续耗电测量，不将其等同于始终达到 120 fps。实机初查不替代用户对长期滚动、温度及不同背景外观的体验。

TypeScript, translation checks and targeted source ESLint passed with no errors/warnings, alongside 346 JavaScript tests and 89 native glass-module tests. The ARM64 release APK built successfully; version `0.8.4.1-amll.3`/85, package and signing certificate were verified before replacement installation. The first-install date remains 2026-10-05.

Initial Samsung checks confirmed 24dp auxiliary glyphs with 48dp targets, seek-and-resume from a paused lyric tap, the existing lyric blur, scroll collapse/reverse expansion and actual foreground refraction during tab interaction. A complete dismissal recording retained lyrics until the surface left; reviewed transition frames showed no earlier localized black patch. Filtered crash/foreground-recording logs were empty. Playback was left paused, with account/download data retained. The OS still reports a 120Hz override, but this round did not measure sustained delivered frame times or battery use and does not guarantee constant 120 fps.

### `.2` 检查历史 / `.2` validation history

`.2`（Android `versionCode 84`）已通过 TypeScript、翻译检查与 337 项 JavaScript 测试，静态检查无错误。ARM64 Release 构建成功，版本／包名元数据及签名检查通过，已覆盖安装到三星并进行部分界面初查。此前录屏未覆盖完整退出过渡，不能据此宣称顶部横条、下拉与系统返回的完整退出已通过录屏验收；该过程仍需补测。

`.2` (Android `versionCode 84`) passed type checking, translation checks and 337 JavaScript tests, with no lint errors. The ARM64 release build, version/package metadata and signing checks passed; it was installed over the existing Samsung app and received partial UI inspection. The earlier recording did not cover the complete dismissal transition. It therefore does not validate full dismissal through the handle, dragging and system Back; that sequence still needs to be recorded and checked.

### `.1` 检查历史 / `.1` validation history

此前 `.1` 已通过 TypeScript 类型检查、翻译检查、321 项 JavaScript 测试及 71 项原生测试（背景 6、玻璃 58、高刷 7）；静态检查无错误，保留 11 条现有代码警告。ARM64 Release 安装包已成功构建并验证版本号、包名与原测试版签名一致。另用临时本机样例检查了小屏竖屏、封面／歌词切换与横屏布局；该网页检查不呈现 Android 原生背景，不能作为背景外观或原生帧率验收。临时样例和测试入口已移出安装包。自动化验证覆盖小屏／横屏／大字体布局约束、滑条取消及旧手势隔离、AM++ 参数保存恢复、切换风格后的折叠位移、背景缓存及动画预算等。自动化检查无法代替实机视觉与帧时间记录。

已在三星 SM_S9380 覆盖安装，包名与签名保持一致，首次安装日期仍为 2026-10-05。已查看原生封面背景及歌词／大封面切换，确认 AM++ 调节控件与恢复入口可用，并检查开源默认、自定义及 iPhone 参考风格下折叠图标的归位；之后恢复原 AM++ 风格，未保存其他模式。应用过滤的错误日志未发现崩溃。系统报告 120Hz 覆盖策略，这不等于动画实际帧率；长期滚动、播放／音量／跳播及后台恢复仍需继续体验。**本轮没有新的实机 120 fps 测量结果**，也不承诺所有页面、所有动画或长时间操作始终达到 120 fps。实际表现取决于设备、温度、系统调度与数据内容。

For `.1`, type checking, translations, 321 JavaScript tests and 71 native tests (6 background, 58 glass, 7 refresh-policy tests) passed. Static checks reported no errors and 11 existing-code warnings. The ARM64 release APK built successfully; its version, package and signing certificate matched the intended preview update. Temporary local fixtures checked small portrait, cover/lyric switching and landscape layout; that web check does not render the Android native background or validate native frame rates. Fixtures and their route were removed before the APK build. Automated tests covered responsive/accessibility layout bounds, slider cancellation/stale gestures, AM++ persistence/reset, compact-icon style changes, background cache handling and its animation budget. They do not replace on-device visual inspection or frame-time measurements. The update was installed over the existing app on Samsung SM_S9380 with the same package/signature and original 2026-10-05 first-install date. Initial checks covered the native artwork field, lyric/large-cover switching, enabled AM++ controls/reset entry, and compact-icon placement in Kyant, Custom and iPhone reference styles. AM++ was restored without saving other styles. App-filtered error logs showed no crash. The OS reported a 120Hz override policy, which is not delivered frame-rate evidence; long-session scrolling, playback/volume/seeking and background-resume checks remained pending. **This preview has no new on-device 120 fps measurement**, and does not promise sustained 120 fps across every page, animation or long session. Device, temperature, system scheduling and content affect the result.
