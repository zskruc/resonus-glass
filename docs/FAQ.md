# FAQ

Not here? Open an [issue](https://github.com/zskruc/resonus-glass/issues).

## How do I get Resonus to show up in Android Auto?

Android Auto only lists apps it got from the Play Store, so it has to be told to
accept the rest. The switch is on the phone and you only set it once:

1. Open Android Auto's settings on the phone (Settings › Connected devices ›
   Android Auto, or the Android Auto app).
2. Tap **Version** about ten times, until it offers to turn on developer
   settings. Accept.
3. Go to **Developer settings** and turn on **Unknown sources**.
4. Connect the phone to the car again.

Resonus should be in the car's app list from then on.

## How do I install Resonus Glass?

Download the Android ARM64 APK from [this repository's Releases](https://github.com/zskruc/resonus-glass/releases/latest).
For an in-place update, use a release signed with the same key as the existing
installation. Do not uninstall to work around a signature mismatch: doing so
would remove the app's data and offline downloads.

This Glass branch currently publishes Android builds only. It does not provide
an iOS release or an AltStore source.

## How do I get lyrics that light up word by word?

The lyrics have to be timed word by word, and a normal `.lrc` isn't: it only
times the lines. What works is a `.ttml` file (the format Apple Music uses) or
an enhanced `.lrc`, which has a `<mm:ss.xx>` in front of each word. Put it next
to the song with the same name, like `01 - Song.flac` and `01 - Song.ttml`.

- **Navidrome**: 0.63 or newer. It picks the file up on the next scan and sends
  the words to Resonus. Older versions only send whole lines.
- **Jellyfin**: when it has word timings for the song, Resonus uses them.
- **Music on the phone**: the same `.ttml` or `.lrc` next to the file.

Downloaded songs keep the word timings, so it works offline too. Songs you
downloaded before this was added only have whole lines until you download them
again.
