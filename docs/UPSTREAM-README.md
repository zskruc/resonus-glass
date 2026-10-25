> 本文保留自 [juananzzz/resonus](https://github.com/juananzzz/resonus) 的原项目说明。功能、截图、下载、社区与捐赠链接属于上游项目，并不代表 Resonus Glass 的发布或支持渠道。
> 其中原本相对仓库根目录的文件链接已改为指向上游仓库。

<p align="center">
  <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/images/icon-transparent.png" width="120" alt="Resonus icon" />
</p>

<h1 align="center">Resonus</h1>

<p align="center">
  A clean music player for your self-hosted server, and your local files.
  <br />
  Android, with an experimental iOS build.
</p>

---

<p align="center">
  <a href="https://github.com/juananzzz/resonus/releases/latest"><img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/images/badges/download.svg" height="28" alt="Download APK" /></a>
  <a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/juananzzz/resonus"><img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/images/obtainium.svg" height="28" alt="Get via Obtainium" /></a>
  <a href="#ios-experimental"><img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/images/badges/ios.svg" height="28" alt="iOS (experimental)" /></a>
  <a href="https://altdirect.app/?url=https://raw.githubusercontent.com/juananzzz/resonus/main/Source.json"><img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/images/badges/altsource.svg" height="28" alt="Add as an AltSource" /></a>
  <br />
  <a href="https://discord.gg/pecE8MTPVr"><img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/images/badges/discord.svg" height="28" alt="Discord" /></a>
  <a href="https://ko-fi.com/juananzzz"><img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/images/badges/kofi.svg" height="28" alt="Support on Ko-fi" /></a>
</p>

## Screenshots

| Home | Player | Album | Library |
| :---: | :---: | :---: | :---: |
| <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/dark-home.jpg" width="200" alt="Home, dark" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/dark-player.jpg" width="200" alt="Player, dark" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/dark-album.jpg" width="200" alt="Album, dark" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/dark-library.jpg" width="200" alt="Library, dark" /> |
| <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/light-home.jpg" width="200" alt="Home, light" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/light-player.jpg" width="200" alt="Player, light" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/light-album.jpg" width="200" alt="Album, light" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/light-library.jpg" width="200" alt="Library, light" /> |

| Artist | Lyrics | Queue | Servers |
| :---: | :---: | :---: | :---: |
| <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/artist.jpg" width="200" alt="Artist" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/lyrics.jpg" width="200" alt="Synced lyrics" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/queue.jpg" width="200" alt="Queue" /> | <img src="https://raw.githubusercontent.com/juananzzz/resonus/main/assets/screenshots/servers.jpg" width="200" alt="Supported servers" /> |

## Download

### Android

Get the latest APK from the [Releases](https://github.com/juananzzz/resonus/releases/latest) page and install it on your Android device.

Also available on [Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/juananzzz/resonus) for automatic updates.

### iOS (experimental)

Download the `.ipa` from the [Releases](https://github.com/juananzzz/resonus/releases/latest)
page and sideload it with AltStore, Sideloadly or similar, or
[add Resonus as an AltSource](https://altdirect.app/?url=https://raw.githubusercontent.com/juananzzz/resonus/main/Source.json)
to get updates. The build is unsigned, so it is not on the App Store or TestFlight.

Not available on iOS yet: CarPlay, casting, the equalizer and gapless playback.

## Features

- **Navidrome / OpenSubsonic / Jellyfin / Ampache**: multi-profile login, multi-library support, plus several server addresses with automatic switching
- **Local mode**: play music straight from your device or a folder, no server needed
- **Offline mode**: your favorites, playlists and albums stay browsable with no connection; downloaded songs play, the rest show grayed out, and it switches automatically when the server is unreachable
- **Downloads**: albums, playlists, an artist's whole discography or single songs, in original quality or transcoded
- **Synced lyrics**: karaoke view with tap-to-seek, word-by-word highlighting (TTML and enhanced LRC), full-screen mode, optional LRCLIB lookup
- **Internet radio**: browse and manage your stations
- **Cast to speakers**: UPnP/DLNA renderers and Sonos, with room grouping; local music streams to them too
- **Playback**: gapless, crossfade, built-in equalizer, ReplayGain normalization, playback speed, sleep timer, queue with undo, shuffle, repeat, background & lock-screen controls
- **Autoplay & mixes**: keep the music going with similar songs, or start a mix from any track
- **Organize**: multi-select (queue, playlist or download in batch), star ratings, pinned items, play history
- **Themes**: dark, light, the phone's own or on a schedule, with a palette of accent colors or one of your own
- **Make it yours**: reorder and show/hide Home sections, chips and tabs, app fonts, lyrics size, mini player buttons, swipe actions and more
- **Android Auto** (experimental)
- **Landscape and tablet layouts**
- **Queue sync across devices**
- **In 11 languages**: English, Spanish, German, Catalan, Russian, Italian, Simplified Chinese, Ukrainian, Polish, Swedish, Brazilian Portuguese

## FAQ

The questions that come up most often are answered in
[docs/FAQ.md](https://github.com/juananzzz/resonus/blob/main/docs/FAQ.md), starting with how to get Resonus to show up in
Android Auto. The app links to it too, from Settings › About.

## Translations

More languages are welcome via pull request. See
[TRANSLATING.md](https://github.com/juananzzz/resonus/blob/main/TRANSLATING.md) for how to add one, plus context for the
trickier strings.

## Community

Join the [Discord server](https://discord.gg/pecE8MTPVr) to share feedback,
report bugs, ask questions, or just follow along with development.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](https://github.com/juananzzz/resonus/blob/main/CONTRIBUTING.md) for how to
set up the project, run it on an emulator, and open a pull request.

## Support

Resonus is free and open source, built in my spare time. If you enjoy it and
want to help me keep working on it, you can buy me a coffee on
[Ko-fi](https://ko-fi.com/juananzzz).
