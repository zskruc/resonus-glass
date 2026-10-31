/** Separate playlist compositions for the two UI styles; no live artwork blur. */
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Icon from './Icon';
import { Cover } from './Cover';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed } from '@/theme';

export function playlistCoverSize(width: number, height: number, apple: boolean): number {
  return Math.round(Math.max(96, Math.min(width * (apple ? .5 : .54), height * .26, apple ? 216 : 232)));
}

export function PlaylistDetailHeader({ title, owner, description, meta, coverUri, art, apple, onCoverPress,
  disabled, onPlay, onShuffle, shuffleActive, utility, onMenu, artwork }: {
  title: string; owner?: string; description?: string; meta?: string; coverUri?: string; art: number;
  apple: boolean; onCoverPress?: () => void; disabled: boolean; onPlay: () => void; onShuffle: () => void;
  shuffleActive: boolean; utility?: ReactNode; onMenu?: () => void; artwork?: ReactNode;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const cover = artwork ?? <Cover uri={coverUri} size={art} />;
  const play = <Pressable accessibilityRole="button" accessibilityLabel={t('Play')} disabled={disabled}
    onPress={onPlay} style={({ pressed }) => [apple ? styles.applePlay : styles.spotifyPlay,
      disabled && styles.disabled, pressed && styles.pressed]}>
    <Icon name="play" size={apple ? 19 : 27} color={apple ? colors.accent : colors.onAccent} />
    {apple ? <Text style={styles.playLabel}>{t('Play')}</Text> : null}
  </Pressable>;
  const shuffle = <Pressable accessibilityRole="button" accessibilityLabel={t('Shuffle')} disabled={disabled}
    onPress={onShuffle} style={({ pressed }) => [apple ? styles.applePlay : styles.spotifyShuffle,
      disabled && styles.disabled, pressed && styles.pressed]}>
    <Icon name="shuffle" size={apple ? 21 : 25} color={apple || shuffleActive ? colors.accent : colors.textSecondary} />
    {apple ? <Text style={styles.playLabel}>{t('Shuffle')}</Text> : null}
  </Pressable>;
  return <View style={styles.header}>
    <View style={styles.cover}>
      {onCoverPress ? <Pressable onPress={onCoverPress} accessibilityRole="imagebutton" accessibilityLabel={t('View cover')}>{cover}</Pressable> : cover}
    </View>
    <Text style={[styles.title, apple && styles.centered]} numberOfLines={3}>{title}</Text>
    {owner ? <Text style={[styles.owner, apple && styles.appleOwner]} numberOfLines={1}>{owner}</Text> : null}
    {description?.trim() ? <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}
      accessibilityLabel={t(expanded ? 'Show less' : 'Show more')}>
      <Text style={[styles.description, apple && styles.centered]} numberOfLines={expanded ? undefined : 2}>{description.trim()}</Text>
    </Pressable> : null}
    {meta ? <Text style={[styles.meta, apple && styles.centered]}>{meta}</Text> : null}
    {apple ? <>
      <View style={styles.appleActions}>{play}{shuffle}</View>
      <View style={styles.appleUtility}>{utility}{onMenu ? <Pressable accessibilityRole="button" accessibilityLabel={t('More options')}
        onPress={onMenu} style={styles.utility}><Icon name="ellipsis-horizontal" size={23} color={colors.textSecondary} /></Pressable> : null}</View>
    </> : <View style={styles.spotifyActions}>
      <View style={styles.spotifyUtility}>{utility}{onMenu ? <Pressable accessibilityRole="button" accessibilityLabel={t('More options')}
        onPress={onMenu} style={styles.utility}><Icon name="ellipsis-horizontal" size={23} color={colors.textSecondary} /></Pressable> : null}</View>
      {shuffle}{play}
    </View>}
  </View>;
}

const styles = themed((c) => ({
  header: { paddingHorizontal: 4, paddingBottom: spacing.lg },
  cover: { alignItems: 'center', marginTop: 4, marginBottom: 18 },
  title: { color: c.text, fontSize: 24, lineHeight: 30, fontWeight: '700', marginBottom: 6 },
  centered: { textAlign: 'center' },
  owner: { color: c.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 5 },
  appleOwner: { color: c.accent, textAlign: 'center' },
  description: { color: c.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  meta: { color: c.textSecondary, fontSize: 12, lineHeight: 18 },
  appleActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  applePlay: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: c.surfaceHighlight,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  playLabel: { color: c.accent, fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1 },
  appleUtility: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 8 },
  spotifyActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  spotifyUtility: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  spotifyPlay: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent },
  spotifyShuffle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  utility: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: .4 }, pressed: { opacity: .65 },
}));
