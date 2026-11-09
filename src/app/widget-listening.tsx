import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SettingsPage, SettingsGroup, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { hashKey } from '@/lib/localLibrary';
import * as PodcastDb from '@/lib/podcastDb';
import { profileScopeId } from '@/store/auth';
import { playbackIntentVersion, usePlayerStore } from '@/store/player';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { listeningSourceKey } from '@/store/listeningTools';
import { colors, useTheme } from '@/theme';

export default function WidgetListeningScreen() {
  useTheme();
  const params = useLocalSearchParams<{ kind?: string; id?: string; profile?: string }>(), router = useRouter(), t = useT();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; const profile = profileScopeId(), owns = captureLyricOwner(profile), before = usePlayerStore.getState(), intent = playbackIntentVersion();
    const current = () => active && owns() && playbackIntentVersion() === intent && usePlayerStore.getState().queue === before.queue && usePlayerStore.getState().index === before.index;
    void (async () => {
      if (params.profile !== hashKey(`${profile}:${listeningSourceKey()}`)) throw new Error('Widget belongs to another profile');
      if (params.kind === 'stats') { router.replace('/settings/listening-stats'); return; }
      if (params.kind === 'lyrics') { router.replace('/player'); return; }
      if (params.kind !== 'podcast' || !params.id) { router.replace('/podcasts'); return; }
      const scope = hashKey(profile), episode = await PodcastDb.getEpisode(scope, params.id); if (!current()) throw new Error('Playback was superseded');
      if (!episode || !(await PodcastDb.addedIds(scope)).has(episode.channelId)) throw new Error('Episode is unavailable');
      if (!current()) throw new Error('Playback was superseded'); const channel = await PodcastDb.getChannel(scope, episode.channelId); if (!current()) throw new Error('Playback was superseded');
      if (!channel) throw new Error('Show is unavailable');
      await usePodcastDownloads.getState().hydrate(); if (!current()) throw new Error('Playback was superseded');
      const { episodeToSong } = await import('@/api/podcasts'); if (!current()) throw new Error('Playback was superseded');
      const starting = usePlayerStore.getState().playQueue([episodeToSong(episode, channel)], 0, channel.title, `/podcast/${channel.id}`, { ordered: true });
      const queue = usePlayerStore.getState().queue, acceptedIntent = playbackIntentVersion();
      const played = await starting;
      if (active) {
        if (played && owns() && usePlayerStore.getState().queue === queue && playbackIntentVersion() === acceptedIntent) router.replace('/player');
        else setFailed(true);
      }
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [params.kind, params.id, params.profile, router]);
  return <SettingsPage title={t('Continue listening')}>{failed ? <SettingsGroup>
    <Text style={settingsStyles.sectionDescription}>{t('This widget item is unavailable in the current profile.')}</Text>
    <SettingRow label={t('Open podcasts')} onPress={() => router.replace('/podcasts')} />
  </SettingsGroup> : <ActivityIndicator color={colors.accent} />}</SettingsPage>;
}
