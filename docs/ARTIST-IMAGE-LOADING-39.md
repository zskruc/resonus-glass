# 艺人主图加载优化 / Artist image loading

本地测试版 `0.8.4.1-amll.39` / Android `122`，已覆盖安装到 Samsung SM-S9380。
保留现有播放器、页面布局、玻璃配置及最终照片遮罩、模糊和取色算法。

## 修复范围

- **稳定高清来源**：Navidrome 有真实封面 hash 时请求 1200px 主图，绕过未区分尺寸的普通离线封面映射。独立的 artistInfo 返回小头像时，不再替换这张主图。经文件存在及封面 hash 校验的本地 full 缓存，随首批艺人资料返回；无需等额外头像请求。
- **精确缓存策略**：只为艺人背景准备启用 exact 模式。在线未命中当前高清地址时，继续获取该地址，不能把 200／600px 的旧缓存登记为高清。离线按已有缓存回退；在线和离线准备结果分开，并核对账号、地址和异步归属。播放器等其他调用者保留原默认策略。
- **避免第二次换图**：在线清晰层保持同一个逻辑地址，背景处理文件到达时不替换主图。Glide 使用 `memory-disk`；没有新增持有高清位图的 JS 缓存。
- **协调显示**：清晰层实际显示后再挂载低分辨率模糊场，避免把背景场先放大成整张照片。首次主图淡入 120ms，已显示来源再次访问不增加固定淡入；每个请求的过渡配置固定。仅记住最多 64 个来源字符串，真实位图缓存仍由 Glide 管理。
- 保留单次错误回退、离线本地图、顶栏小副本的解码就绪屏障；旧艺人、旧请求及卸载后的回调不能更新当前图层。

## 检查与实机记录

- 840 项应用测试及 canonical ID 检查通过；类型、翻译检查及完整 ARM64 构建通过。
- 静态检查为 0 错误、134 条已有／项目警告；本轮所属文件定向检查通过。
- 包名仍为 `com.zskruc.resonus.glasspreview`，签名与现有三星安装一致，未清除登录、设置或音频。
- APK：`artifacts/Resonus-Glass-v0.8.4.1-amll.39-arm64-v8a.apk`，45,445,916 bytes。
- SHA-256：`7e4f904cc5d2cbe3b3b00efb6fd580692ca5903f4a9c2c3c82ae7793673d8ee8`。

以下是当前图片请求日志到清晰主图 `onDisplay` 回调的时间，**不是点击到整页完成的时间或帧率**：

| 艺人 | 主图尺寸 | 本轮首次进入 | 再次进入 |
| --- | --- | --- | --- |
| Justin Bieber | 1200×1200 | `cache=none`，730ms | `cache=memory`，21ms、30ms |
| Coldplay | 1200×1200 | `cache=none`，566ms | `cache=memory`，47ms |

60px 请求属于专用顶栏小副本，没有计入上述主图。`cache=none` 本身不单独证明网络请求数。

有效录屏对照看到：新版本首次进入是短暂底色占位后，同一张清晰照片短淡入；没有观察到整张模糊背景先显示再硬切高清。两次 Justin 重访直接显示清晰照片。最终人物、裁切和渐变目测一致；录屏清晰区相关度约 0.99949，过渡区约 0.99880，差异包含 H.264 编码误差。

Coldplay 离线仍可显示缓存头像；恢复在线后重新使用高清内存缓存。另检查了滚动顶栏、一次后台返回与底栏显示；本轮 App 进程未记录新的 FATAL。未删除或清空图片缓存来制造首次进入，也未运行整个曲库预缓存。

早期被锁屏打断的零字节录像及误停在搜索框的采样均已排除。有效录像只能证明本轮场景，不能保证所有艺人、所有网络或长期操作都完全相同。未采集持续帧率或完整网络流量，因此不宣称 120 fps、零联网或网络传输次数。

测试结束已恢复并回读：30 秒息屏、USB 充电常亮关闭、图片诊断属性为空、App 回到原在线状态；关闭诊断后重启 App。原始截图、录屏和设备日志仅存本机忽略目录。

## English

Preview `.39` uses Android code `122` and has been installed over the existing Samsung Glass app. It keeps the current layouts, glass profiles and final photo/blur/palette algorithms.

Navidrome artist heroes now use the real full-size cover hash or a verified managed full file. Late small artistInfo images cannot replace a selected full hero. Artist processing uses exact online cache resolution; smaller offline fallbacks are isolated from online results. The visible sharp image keeps a stable logical source and enables Glide's bounded memory/disk caching. A prepared low-resolution blur field is mounted only after the sharp photo displays. A first request uses a fixed 120ms transition; revisits do not add a fixed fade. Only up to 64 URI strings are retained, with no new JS-held bitmap cache.

All 840 app tests, canonical ID, type and translation checks passed, as did the native ARM64 build. Lint reports zero errors and 134 existing/project warnings. The package and signing certificate match the existing install. APK size/hash are recorded above.

On-device primary-image logs show 1200×1200 for both tested artists: Justin's first image callback took 730ms, followed by memory hits at 21/30ms; Coldplay took 566ms followed by a 47ms memory hit. These are request-to-image-display callbacks, not whole-screen load time or FPS. The 60px navigation copy was excluded.

Valid recordings show a short solid fallback followed by the sharp photograph, without the full-photo blur-field placeholder/hard swap in this test. Settled photo/crop/gradient appearance is retained. Offline display, return online, header scrolling and one background/foreground cycle were also checked. Lock-screen recordings and mistaken search-field samples were excluded. No image/audio caches were cleared and no bulk library job was started. Phone timeout/stay-awake, online mode and diagnostic settings were restored and verified. This does not establish all-artist performance, sustained FPS or transport-level network behavior.
