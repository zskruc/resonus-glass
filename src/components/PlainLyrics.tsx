import { Text, type StyleProp, type TextStyle } from 'react-native';
import type { SongLyrics } from '@/api/subsonic';
import { useLyricDisplayMode } from '@/hooks/useLyricDisplay';
import { plainLyricText } from '@/lib/lyricDocuments';

/** Plain lyrics use the same companion preference as timed/karaoke surfaces. */
export function PlainLyrics({ lyrics, style }: { lyrics: SongLyrics; style?: StyleProp<TextStyle> }) {
  const mode = useLyricDisplayMode();
  return <Text style={style}>{plainLyricText(lyrics, mode)}</Text>;
}
