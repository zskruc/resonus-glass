# Upstream selective adaptation / 上游选择性适配

Local preview / 本地测试版：`0.8.7.1-preview.2`，Android `versionCode 148`。

Starting Glass commit: `7ff3f4a77fe38565bc4401e1ff43090088a8e808` (code 147).
Reviewed upstream main: `032f93cbc8c27b3875b77ed46fed4f310fcb02f3`.
This implements the four fixes and six optional feature groups approved on 2026-11-09. It is a selective adaptation, not a replacement of the Glass player, page layouts, artwork palette or saved glass profiles.

## Sources / 来源

| Area | Upstream source | Glass approach |
| --- | --- | --- |
| Syllable wrapping | [75cc5cff](https://github.com/juananzzz/resonus/commit/75cc5cff1445f301cf2087209942378946b27de8) | Group syllables of one word without replacing lyric timing, masks or warm-row lifecycle. |
| Cancelled player reveal | [032f93cb](https://github.com/juananzzz/resonus/commit/032f93cbc8c27b3875b77ed46fed4f310fcb02f3) | Route/animation ownership checks in the existing reveal path; preserve current player/dock geometry and animation. |
| Download diagnostics | [8bb9cbbd](https://github.com/juananzzz/resonus/commit/8bb9cbbd2f8cf8ed518c7a464693c6e411614ade) | First three terminal music failures per batch, sanitized reason and format in Diagnostics; pauses/cancellation are not failures. Does not claim to repair every server-side download error. |
| Playback speed persistence | [fa5b4680](https://github.com/juananzzz/resonus/commit/fa5b468085a79617707028ad6c35d7ab19d1874a) | Save/restore speed with the existing queue. Existing pitch-preserving playback remains; no new varispeed switch. |
| Downloaded filter | [841f8cb1](https://github.com/juananzzz/resonus/commit/841f8cb120a12c418bdcac27add585daa28ad357) | Expand the previous downloaded-album section into a local filter over playlists, albums, artists and songs. |
| Fully downloaded playlist badge | [4b6003cb](https://github.com/juananzzz/resonus/commit/4b6003cbd5309108f1109b831b8d7c0b1999edb8) | Use full cached membership and downloaded-file identities, rather than equating any available track with a complete playlist. |
| Library chips | [5f9f39c8](https://github.com/juananzzz/resonus/commit/5f9f39c8306862447ead6520529fd74be47b1732) | Reorder/show/hide preferences adapted to the two existing page styles and Glass controls. |
| Album artist sort | [44a62ea1](https://github.com/juananzzz/resonus/commit/44a62ea1379b1c02737f764ea7e34a62d3c0f696) | Add the existing backend order to the album browser. |
| Podcast ordering and download confirmation | [9a8f5e9d](https://github.com/juananzzz/resonus/commit/9a8f5e9d6f8ed9a24b9681ecbd8ae0a8b7812623), [eb8cc3ae](https://github.com/juananzzz/resonus/commit/eb8cc3aecc2fb871bd1d004b7b484c256e08e199) | Per-show order and matching playback; confirmation over the existing local podcast database and common managed download queue. |
| DLNA progression | [b06514a9](https://github.com/juananzzz/resonus/commit/b06514a9649acd231161c825bb974b4e5583244a) | Guard repeated play after a fresh load and extend renderer end detection. Real receiver behavior needs device-specific validation. |

PRs #329, #330 and #331 are not part of this approved batch. The existing Android widget has no per-position write subscription, so the upstream widget-write patch is not needed. Jellyfin-only ranking and Discord features are not included.

## Validation / 验证

- JavaScript/TypeScript suite: **1,329 passed, 0 failed**, followed by the Navidrome canonical-ID check.
- TypeScript and translation/generated-context checks passed. ESLint: **0 errors, 146 warnings**; this is not represented as a warning-free repository.
- UPnP native release compilation and **23 JUnit tests** passed.
- Regression cases include late/ABA profile reads, complete playlist membership and equal-count file replacement, profile-owned SQL file indexes, migration of the old download chip and per-profile category settings, download confirmation cancellation/admission, speed changes during restoration, late player reveal ownership, and existing lyric prewarming/layer reuse.
- Peer review found and corrected two dependent ownership gaps: an old `getPlaylists` response could write a new profile's mirror; and a stable new-profile badge read could still consult the previous profile's not-yet-hydrated in-memory files. Playlist results now verify request ownership before side effects, and badge reads use the captured account directory's SQL file index.
- Failure diagnostics retain recognized HTTP/network/storage/media categories, not arbitrary native error text. Tests cover quoted JSON credentials, short Subsonic parameters and authorization headers as well as full URLs.

Build/APK and Samsung checks are recorded after completion. These checks do not equate a build or automated test with physical DLNA receiver acceptance, long-run frame-rate measurement, or every podcast feed's behavior.

No GitHub push, pull request or release is part of this task.
