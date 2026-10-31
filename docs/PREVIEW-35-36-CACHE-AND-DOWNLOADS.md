# 艺人、底栏与下载预览 / Artist, dock and download previews

## .35：五项修复

`0.8.4.1-amll.35` / Android `118`，本地 ARM64 测试包，未发布。

- **艺人顶栏**：不再用固定取色矩形直接覆盖滚动照片。顶栏复制同一张已缓存照片和静态色场，使用与主图一致的滚动、视差、遮罩及裁切。副本最长宽度限制为 240 物理像素，模糊在静态图片上处理，滚动只更新变换；下缘渐隐。主图尺寸、已有渐隐、播放器和玻璃光学参数保持原设置。
- **艺人名字图**：普通名字与官方名字图使用互斥可见层，图片已可用时无需等待 `onDisplay` 才隐藏文字；当前图片失败才回退为单个普通名字。来源匹配逻辑通用于所有可确认官方资源的艺人，不是 Taylor Swift 的特例。Apple 未公开或无法确认匹配的资源仍使用普通名字。
- **一键缓存**：设置 → 下载与离线 → 批量缓存封面与歌词。完整分页扫描可访问的歌曲、专辑和艺人；分项记录已有、成功、来源缺失、失败及剩余数量，支持暂停、继续、取消和失败重试。进度存入当前账号的 SQLite，逐词歌词保留全部时间信息。手动开始前不发起全库请求，遵守离线和仅 Wi-Fi 设置，退到后台暂停。它不下载音频。
- **艺人首屏**：已有持久艺人资料和全尺寸本地头像时先显示缓存，再进行有期限的后台更新；头像丢失时不会把远程 URL 伪装成本地命中。
- **Volta 专辑**：按参考项目使用同排的随机／播放／下载／更多操作；收藏保留在菜单内，移除播放按钮下方孤立的收藏按钮。Minidisc 和 Spotify 专辑布局不变。
- **后台恢复**：原生运动写入返回接收结果，只有实际接收才更新 JS 去重记录；窗口重新获得焦点后发布新的运动 host，将现有进度重新同步。恢复时清除中断的拖动和按压，选中镜片回到实际页面，保留折叠目标和播放器覆盖时停放的底栏状态；旧 host、旧滚动及旧手势完成事件不能覆盖新状态。

### .35 检查记录

- 779 项应用测试通过，类型和翻译检查通过；静态检查 0 错误（134 条项目警告）。
- 原生玻璃模块 Kotlin 编译通过；14 项 `ArtistArtworkMathTest` 通过。
- 完整 ARM64 APK 构建成功，包名 `com.zskruc.resonus.glasspreview`，版本 `118`，沿用现有测试签名。
- APK：`artifacts/Resonus-Glass-v0.8.4.1-amll.35-arm64-v8a.apk`，45,401,484 bytes。
- SHA-256：`8c9c41df32ddb3a0ac3370ae2d0253b60d07c2f7646692cae52402f5ede89ba1`。
- 构建完成时电脑未检测到三星，尚未安装或进行 `.35` 实机视觉验收。自动测试证明同步和几何边界，不代表与 Apple Music 逐像素一致；也未在真实曲库自动执行全量缓存。

## .36：音频下载管理

新增需求在五项修复包封存后开始实现。音频下载管理与封面／歌词批量缓存是独立入口；
继续复用原有歌曲、专辑、播放列表和艺人下载入口及文件验证。

设置 → 下载与离线 → 下载管理，可查看当前账号的总队列、总进度和逐曲进度。
原有歌曲、专辑、播放列表、艺人及收藏下载入口继续向同一个队列添加任务。

- 显示待下载、下载中、已暂停、已完成、失败和取消状态。已知文件长度显示单曲百分比，未知长度显示收到的字节；总进度按已完成歌曲和已知单曲进度汇总，未把来源未知的字节量假设成百分比。
- 全部开始／全部暂停／全部取消连接真实调度器。开始操作会显式重试失败项，取消项不会自行恢复，已完成音频不会被删除。
- 同时下载歌曲数可选 **1–20**，沿用按账号保存的下载设置；运行中调大上限会启动等待项，调小会等待已有传输结束再减少并发。
- 多个歌单里的同一首歌共用一个下载任务，各组保留引用；账号、每次运行及迟到回调均有所有权核对。
- 暂停保留可续传的临时音频。继续前核对实际文件长度、HTTP 206 范围与完整长度；服务器忽略 Range 时安全地从头重下。只有通过原有 HTTP／音频类型及完整性检查后才登记离线媒体。
- 文件清理等待所有前代写入结束，防止连续取消／重加时旧任务删除新文件。清空下载时同样等待退休任务，并阻止删除目录期间启动新任务。
- UI 使用虚拟列表、稳定行引用和约 150ms 进度合批，没有额外联网加载队列封面。

