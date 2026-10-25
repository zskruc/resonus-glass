/** Discreet tappable label; the details use the identical playback source rule. */
import { Pressable, Text, type ColorValue } from 'react-native';
import type { Song } from '@/api/subsonic';
import { usePlaybackQuality } from '@/hooks/usePlaybackQuality';
import { useT } from '@/i18n';
import { fontSize, themed } from '@/theme';

export function AudioQualityBadge({ song, onPress, color }: { song: Song; onPress?: () => void; color?: ColorValue }) {
  const { label } = usePlaybackQuality(song);
  const t = useT();
  const text = <Text style={[styles.badge, color ? { color } : null]}>{label || '\u00A0'}</Text>;
  return onPress && label ? (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Audio quality')}
      style={({ pressed }) => [{ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 }]}>{text}</Pressable>
  ) : text;
}

const styles = themed((colors) => ({
  badge: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '500' },
}));
