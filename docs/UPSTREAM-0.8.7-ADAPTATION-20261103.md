# Upstream 0.8.7 adaptation / 上游 0.8.7 适配

Local preview / 本地测试版：`0.8.7.1-preview.1`，Android `versionCode 147`。

Starting Glass checkpoint: `14adad68429d93577db5571830e236fe23574ad5` (code 146).
Reviewed upstream main: `42143760bc9acf3dfb962893efe1d9f87927b29e`.
This is a selective adaptation of the two approved batches, including prerequisite logic. It does not replace the current page designs, glass profiles, FlashList browsing engine or AMLL player layout. The older global review marker is not advanced as a claim that all intervening upstream features were merged.

## Included / 本次采用

| Area | Source | Glass integration |
| --- | --- | --- |
| Profile play counts | [#282](https://github.com/juananzzz/resonus/pull/282) | Profile ownership, serialized strict persistence, migration claim and retained legacy recovery copy. A 10,000-record bound preserves substantially more per-artist/per-album history than the upstream top-300 limit. Failed older saves cannot overwrite newer snapshots. |
| Library behavior | [c9c56cb6](https://github.com/juananzzz/resonus/commit/c9c56cb6bc2913bb7da939c6bfb423bf1d7dfcef) | Keep lists on refresh failure, offline availability/download badges, artist menus, filtering/sort names, preserved result searches, immediate opening after playlist creation, and local podcast favorites with actual favorite/listen timestamps. Artist menus start the existing mix engine rather than navigating to an absent upstream radio page. Existing Apple Music and Spotify layouts remain. |
| Downloaded albums | [169af424](https://github.com/juananzzz/resonus/commit/169af424afbfd983fa2beffaad8babe59eef124b) | Explore chip reads the existing local SQL catalog online too, without changing the main library or scanning all downloaded songs for the shelf. |
| Settings padding | [9c85d702](https://github.com/juananzzz/resonus/commit/9c85d702aebd0209c7d802ea540da17df61895e5) | Dynamic dock/safe-area padding through the current Settings context and DockScrollView, preserving UI-thread scroll interactions and caller padding. |
| Playlist auto-save | [#296](https://github.com/juananzzz/resonus/pull/296), final behavior [2b9c5b41](https://github.com/juananzzz/resonus/commit/2b9c5b41a3614267fb69f87f6d92b10e84dd0a23) | Overlay-only reorder mode, occurrence keys, one in-flight write/latest pending order, fresh editable snapshots and permission/sequence checks. Ordinary FlashList stays mounted. The delete/Undo contract is separate from permutation-only reordering. |
| DLNA casting | [739722b1](https://github.com/juananzzz/resonus/commit/739722b196bf7e16af9a240b70140d7e5eacf497), [a3518a8a](https://github.com/juananzzz/resonus/commit/a3518a8aaa255eee8b2e54e2e9b2df9011c02982) | Matching native/JS renderer tracking contract, natural-end progression and controlled repeat/lost-session handling. Existing Glass stream and decoder fixes remain. |
| Podcasts | Resume [1d510bad](https://github.com/juananzzz/resonus/commit/1d510badd8c339b5fdcf701c50fd8557db0c7c59), played/new [93a6301d](https://github.com/juananzzz/resonus/commit/93a6301d7800789f81ecf96d7fbf5f5a046d72ea), [869d477f](https://github.com/juananzzz/resonus/commit/869d477f207fccfbe4525679313158532d18a548), [57f343bf](https://github.com/juananzzz/resonus/commit/57f343bfbb06f27e44f9094e746b4d9432fab2c1), [42143760](https://github.com/juananzzz/resonus/commit/42143760bc9acf3dfb962893efe1d9f87927b29e) | Profile SQLite migration retains old subscriptions. Separate added/favorite/progress/download state; Glass menus, local episode hearts, common managed queue and background lease. Podcast audio does not pollute the music album catalog. |
| Audiobooks | [#162](https://github.com/juananzzz/resonus/pull/162), reviewed head `d013bcab37f4925d2c44fb16d0a616a76cead3f3` | Medium-tag detection, paginated shelf, profile/source-owned strict progress storage, chapter-spanning rewind and guarded queue/seek. Excludes podcasts/radio/video and plain story/music genres from automatic audiobook detection. Existing page header and play controls remain. |

## Behavior and limits / 使用与边界

- 歌单普通浏览继续使用 FlashList；只有明确进入「重新排序」才挂载拖动覆盖层。每次落下自动保存，关闭表示退出，不撤销已经保存的顺序。写入失败后重新读取；未恢复到真实结果前不能继续编辑。离线编辑使用完整条目，缺失音频不等于删除歌曲。
- Subsonic has no atomic playlist revision/precondition for replacement. Fresh sequence checks and the shared local edit queue narrow races with other clients; another client can still modify a playlist between the last read and write. Errors cause a reread rather than blind retries.
- 播客手动下载沿用下载管理页的并发、暂停、取消及后台任务保护。自动下载是逐节目启用的新集功能，首次添加／升级不下载整套旧节目，每批最多 3 集；启动、前台恢复或节目刷新时发现新集。App 被系统完全终止后没有独立的常驻 RSS 扫描器。
- Auto-downloads require confirmed Wi-Fi. Losing that transport pauses automatic groups. Manual jobs and a user's global pause are not resumed by an automatic network change. Android/vendor restrictions can still interrupt process execution; no always-running guarantee is made.
- 有声书设置位于设置 → 有声书；保存进度默认关闭，可选择启用并调整继续播放时回退量。进度每 30 秒记录，并在暂停、切曲、离开前台时提交；未知时长章节不会被猜测跳过。继续某章节使用明确顺序，不沿用随机顺序。
- 本地播放次数旧记录原来没有账号信息，无法追溯拆分历史归属。首次打开的有效账号继承一次，其他账号另存；迁移声明和旧恢复副本均保留。超过 10,000 首时保留较高计数，不将其描述为无限历史或完整音乐分析数据库。
- Queue restoration now rejects old profile/load/seek/queue results, including delayed fallback/adoption. This is separate from a complete redesign of all legacy offline queue storage.
- Keeps all existing saved glass parameters, dock interactions, page style choices, artist photos/wordmarks, offline audio and music cache behavior. Animated video artwork, upstream full-bleed UI replacement, Android Auto and iOS publishing changes are not part of the approved feature batches.

## Validation / 验证

- Full JavaScript/TypeScript regression suite: **1,265 passed, 0 failed**, followed by the Navidrome canonical-ID check.
- TypeScript: passed. Translation/dictionary/generated context checks: passed.
- Full ESLint: **0 errors, 143 warnings**. Scoped checks for the new implementations passed; warnings are not represented as a warning-free full repository.
- Native UPnP release compilation and **19 production-code JUnit tests** passed.
- Cases cover playlist duplicates/permission/complete offline snapshots and automatic-save/Undo ownership; count migration/failed-save ordering; local SQLite podcast migration and feed pruning; pause/cancel/network changes and accepted commits; long-form resume/source/seek ownership; and download-catalog invalidation/account races.

APK metadata/signature are recorded after the build. No Samsung, live RSS publishing server, or physical DLNA receiver has been used in this adaptation task. A real receiver is still required to validate renderer-specific behavior. A successful build or test run is not a claim of sustained device frame rate or Samsung acceptance.

No GitHub publication or release is performed by this build-only adaptation task.
