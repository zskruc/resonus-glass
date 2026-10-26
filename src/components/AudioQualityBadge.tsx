/** Discreet tappable label; the details use the identical playback source rule. */
import { Pressable, Text, type ColorValue } from 'react-native';
import type { Song } from '@/api/subsonic';
import { usePlaybackQuality } from '@/hooks/usePlaybackQuality';
import { useT } from '@/i18n';
import { fontSize, themed } from '@/theme';

export function AudioQualityBadge({ song, onPress, color, compact = false }: {
  song: Song; onPress?: () => void; color?: ColorValue; compact?: boolean;
}) {
  const { label } = usePlaybackQuality(song);
  const t = useT();
  const text = <Text numberOfLines={compact ? 1 : undefined} ellipsizeMode="tail"
    style={[styles.badge, compact && { textAlign: 'center', maxWidth: '100%' }, color ? { color } : null]}>{label || '\u00A0'}</Text>;
  return onPress && label ? (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Audio quality')}
      style={({ pressed }) => [{ alignSelf: compact ? 'center' : 'flex-start', maxWidth: compact ? '100%' : undefined,
        opacity: pressed ? 0.6 : 1 }]}>{text}</Pressable>
  ) : text;
}

const styles = themed((colors) => ({
  badge: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '500' },
}));