**本版边界**：音频队列保留在本次 App 会话内，重启后未完成任务需重新添加，已完成文件和原离线曲库保留。封面／歌词批量任务则有独立的持久检查点，重新打开页面后可以继续。

`.36` 全量 808 项应用测试通过，类型／翻译检查通过，静态检查 0 错误（134 条项目警告）。
其中 27 项下载行为测试涵盖真实 store／文件系统边界、最多 20 个并发、逐曲进度、暂停续传、账号切换、错误音频拒绝、连续取消重加及清盘等待。
另有独立只读复核确认原先可复现的跨代清理竞态已消失。这些测试不代表已测得三星帧率或真实网络吞吐。

### .36 构建与设备记录

- ARM64 APK 完整构建成功，版本 `0.8.4.1-amll.36` / Android `119`；包名继续为 `com.zskruc.resonus.glasspreview`。
- `apksigner verify` 通过，证书与此前测试版相同，可覆盖原 Resonus Glass。
- APK：`artifacts/Resonus-Glass-v0.8.4.1-amll.36-arm64-v8a.apk`，45,429,368 bytes。
- SHA-256：`acbb916db89f84535d04ebf6785cd65840a8c16827beb344ae0eba40e565663f`。
- 构建完成时未检测到设备，当时尚未安装 `.35`／`.36`。随后 `.36` 的安装与分项实测见下节。
- 构建时待实机验收的艺人名字、Volta 专辑操作、展开／折叠底栏后台恢复及下载小任务，已在下方分轮记录。全库缓存须用户显式开始，不在验收时自动下载整个曲库。

### 2026-10-31 三星安装与首轮实测（09:35 起，部分完成）

`.36` 已覆盖安装到 Samsung SM-S9380，设备回读确认 `versionCode=119`、
`versionName=0.8.4.1-amll.36`。沿用原账号与离线资料，没有清数据或重新登录。

已保存的有效截图确认：

- 陈奕迅页顶部照片、滚动途中大名字及进一步滚动后的顶栏小名字正常显示，未出现原先固定色矩形的明显底边。
- 折叠底栏连续执行 5 轮 Home → 回到 App 后，Home／Mini Player／Search 三部分位置和材质形态保持一致；原生生命周期日志记录三种角色恢复到 `progress=1`。
- 歌词视图执行 3 轮后台返回后，背景和歌词仍完整覆盖页面；从顶部区域下拉后回到原艺人页的折叠 Mini Player。
- 下载设置能打开，两个新增入口显示中文。尚未启动整个曲库的封面／歌词缓存，也未新增、取消或删除真实音频下载。

网络与中断限制：App 最初处于离线模式。为测试下载临时联机后，App 又自动回到离线；
电脑的直连 IPv6 无认证 API 探测能收到 Navidrome 响应，手机系统的 IPv6 域名解析探测失败。
这不足以单独判定 App 内部请求的最终失败原因，因此不将真实下载／暂停／续传标为通过。
随后 USB 连接中断，Justin Bieber、Volta 专辑操作、新管理页、并发选择器及展开底栏后台恢复仍待检查。

测试临时把息屏改为 10 分钟、USB 充电常亮改为开启。原值为 **30 秒／关闭**；USB 中断时尚不能恢复。
用户随后重新连接，已实际回读确认息屏 **30000ms**、充电常亮 **0**、诊断属性为空，恢复完成。
本机私有 `device36-20261031/restored.json` 保存该回读。手机再次自动锁屏，后半段检查尚未执行；USB 连接已经正常，不需要再次插拔。
本轮手机主题、账号、下载并发（原值 3）、收藏和播放列表内容均未修改。上午这一轮结束时离线状态仍为开启；这不是下午补测的恢复基准。

### 2026-10-31 下午补测（.36）

三星重连、解锁后继续使用已安装的 `.36`。本轮开始前回读确认：App 离线状态为 **false**、
下载并发为 **3**、歌曲排序为 **最近播放**，原息屏为 **30000ms**、USB 充电常亮为 **0**。
恢复测试设置应沿用本轮基准，不把上午的离线 `true` 写回。歌曲排序已恢复为最近播放，
并发原值 3 未修改；未改收藏、播放列表内容或删除已有离线音频。

