# Resonus Glass 0.8.7.1-preview.6 · 152

2026-11-09 · ARM64 Android · Preview / 预发布

本版汇总 149–152 的已完成适配，保留现有播放器布局、玻璃参数、登录和离线资料。

- 艺人页「热门歌曲」采用与「常听歌曲」一致的圆角背景；新增「所有歌曲」七首预览与完整列表，支持播放次数、实际添加日期、发行日期、时长、名称、专辑和下载状态的双向排序，并保存选择。
- 播客采用 Primuse 专辑风格详情页，提供发现榜单与搜索、节目与收听进度筛选、富文本笔记和可点时间、发布者章节／文字稿链接、OPML 交换及每节目播放偏好。
- 增加设置搜索、每日推荐、歌词来源选择、已有译文／罗马音显示、随机偏好、长音频续播与书签、年代浏览和缓存歌词全文搜索。
- 修复歌词数据库 FTS 语句生命周期与播客单集滚动闪退；补充浅色模式可读性及异步账号归属保护。

## 验证

1,529 项自动测试、TypeScript、翻译和定向 ESLint 检查通过。三星 SM-S9380（Android 17）已核对安装 APK 字节：Taylor Swift 的 87 首曲目、7 首预览、8 种排序和逆序、冷启动排序记忆以及实际播放队列顺序通过。播客和歌词工具的针对性实机结果见对应版本文档。

这是针对性功能检查，不代表全部页面长期维持 120 fps、内存恒定或所有外部音源均可用。《科技乱炖》的误拦截修正属于用户自己的网络配置，不将其私人配置打包发布。

## 安装

下载本页 ARM64 APK，可覆盖使用相同包名及签名的 Resonus Glass。请保留原 App，直接覆盖安装。预发布版不进入当前正式版本自动更新通道。

## English

This preview combines builds 149–152: matching artist song panels, a seven-track library preview and persisted bidirectional sorting; album-inspired podcast shows with discovery, notes, publisher chapters, OPML and show preferences; and settings search, daily recommendations, lyric tools, weighted shuffle, long-audio bookmarks, era browsing and cached lyric search. It also fixes FTS resource ownership and the podcast episode scroll crash.

All 1,529 automated tests, TypeScript, translations and focused lint checks passed. Targeted Samsung checks covered the 87-track Taylor Swift catalog, seven-track preview, all eight sort controls and reverse directions, cold-start persistence and the actual playback queue. These checks do not certify global sustained frame rate or long-term memory behavior. The existing player layout and saved glass tuning remain.

The ARM64 APK updates the existing, identically signed Glass application in place. This is a prerelease and is excluded from the stable automatic update channel.

## APK identity

- Version: `0.8.7.1-preview.6` / Android `152`
- Built source: `3db6eda148582b35157ebf858e01fee6dfa70854`
- Package: `com.zskruc.resonus.glasspreview`
- SHA-256: `90bfa8087e5533ed1816b14d5f8fff6d8cc4c70a3fb4cc4034ad6fb7c7fb31e3`
- Size: `46,434,404` bytes
