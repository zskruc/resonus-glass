# 播客发现 / Podcast discovery

`0.8.7.1-preview.4` · Android `versionCode 150` · ARM64 · 2026-11-09

本预览保留 [149 的八项工具](./PRIMUSE-FEATURES-PREVIEW-149.md)，新增参考 Primuse 的播客 Discovery。播放器、现有详情页布局、取色及已保存的玻璃参数继续沿用。

## 使用入口

打开「播客」后点击「发现播客」。原有添加 RSS、已订阅节目、收听进度、收藏及下载入口仍可使用。

- **热门榜与分类**：总榜及 19 个一级分类，按 Apple 目录提供的原始排名显示。
- **地区**：右上角地区入口，可选美国、中国、日本、英国、加拿大、澳大利亚、德国；默认沿用此前播客目录使用的美国。地区同时用于榜单、搜索及节目查询。
- **搜索**：输入节目名称，或粘贴 Apple 播客的节目／单集分享链接。输入停止 350 毫秒后再请求，避免每输入一个字符都发送查询。
- **先预览再订阅**：点击一档节目查看单集；需要保留时再点「订阅」。预览记录与正式订阅分开，仅预览不会加入首页最近播客或「全部刷新」订阅队列。
- **播放及下载**：节目自己的 RSS 提供单集及音频，继续使用已有播放器、收听进度和下载管理；浏览榜单不会自动下载节目音频。
- **离线**：手动离线不请求目录或新的 RSS；已有订阅与已保存内容继续从原播客入口使用。目录与音频的实际可用性取决于地区及发布者。

## 实现边界

内容来自 Apple 公开播客目录，不要求 Apple Music 登录或 API Key，也不会把用户音乐服务器的认证信息发送到目录。榜单只读一份最多 50 项的元数据，打开某档节目时才查询其 RSS 地址。图片优先采用目录的 600px 版本，列表按实际显示尺寸加载。

榜单缓存一小时；搜索和榜单分地区、分类及关键词存放。请求有取消、20 秒截止和目录响应大小上限。更换账号、手动离线或离开页面后，旧操作不能跳转或写入新账号。订阅写入在数据库队列实际执行时再次核对归属，并对相同账号／节目进行串行处理。

不增加 Swift、iOS 二进制或新的原生依赖。功能依据 [Primuse `1916718e`](https://github.com/chenqi92/primuse/tree/1916718e0acb8706cc8a84d2495503c749d8d47d) 的交互以及 [Apple 公开 Search API](https://performance-partners.apple.com/search-api)，在现有 React Native、SQLite 和播客解析器中实现。

## English

Open **Podcasts → Discover podcasts** for ranked charts, 19 categories, a region picker, debounced title search and Apple Podcasts share-link lookup. Open a show to preview episodes, then subscribe explicitly. Existing RSS entry, playback, listening progress, favorites and downloads remain.

Public directory requests carry no media-server credentials. Charts load metadata only; a selected show is resolved to its publisher feed on demand. Preview-only shows stay out of subscribed recent episodes and refresh-all. Manual offline mode prevents new directory/feed requests. Requests and queued subscription commits retain account/cancellation ownership.

The preview keeps all eight tools from 149, existing player layouts and saved glass parameters. It has not been pushed to GitHub or published as a Release.

## 验证记录 / Validation

真实目录协议检查：美区 50 项榜单与单条节目查询均为 HTTP 200，排名 1–50、唯一节目 ID 及 600px 封面字段已核对；只请求目录元数据，没有下载 RSS 或音频。该项使用 Node 请求，不能代替 Android 的设备检查。自动测试 1,449 项通过、0 失败，包含真实 SQLite 事务取消与订阅归属、真实组件的分类／搜索／预览／订阅操作；Navidrome ID 检查、TypeScript、翻译检查均通过。源码及测试 ESLint 为 0 错误，148 条既有警告（146 条源码、2 条旧测试导入顺序）。APK 身份和后续实机结果在构建后登记。

## APK

- File: `Resonus-Glass-v0.8.7.1-preview.4-code150-arm64-v8a.apk`
- Built source: `2f4e00e3948bddd4b59d3ca56075bd25c6439241`
- Size: `46,303,992` bytes
- SHA-256: `d143a6eaf1e18260900341e25fb4d9dc462893231e552e0fdb3455811bcceee2`
- Package: `com.zskruc.resonus.glasspreview` · Android `150` · ARM64

签名与当前 Glass 安装一致，ZIP、版本、包名、ABI 与包内新增中英文字典已核对。149 的功能复测已完成；150 的新播客发现待用户方便时另行安装、实机验证，不能将 Node／组件测试当作这版 APK 的三星验收。