本机私有证据位于 `.local-cache/device36-20261031/`，截图、页面 XML 和生命周期日志相互核对：

- **艺人名字**：Justin Bieber 页显示单个名字图，没有同时叠加普通名字；记录为 `justin-settled.png` 等截图。这只验收本次资源的显示，不据此宣称所有艺人都有官方名字图。
- **Volta 专辑**：`purpose-album.png`／`.xml` 确认随机、播放、下载、更多在同排，没有播放按钮下方孤立的收藏按钮；收藏入口仍在菜单中。
- **展开底栏后台恢复**：连续 3 轮后台返回后，展开底栏与 Mini Player 的位置、形态保持正常；`expanded-return-1.png` 至 `expanded-return-3.png` 及 `expanded-lifecycle.txt` 记录本轮结果。日志中三个原生角色重放展开进度 `0`。这与上午已记录的折叠状态及歌词后台测试分开计数。
- **并发选择**：实际打开「同时下载数」选择器并滚动，确认 **1–20** 可见；`concurrency-options.png`、`concurrency-20.png` 保存选项，原值 3 没有改为 20。
- **批量缓存**：`bulk-idle.png`／`.xml` 显示「等待开始扫描」与开始按钮。仅打开、查看保存的状态，没有点击扫描，没有发起全库缓存；不能据此把全库成功率或完成速度标为通过。
- **真实音频下载**：两首任务最终为 **2/2、100%、44MB**：第一首 20/20MB，第二首 24/24MB，失败与取消计数均为 0。`transfer2-final.png`／`.xml` 保存最终状态；更早的 `transfer-explicit-wait-0.png`／`.xml` 只证明第一首完成，不代替双曲过程。
- **暂停与恢复**：`transfer2-paused-a` 与 `transfer2-paused-b` 两组截图／XML 间隔约 **4 秒**，均为第一首已完成、第二首 **3/24MB、12%、已暂停**，总进度 **56%**、接收量 **23MB**；暂停状态和显示进度稳定。恢复后的 `transfer2-resumed.png` 显示第二首 **4/24MB、15%、正在下载**，随后达到双曲最终完成。

**本轮证据边界**：MB 与百分比有取整，暂停截图不等于证明零后台字节流量；没有抓取服务器
HTTP 206／Range 响应，不能把可见恢复进度等同于传输层断点续传验收。取消点击时两首已经完成，
因此**中途取消未完成实机验收**。本轮也没有取得 120Hz 帧时间或完整离线解码／媒体完整性证据。

### .37：新增下载不继承空闲暂停，补测中途取消

`.37` 已完整构建并以原签名覆盖安装到三星：`0.8.4.1-amll.37` / Android `120`，ARM64。
APK 为 `artifacts/Resonus-Glass-v0.8.4.1-amll.37-arm64-v8a.apk`，**45,430,860 bytes**，
SHA-256 为 `ad8ef611ca14633c8eb7720ee71234250bc22e9cdc6c9d28be0583d91bc1c2c9`。
这一版全量 **813 项应用测试通过**。

- 离线模式开 → 关之后，显式添加的新音频任务直接开始，显示 **1%、475KB**，没有再点击「全部开始」。这覆盖了 `.36` 中空闲暂停标记被新任务继承的回归。
- 本轮在传输途中点击「全部取消」，`cancel-result.xml` 记录 **0/1 首完成、已取消 1**，该曲为 **807KB/36MB、已取消**；未删除原有已完成下载。这次补齐了 `.36` 来不及覆盖的中途取消实机检查。
- 歌曲排序再次恢复为 **最近播放**。证据位于本机私有 `.local-cache/device37-20261031/`。
- 艺人照片焦点暗层的第一轮修复**未通过**：在失焦／取得焦点的对照中，原先约 10% 的暗层仍然存在，因此继续修复到 `.38`；不能把下载回归通过当成照片问题也通过。

### .38：清除 Android 已缓存的照片焦点暗层

`.38` 已完整构建并以同一签名覆盖安装到 Samsung：`0.8.4.1-amll.38` / Android `121`，ARM64。
APK 为 `artifacts/Resonus-Glass-v0.8.4.1-amll.38-arm64-v8a.apk`，**45,431,764 bytes**，
SHA-256 为 `605791409b7decc37e42fc76e928d87e4fb7ecd40e80e051a4995b9b1433187c`。

