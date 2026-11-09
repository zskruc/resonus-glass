import { Text, type StyleProp, type TextStyle } from 'react-native';
import type { SongLyrics } from '@/api/subsonic';
import { useLyricDisplayMode } from '@/hooks/useLyricDisplay';
import { plainLyricText } from '@/lib/lyricDocuments';
import { LyricFontText } from './LyricsTypography';

/** Plain lyrics use the same companion preference as timed/karaoke surfaces. */
export function PlainLyrics({ lyrics, style }: { lyrics: SongLyrics; style?: StyleProp<TextStyle> }) {
  const mode = useLyricDisplayMode();
  return <Text style={style}><LyricFontText text={plainLyricText(lyrics, mode)} /></Text>;
}
