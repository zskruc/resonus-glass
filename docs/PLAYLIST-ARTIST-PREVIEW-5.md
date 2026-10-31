# 艺人式歌单页预览 / Artist-style playlist preview

`0.8.5.1-preview.5` / Android `versionCode 127`，2026-11-01。

## 布局 / Layout

本轮只调整实际歌单详情页。默认「艺人页布局」：封面满幅延伸到状态栏后方，标题落在封面下侧；Apple Music 风格采用与当前艺人页相同的静态模糊延伸、局部取色、居中标题与 48／72／48 控制区。随机播放、播放／暂停、收藏及下载、排序、更多操作保留。Spotify 风格采用其艺人页的满幅图片、渐变、左对齐标题和右侧播放区。

标题根据实际布局测量渐隐，紧凑顶栏随后出现；顶栏使用同源的小尺寸静态图片副本，不用纯色切断照片。搜索打开／关闭期间副本保持挂载并预解码，只切换透明度和平面搜索底色，避免收起后重新等待图片。歌曲行继续使用原 FlashList 与重复条目身份，滚动仍由 UI 线程驱动。图片场只在封面或尺寸变化时准备，不在滚动时重新模糊。

This preview updates actual playlist details only. The default artist layout uses full-width artwork behind the status bar. Apple Music reuses the artist page’s static blur extension, local palette, centered title and 48/72/48 controls; Spotify uses its corresponding full-width image, gradient, left-aligned title and right-hand play controls. Playback, shuffle, favorites, downloads, sorting and menus remain available. The measured large title exits before the compact title; a same-source, low-resolution navigation copy stays mounted during search transitions. The existing FlashList, duplicate occurrence identities and UI-thread scroll path remain. Image preparation runs on source/geometry changes, not scroll frames.

## 立即回切 / Instant rollback

**设置 → 外观 → 歌单页风格 → 紧凑布局**可立即恢复 `.preview.4` 的歌单排版；选回「艺人页布局」恢复本轮预览。该选择按账户保存，也支持设置导入／导出和恢复默认，不改变播放器布局、玻璃参数、曲库、下载或播放队列。

**Settings → Appearance → Playlist page style → Compact layout** restores the previous layout immediately. Select Artist page layout to return to this preview. This profile-scoped preference supports persistence/import/export/reset without altering player layout, glass tuning, music, downloads or queue.

此前已测试的安装包保留为 `artifacts/Resonus-Glass-v0.8.5.1-preview.4-arm64-v8a.apk`；源码备份分支 `backup/playlist-compact-preview4-20261101` 指向 `f75cf0e9`。优先使用设置回切，不需要卸载或降级。

The tested `.preview.4` APK and source checkpoint `f75cf0e9` are retained. Prefer the in-app layout preference over uninstalling or downgrading.

## 验证 / Validation

975 项自动化测试通过，包括新增偏好账户隔离／持久化／导入归一化，以及两主题和两歌单布局多轮切换后 FlashList、滚动宿主、重复歌曲选中、旧播放回调和服务器移除索引不变的行为回归。类型与翻译检查通过；新增代码定向 ESLint 无错误，歌单页仍有 3 条原有警告。

All 975 automated tests passed, including profile/persistence/import normalization and preserved recycler/scroll host/duplicate-selection/callback behavior across theme/layout switches. Type and translation checks passed. Focused ESLint found no errors; the playlist route retains three pre-existing warnings.

APK：`artifacts/Resonus-Glass-v0.8.5.1-preview.5-arm64-v8a.apk`，45,689,440 bytes；SHA-256 `5d6cf969615cdbdd25a40932dea5d4c788a18d077ffba438acde38108a599801`。签名已核验与此前版本一致。

三星 SM-S9380 已覆盖安装，在用户原有浅色／Apple Music 设置下检查 All Music 与 ASMR：满幅页头、滚动后小标题、搜索展开／取消，以及紧凑布局回切均正常；最终已选回艺人页布局。本轮应用进程日志未发现 fatal、OOM 或 ANR 标记。这是短时交互验收，不能代表长时间滚动或 Spotify 风格的完整实机验收。测试结束恢复原 30 秒息屏与关闭充电常亮。

Installed on Samsung SM-S9380. In the existing light/Apple Music configuration, All Music and ASMR showed the full-width hero, compact scroll title and working search. Compact rollback was verified, then artist layout restored. No fatal/OOM/ANR markers appeared in the scoped process log. This short interaction check does not establish long-running performance or full physical validation of Spotify mode. Original 30-second timeout and charging wake behavior were restored.
