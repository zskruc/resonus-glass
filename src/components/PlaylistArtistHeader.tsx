/** Album and playlist information share the artist page’s static full-width hero. */
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';

import { Cover } from './Cover';
import Icon from './Icon';
import { VoltaArtistPhotoTarget } from './volta/VoltaArtistPhotoTarget';
import { VoltaDetailHeroFade } from './volta/VoltaDetailHeroFade';
import type { VoltaArtistArtwork } from '@/hooks/useVoltaArtistArtwork';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed } from '@/theme';

export function playlistArtistHeaderHeight(width: number, height: number, apple: boolean): number {
  return Math.round(Math.min(width, height * (apple ? .55 : .6), apple ? 520 : 360));
}

export function PlaylistArtistHeader({ title, owner, onOwnerPress, description, meta, metadataBadge, details, uri, width, height, sidePadding,
  extensionHeight, apple, artwork, offline, imageStyle, nameStyle, onNameLayout, onCoverPress,
  disabled, onPlay, onShuffle, shuffleActive, showPause, favorite, onMenu, utility }: {
  title: string; owner?: string; onOwnerPress?: () => void; description?: string; meta?: string;
  metadataBadge?: ReactNode; details?: ReactNode; uri?: string;
  width: number; height: number; sidePadding: number; extensionHeight: number; apple: boolean;
  artwork: VoltaArtistArtwork; offline: boolean; imageStyle: AnimatedStyle<ViewStyle>;
  nameStyle: AnimatedStyle<ViewStyle>; onNameLayout: (event: LayoutChangeEvent) => void;
  onCoverPress?: () => void; disabled: boolean; onPlay: () => void; onShuffle: () => void;
  shuffleActive: boolean; showPause: boolean; favorite?: ReactNode; onMenu?: () => void; utility?: ReactNode;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const palette = artwork.palette;
  const ink = apple ? palette.text : colors.text;
  const secondary = apple ? palette.textSecondary : colors.textSecondary;
  const fill = apple ? palette.controlFill : colors.highlight;
  const play = <Pressable accessibilityRole="button" accessibilityLabel={showPause ? t('Pause') : t('Play')}
    disabled={disabled} onPress={onPlay} style={({ pressed }) => [apple ? styles.applePlay : styles.spotifyPlay,
      { backgroundColor: apple ? palette.text : colors.accent }, disabled && styles.disabled, pressed && styles.pressed]}>
    <Icon name={showPause ? 'pause' : 'play'} size={apple ? 36 : 28} color={apple ? palette.onText : colors.onAccent} />
  </Pressable>;
  const shuffle = <Pressable accessibilityRole="button" accessibilityLabel={t('Shuffle')} disabled={disabled}
    onPress={onShuffle} style={({ pressed }) => [styles.round, apple && { backgroundColor: fill }, disabled && styles.disabled, pressed && styles.pressed]}>
    <Icon name="shuffle" size={25} color={shuffleActive ? (apple ? palette.accent : colors.accent) : ink} />
  </Pressable>;
  const more = onMenu ? <Pressable accessibilityRole="button" accessibilityLabel={t('More options')} onPress={onMenu}
    style={({ pressed }) => [styles.round, apple && { backgroundColor: fill }, pressed && styles.pressed]}>
    <Icon name="ellipsis-horizontal" size={25} color={ink} />
  </Pressable> : <View style={styles.round} />;
  return <View style={{ width, marginHorizontal: -sidePadding }}>
    <View style={styles.heroGroup}>
      {apple ? <VoltaDetailHeroFade uri={uri} sourceUri={artwork.sourceUri} textureUri={artwork.textureUri}
        cacheOnly={offline} width={width} height={height} extensionHeight={extensionHeight}
        imageStyle={imageStyle} backgroundColor={palette.background} /> : null}
      <View style={[styles.photoFrame, { width, height }]}>
        {!apple ? <>
          <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
            <Cover uri={uri} size={width} style={{ width, height, borderRadius: 0 }} transition={0} />
          </Animated.View>
          <LinearGradient pointerEvents="none" colors={['#00000020', '#00000000', colors.background]}
            locations={[0, .3, 1]} style={StyleSheet.absoluteFill} />
        </> : null}
        {onCoverPress ? <VoltaArtistPhotoTarget onOpen={onCoverPress} /> : null}
        <Animated.View pointerEvents="box-none" onLayout={onNameLayout} style={[styles.titleBlock, nameStyle]}>
          <Text pointerEvents="none" style={[styles.title, apple ? styles.appleTitle : styles.spotifyTitle, height < 280 && { fontSize: 26, lineHeight: 32 }]} numberOfLines={height < 280 ? 2 : 3}>{title}</Text>
          {owner ? <Pressable pointerEvents={onOwnerPress ? 'auto' : 'none'} disabled={!onOwnerPress} onPress={onOwnerPress} hitSlop={8}
            accessibilityRole={onOwnerPress ? 'link' : undefined} style={({ pressed }) => [styles.ownerTarget, onOwnerPress && { minHeight: 32 }, pressed && styles.pressed]}>
            <Text style={[styles.owner, !apple && [styles.left, { color: colors.textSecondary }]]} numberOfLines={1}>{owner}</Text>
          </Pressable> : null}
        </Animated.View>
      </View>
      {apple ? <View style={styles.appleActions}>{shuffle}{play}{favorite ?? more}</View> : null}
    </View>
    <View style={{ paddingHorizontal: sidePadding, paddingBottom: spacing.md }}>
      {!apple ? <View style={styles.spotifyActions}><View style={[styles.utilities, { flex: 1, flexWrap: 'wrap' }]}>{favorite}{utility}{onMenu ? more : null}</View>{shuffle}{play}</View> : null}
      <View style={styles.details}>
        <View style={styles.metadata}>{metadataBadge}{meta ? <Text style={[styles.meta, { color: secondary }]}>{meta}</Text> : null}</View>
        {apple ? <View style={styles.utilities}>{utility}</View> : null}
      </View>
      {details}
      {description?.trim() ? <Pressable accessibilityRole="button" accessibilityLabel={t(expanded ? 'Show less' : 'Show more')}
        onPress={() => setExpanded((value) => !value)} style={styles.descriptionButton}>
        <Text style={[styles.description, { color: secondary }]} numberOfLines={expanded ? undefined : 2}>{description.trim()}</Text>
      </Pressable> : null}
    </View>
  </View>;
}

const styles = themed((c) => ({
  heroGroup: { position: 'relative' }, photoFrame: { justifyContent: 'flex-end', overflow: 'hidden' },
  titleBlock: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  title: { color: '#FFFFFF', fontWeight: '600' },
  appleTitle: { textAlign: 'center', fontSize: 34, lineHeight: 40, letterSpacing: -.6 },
  spotifyTitle: { color: c.text, fontSize: fontSize.xxl, letterSpacing: -.5 },
  ownerTarget: { marginTop: 5, justifyContent: 'center' },
  owner: { textAlign: 'center', color: '#F5F7F6', fontSize: 14, lineHeight: 20 }, left: { textAlign: 'left' },
  appleActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, paddingBottom: spacing.xl },
  round: { width: 48, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  applePlay: { width: 72, height: 72, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  spotifyPlay: { width: 56, height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  spotifyActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, paddingBottom: 10 },
  utilities: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  details: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metadata: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { flex: 1, fontSize: 12, lineHeight: 18 },
  descriptionButton: { paddingTop: 6, paddingBottom: 4 }, description: { fontSize: 14, lineHeight: 20 },
  disabled: { opacity: .4 }, pressed: { opacity: .65 },
}));
