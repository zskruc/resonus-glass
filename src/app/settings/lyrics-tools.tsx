/** Per-song timing affects every lyrics view without modifying cached lyrics. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { DockScrollView } from '@/components/DockScrollView';
import { Field, SettingRow, SettingsGroup, SettingsPage, SliderRow, settingsStyles } from '@/components/SettingsUI';
import { useLyricToolSong } from '@/hooks/useLyricToolSong';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { MAX_LYRIC_OFFSET_MS, normalizeLyricOffset } from '@/lib/lyricTiming';
import { profileScopeId } from '@/store/auth';
import { useLyricOffsets } from '@/store/lyricOffsets';
import { useLyricToolTarget } from '@/store/lyricToolTarget';
import { usePlayerStore, currentSong } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';

export default function LyricsToolsSettings() {
  useTheme();
  const t = useT(), router = useRouter();
  const { song, profile } = useLyricToolSong();
  const stateProfile = useLyricOffsets((state) => state.profile);
  const hydrated = useLyricOffsets((state) => state.hydrated);
  const loadError = useLyricOffsets((state) => state.error);
  const offset = useLyricOffsets((state) => state.profile === profile ? normalizeLyricOffset(state.offsets[song?.id ?? '']) : 0);
  const [busy, setBusy] = useState(false);
  const { data } = useLyrics(song ?? undefined);
  const playingId = usePlayerStore((state) => currentSong(state)?.id);
  useEffect(() => { void useLyricOffsets.getState().hydrate(profile); }, [profile]);
  const ready = hydrated && stateProfile === profile;
  const save = async (value: number) => {
    if (!song || busy || !ready || profileScopeId() !== profile) return;
    setBusy(true);
    const saved = await useLyricOffsets.getState().setOffset(song.id, value, profile);
    if (profileScopeId() === profile) {
      setBusy(false);
      if (!saved) useToast.getState().show(t('Could not save lyric timing'));
    }
  };
  return <SettingsPage title={t('Lyrics tools')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      {song ? <>
        <SettingsGroup>
          <Field label={t('Song')} value={song.title} />
          {song.artist ? <Field label={t('Artist')} value={song.artist} /> : null}
        </SettingsGroup>
        <SliderRow label={t('Lyric timing')} value={offset} min={-MAX_LYRIC_OFFSET_MS} max={MAX_LYRIC_OFFSET_MS}
          step={100} fineTune={{ step: 10, doneLabel: t('Done') }} disabled={!ready || busy || !data?.synced}
          description={t('Negative values show lyrics earlier; positive values show them later. Saved for this song only.')}
          formatValue={(value) => `${value > 0 ? '+' : ''}${(value / 1000).toFixed(2)} s`}
          onChange={(value) => { void save(value); }} />
        <SettingsGroup>
          <SettingRow label={t('Show lyrics earlier')} right="−0.10 s" onPress={() => { if (!busy && data?.synced) void save(offset - 100); }} />
          <SettingRow label={t('Show lyrics later')} right="+0.10 s" onPress={() => { if (!busy && data?.synced) void save(offset + 100); }} />
          <SettingRow label={t('Reset this song timing')} right="0.00 s" onPress={() => { void save(0); }} />
        </SettingsGroup>
        {loadError ? <SettingRow label={t('Retry')} description={t('Lyric timing could not be loaded. Your saved values have not been changed.')}
          onPress={() => { void useLyricOffsets.getState().hydrate(profile); }} /> : null}
        {!data?.synced ? <Text style={styles.note}>{t('Timing adjustment needs synchronized lyrics.')}</Text> : null}
        <Text style={styles.note}>{t('Original lyric files and downloaded copies stay unchanged.')}</Text>
        <SettingsGroup>
          {playingId === song.id ? <SettingRow label={t('Preview lyrics')} chevron onPress={() => router.push('/lyrics')} /> : null}
          <SettingRow label={t('Lyric poster')} chevron onPress={() => {
            useLyricToolTarget.getState().open(song); router.push('/lyric-poster');
          }} />
        </SettingsGroup>
      </> : <View style={styles.empty}><Text style={{ color: colors.textMuted }}>{t('Choose a song first to use lyrics tools.')}</Text></View>}
    </DockScrollView>
  </SettingsPage>;
}

const styles = themed((palette) => ({
  note: { color: palette.textSecondary, fontSize: fontSize.sm, lineHeight: 21, marginVertical: spacing.md },
  empty: { padding: spacing.lg },
}));