这次只补原生视图定位与焦点状态重评：通过 `appContext.findView` 查找并核对实际照片视图，
在同一次 MAIN 任务中关闭默认 focus highlight；若此前标记开启且已经取得焦点，
只执行一次 `clearFocus`／`requestFocus`，清掉 Android 已缓存的高亮 drawable，再刷新绘制状态。
保留最终焦点、点击与无障碍语义，不修改照片尺寸、播放器布局或已保存的玻璃参数。

`.local-cache/device38-20261031/justin-top.png` 与 `justin-focused.png` 对照照片未取得焦点、
随后使用 TAB 取得焦点的情况，原先照片额外的约 10% 暗块／接缝没有复现。
`focus-log.txt` 同时确认原生调用 **applied=true**、默认焦点高亮 **after=false**，
取得焦点的状态仍为 true。这一结论限于照片焦点暗层，不宣称全页取色或每个像素完全一致。
日志中的 `before=false、focused=true、restored=true` 仅证明保留了焦点，
不能证明上文 `before=true` 且已聚焦时的 clear/request 条件分支在本轮实际执行。

补充功能检查：展开、折叠底栏分别执行 **2 轮**后台返回，静态位置保持一致；
点击照片正常打开图片查看器并能返回；滚动后顶栏小名字正常显示。
本次观察窗口中该 App 进程的 **FATAL 为 0**，不据此扩大为所有场景均无崩溃。

`.38` 安装前的 **20 项定向测试、类型检查及相关文件静态检查通过**。
同步 GitHub 前，另在最终 `.38` 源码上完整执行 **813 项应用测试**及 canonical ID 检查，全部通过。
本轮已实际回读并保存
`.local-cache/device38-20261031/restored.json`：息屏 **30000ms**、USB 充电常亮 **0**，
底栏与艺人焦点诊断属性均为空、App 离线状态为 **false**，恢复完成。
关闭诊断后已重启 App，使 JS 诊断常量也关闭；下载并发保留原值 **3**，歌曲排序保留 **最近播放**。
此前未取得的 HTTP 206／Range、120Hz 帧时间及完整离线媒体证据仍不扩大宣称。

## English

Preview `.35` replaces the fixed artist navigation color slab with a small,
cache-only copy of the scrolling photograph and prepared field, using matching
scroll/parallax coordinates and clipping. The existing photograph fade,
player layout and glass optics are preserved. Official artist name artwork
and fallback text are mutually exclusive. The implementation is generic for
verified official resources, rather than specific to Taylor Swift.

The new artwork/lyrics cache page scans complete server pages, persists
per-profile checkpoints and full timed lyrics, distinguishes missing sources
from failed requests, and supports pause/resume/cancel/retry. Opening the page
does not start a bulk download. Cached artist metadata and full-size pictures
are returned before a bounded refresh. Volta album actions now share one row,
with Favorite in the menu. Native dock motion acknowledges writes and replays
current geometry after focus restoration, cancelling interrupted pointers
without forcing an expanded dock.

The `.35` APK passed 779 app tests, type/translation checks and native
compilation; 14 artist image math tests passed. That build was not separately
device-tested because the Samsung was disconnected when it finished; the
later `.36` checks below include these changes. Bulk downloads have not been
automatically started on the real library. Preview
`.36` adds a real per-account audio download queue with overall/per-song
progress and start/pause/cancel controls. It supports 1–20 runtime-adjustable
concurrent songs, deduplicates shared songs, preserves completed audio and
validates resumed HTTP ranges before committing files. Progress updates are
batched and unchanged row objects are retained. File cleanup waits for all
prior generations of a song, including repeated cancel/re-add sequences.

The audio queue is session-only: completed downloads survive restart, while
unfinished tasks must be added again. Bulk artwork/lyrics jobs have separate
persistent checkpoints. All 808 app tests, type/translation checks and static
checks passed (zero errors, 134 existing/project warnings); 27 targeted download
tests cover the scheduler, real store/native file boundaries and UI.
The `.36` ARM64 APK was built successfully with Android code `119`; its package
and signing certificate match the existing Glass previews. The SHA-256 is
`acbb916db89f84535d04ebf6785cd65840a8c16827beb344ae0eba40e565663f`.
No Samsung was connected when the build completed. The later `.36` install
was confirmed on an SM-S9380 (code `119`). Saved captures cover the Eason artist
header transition, five compact dock background/foreground cycles and three
lyrics cycles followed by a downward dismissal. Downloads settings show both
new entries. These observations do not establish frame rate or exact Apple
Music equivalence.

