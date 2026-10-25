/** AM++-inspired floating quality card using Resonus's own playback metadata. */
import { type MutableRefObject } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { Song } from '@/api/subsonic';
import Icon from '@/components/Icon';
import { MenuGlassCardHeader } from '@/components/MenuGlassCard';
import { SheetModal } from '@/components/SheetModal';
import { usePlaybackQuality } from '@/hooks/usePlaybackQuality';
import { useT } from '@/i18n';
import { pushOnce } from '@/lib/pushOnce';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSongInfo } from '@/store/songInfo';
import { fontSize, spacing, themed, useTheme } from '@/theme';

export function PlayerAudioQualitySheet({ openRef }: { openRef: MutableRefObject<() => void> }) {
  const song = usePlayerStore(currentSong);
  return (
    <SheetModal openRef={openRef} presentation="card">
      {(close) => song ? <QualityContent song={song} close={close} /> : null}
    </SheetModal>
  );
}

function QualityContent({ song, close }: { song: Song; close: (after?: () => void) => void }) {
  const colors = useTheme();
  const t = useT();
  const { label, source } = usePlaybackQuality(song);
  const sourceLabel = source === 'download' ? t('Downloaded audio') : source === 'cache' ? t('Cached audio')
    : source === 'local' ? t('Local audio') : t('Streamed audio');
  return (
    <>
      <MenuGlassCardHeader title={t('Audio quality')} onClose={() => close()} />
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 2 }} showsVerticalScrollIndicator={false}>
      <View style={styles.format}>
        <Icon name="pulse-outline" size={28} color={colors.text} />
        <Text style={styles.quality}>{label || t('Unknown')}</Text>
      </View>
      <Text style={styles.source}>{sourceLabel}</Text>
      <Text style={styles.description}>{t('Quality follows the source and playback settings; the output device may process audio separately.')}</Text>
      <View style={styles.actions}>
        <Pressable style={({ pressed }) => [styles.action, pressed && { opacity: .6 }]}
          accessibilityRole="button" onPress={() => close(() => useSongInfo.getState().open(song))}>
          <Icon name="information-circle-outline" size={21} color={colors.text} />
          <Text style={styles.actionText}>{t('Song info')}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.action, pressed && { opacity: .6 }]}
          accessibilityRole="button" onPress={() => close(() => pushOnce('/settings/playback'))}>
          <Icon name="options-outline" size={21} color={colors.text} />
          <Text style={styles.actionText}>{t('Quality & playback')}</Text>
        </Pressable>
      </View>
      </ScrollView>
    </>
  );
}

const styles = themed((colors) => ({
  format: { alignItems: 'center', gap: 10, paddingVertical: spacing.sm },
  quality: { color: colors.text, fontSize: 19, fontWeight: '600', textAlign: 'center', lineHeight: 27 },
  source: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', marginTop: 2 },
  description: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 14, marginBottom: 16 },
  actions: { gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14,
    paddingVertical: 10, borderRadius: 16, backgroundColor: colors.surfaceHighlight },
  actionText: { color: colors.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },
}));
