# 三星 M4A 首尾静音分析 / Samsung M4A edge analysis

开发预览 / Development preview: `0.8.5.1-preview.4`, Android `versionCode 126`.

## 问题与修复 / Cause and fix

`.preview.3` 在三星 SM-S9380 上正常播放已下载的 ALAC/M4A，但首尾静音分析显示不可用。实机日志确认系统 `NuMediaExtractor` 将音轨识别为 `audio/unknown`，原 ALAC 分支因此没有运行。此前 PCM 边界检查与模块编译均通过，但无法覆盖三星实际容器识别行为。

Samsung's framework extractor labeled the downloaded ALAC/M4A track `audio/unknown`, bypassing the analysis decoder. Ordinary playback uses Media3 and worked. Successful compilation and PCM-boundary tests did not establish real-container support.

修复在静音模块内独立使用已集成版本的 Media3 MP4 提取器，根据实际 sample entry、初始化 cookie 和 seek map 识别 ALAC，再调用独立的现有 ALAC 解码上下文。没有按文件后缀或 `unknown` MIME 猜测编码，不触碰正在播放的文件描述符、队列或解码器。

The fix uses a separate Media3 MP4 reader, actual codec sample entry/cookie and indexed seek map before invoking an independent ALAC decoder. Filename or an unknown MIME is insufficient for identification. Live playback descriptors, decoder and queue remain independent.

## 范围 / Boundaries

- 默认关闭，仍仅检查本地／已下载音频，参数保持 −60dBFS、最短静音 500ms、每侧默认 12 秒。网络流不为分析额外下载。
- MP4 的媒体负载、padding 等大块按索引跳过；头、尾分别有 IO、时间、次数与帧数预算。损坏索引与无法确认解码覆盖的片段不能判成静音。
- 不支持的容器保持普通播放；无有效索引的 fragmented MP4 不靠遍历整曲查尾部。歌词与进度保持原时间轴。
- 诊断只记录阶段和错误类别，不记录账号、音频路径或歌词。

Off by default; downloaded/local files only. Existing threshold/window preferences and original lyric/progress timestamps remain. Index-based seeking skips media payload/padding without a whole-song scan. Parsing, IO, decoding and seeking have finite budgets. Corrupt indices or unconfirmed PCM coverage fail closed. Unsupported containers retain ordinary playback; fragmented MP4 without a usable index is not scanned end to end. Diagnostic logs include only stages/error classes, with no private source paths or credentials.

## 本轮验证 / Validation

- 真正生产 MP4 reader 与 PCM 扫描器的固定音频／损坏索引回归共 808 项检查通过，既有 PCM 回归 28 项通过。包含 16／24bit、moov 前后、封面／padding、AAC 反例、取消、超大／损坏表，以及压缩包 hash 和时间戳与 FFprobe 对照。 / The actual production reader/scanner passed 808 fixture checks, plus 28 existing PCM checks, covering real 16/24-bit ALAC containers, index positions, artwork/padding, invalid inputs and independent packet/timestamp references.
- `:silence-trim:compileReleaseKotlin`、类型检查、翻译检查通过；971 项自动化测试与 canonical-ID 检查通过。 / Kotlin, type and translation checks, all 971 automated tests, and canonical-ID checks passed.
- 完整 ARM64 release APK 已构建，版本 `0.8.5.1-preview.4` / `126`，包名 `com.zskruc.resonus.glasspreview`，签名与当前测试包一致。 / The ARM64 release APK was built and its package, version and matching certificate were verified.
- 文件：`artifacts/Resonus-Glass-v0.8.5.1-preview.4-arm64-v8a.apk`，45,687,008 bytes。
- APK SHA-256：`f5ebabac16ee7dbc55af8c4ef75d96dd9c90b12b96d16045ea61729dd8e37671`。
- Certificate SHA-256：`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`。
- **三星 SM-S9380 已安装并复测通过。**复测时当前歌曲已由用户切换为另一首下载歌曲；对该 ALAC/M4A 的独立原生分析完成，界面显示开头 0.00 秒、结尾 0.72 秒，日志确认 `Identified indexed ALAC`。重复分析结果一致，没有 `Unavailable`、崩溃、OOM 或 ANR 记录。 / **Installed and verified on Samsung.** The current track had changed since the initial failure; its downloaded ALAC/M4A completed native edge analysis, reporting 0.00 seconds leading and 0.72 seconds trailing silence. Indexed ALAC identification was confirmed and repeat analysis matched, with no captured unavailable/crash/OOM/ANR markers.
- 已恢复该账户原来的静音开关关闭、−60dBFS／500ms／12 秒参数；手机恢复原 30 秒息屏和关闭充电常亮。普通播放、当前歌曲、界面风格和玻璃参数未在本次补充测试中改动。 / Original silence preferences and phone timeout/charging-awake settings were restored; this supplemental test did not alter playback, the current song, UI style or glass profiles.
- 此次确认实际解析／解码和缓存路径可用，未以整首试听验证所有曲目的自动曲终切换，也不据此保证所有容器或长时间操作都无故障。 / This verifies real parsing/decoding and repeat-result behavior, rather than full-length playback/end-transition testing for every track or indefinite stability.

此前两种歌单布局、歌词校时保存／恢复、完整 PNG 系统分享预览、智能规则 100 首预览、72 组重复候选、实际收听统计及 20 次快滑／后台返回的实机记录见[前版记录](./PLAYLIST-MUSIC-TOOLS-PREVIEW-3.md)。

The [preceding record](./PLAYLIST-MUSIC-TOOLS-PREVIEW-3.md) documents both playlist styles, persisted/restored timing, actual PNG share preview, smart-rule/duplicate results, listening statistics, and bounded fast-scroll/background tests.