The morning transfer checks were interrupted by an automatic return to offline
mode and a USB disconnection. Its temporary display settings were restored and
verified: 30000ms timeout, USB stay-awake off and the diagnostic property empty.
That morning offline state is historical, not the afternoon restoration target.

The afternoon `.36` session began online (`offline=false`), with concurrency 3,
Recently played sorting, a 30000ms timeout and USB stay-awake off. Sorting was
restored to Recently played; concurrency remained 3. Theme, account, favorites,
playlist contents and existing offline audio were not changed or deleted.
Saved evidence under the private local `device36-20261031` directory confirms:

- A single Justin Bieber name artwork without overlaid fallback text, and
  Volta album actions sharing one row with no isolated Favorite button below.
- Three expanded-dock background/foreground cycles, supported by captures and
  lifecycle replay logs for all three native roles at expanded progress 0.
- The concurrency selector visibly contains 1–20; the original value 3 was
  not changed. The bulk cache page was only inspected in its idle state;
  no whole-library scan or download was started.
- Two real audio downloads finished at **2/2, 100%, 44MB**, comprising 20MB and
  24MB files. Two paused captures about **4 seconds** apart show the second
  song at **3/24MB, 12%, paused**, with total progress 56% and 23MB received.
  After Resume, it shows **4/24MB, 15%, downloading**, then final completion.

These observations establish stable displayed pause state and progress,
followed by resumed progress and queue completion. Rounded counters do not
prove zero background traffic. HTTP 206/Range responses were not captured;
transport-level byte-range resumption has not been accepted on this evidence.
Cancel was tapped after both songs had finished, so cancellation during an
active transfer remains untested on the device. No 120Hz frame-time or full
offline decoding/media-integrity acceptance is claimed.

Preview `.37` was subsequently built and installed over the existing Samsung
app using the same certificate: version `0.8.4.1-amll.37`, Android code `120`,
ARM64, **45,430,860 bytes**. Its SHA-256 is
`ad8ef611ca14633c8eb7720ee71234250bc22e9cdc6c9d28be0583d91bc1c2c9`.
All **813 app tests** passed for this baseline.

After toggling offline mode on and off, a newly added real download started
directly at **1%, 475KB**, without tapping Start all. Cancelling while it was
still transferring produced **0/1 completed, 1 cancelled**, at **807KB/36MB**;
existing completed audio was retained. This supplies the active-cancellation
device check that `.36` did not cover. Recently played sorting was restored.
Private captures and XML are in `device37-20261031`. The first artist-photo
focus fix did **not** pass: the roughly 10% focus overlay remained, requiring
the narrower `.38` repair.

Preview `.38` was fully built and installed on the Samsung with the same
certificate: version `0.8.4.1-amll.38`, Android code `121`, ARM64,
**45,431,764 bytes**. Its SHA-256 is
`605791409b7decc37e42fc76e928d87e4fb7ecd40e80e051a4995b9b1433187c`.
It uses `appContext.findView` to resolve and verify the photo view, then
disables the default focus highlight on MAIN. If that flag had been enabled
while the view was already focused, one clear/request-focus cycle reevaluates
Android's cached highlight drawable. Final focus, click and accessibility
semantics are preserved, as are photo geometry, player layout and saved glass
parameters.

The `.38` unfocused and TAB-focused Justin captures in `device38-20261031`
no longer show the original extra photo dark block/seam. Native logs confirm
**applied=true**, highlight **after=false**, and focus retained. This accepts
the observed photo-focus repair, not exact whole-page color or pixel identity.
The logged `before=false, focused=true, restored=true` preserves a focused
view; it does not prove that the conditional clear/request branch for an
already-focused view with `before=true` was exercised on this device.
Two expanded and two compact dock background/foreground cycles preserved
their static positions. Photo taps opened the image viewer and returned;
the small artist title displayed correctly after scrolling. The observed app
process recorded **zero FATAL events** during this window, without a claim
that every possible crash scenario has been tested.
The **20 targeted tests, type check and scoped lint passed** before installation.
Before GitHub publication, all **813 app tests** and canonical ID checks were
also rerun successfully against the final `.38` source. Actual readback
saved in `device38-20261031/restored.json` confirms restoration: **30000ms**
screen timeout, USB stay-awake **0**, empty dock and artist-focus diagnostic
properties, and App **offline=false**. The app was restarted after disabling
diagnostics so its JS diagnostic constants are also off. Original concurrency
**3** and **Recently played** sorting were preserved.
No HTTP-range, 120Hz or complete offline
media-integrity claims are added.
