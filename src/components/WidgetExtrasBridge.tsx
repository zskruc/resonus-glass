import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { useQuery } from '@tanstack/react-query';
import { useLyrics } from '@/hooks/useLyrics';
import { useDisplaySong } from '@/hooks/useLocalMetadata';
import { useT } from '@/i18n';
import { hashKey } from '@/lib/localLibrary';
import { localDay } from '@/lib/listeningMath';
import { listeningSummary } from '@/lib/listeningDb';
import { listLibraryEpisodes } from '@/lib/podcastDb';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { widgetLyricIndex, widgetLyricRows, type ExtraWidgetKind, type WidgetExtraSnapshot } from '@/lib/widgetExtras';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentSong, playerOwnsListeningSource, usePlayerStore } from '@/store/player';
import { queryClient } from '@/lib/query';
import { listeningSourceKey } from '@/store/listeningTools';

const native = requireOptionalNativeModule<{ getInstalledExtras(): string[]; updateExtras(value: string): void }>('HomeWidget');
/** No catalog work unless that widget is actually installed. Lyrics publish on
 * line changes, not every playback frame, using the same edited/offset document. */
export function WidgetExtrasBridge() {
  const t = useT(), song = usePlayerStore(currentSong), playing = usePlayerStore((state) => state.isPlaying);
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offlineSource);
  const profile = profileScopeId(), scope = hashKey(profile), sourceKey = listeningSourceKey(), [kinds, setKinds] = useState<ExtraWidgetKind[]>([]);
  const ownedSong = playerOwnsListeningSource() ? song : null;
  const ownedSongId = ownedSong?.id, ownedSongTitle = useDisplaySong(ownedSong)?.title;
  const { data: lyrics } = useLyrics(kinds.includes('lyrics') ? ownedSong ?? undefined : undefined);
  const line = usePlayerStore((state) => widgetLyricIndex(lyrics, state.positionSec));
  useEffect(() => {
    if (!native) return;
    const refresh = () => { try { setKinds(native.getInstalledExtras().filter((kind): kind is ExtraWidgetKind => ['podcast', 'stats', 'lyrics'].includes(kind))); } catch { setKinds([]); } };
    refresh(); const event = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => event.remove();
  }, []);
  const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - 29);
  const untilDate = new Date(); untilDate.setDate(untilDate.getDate() + 1);
  const from = localDay(fromDate.getTime()), until = localDay(untilDate.getTime());
  const { data: stats } = useQuery({ queryKey: ['widgetListeningStats', profile, from, until], enabled: kinds.includes('stats'), staleTime: 60_000,
    queryFn: async () => { const owns = captureLyricOwner(profile), result = await listeningSummary(profile, from, until); if (!owns()) throw new Error('Widget profile changed'); return result; } });
  const { data: episodes } = useQuery({ queryKey: ['widgetContinuePodcasts', profile], enabled: kinds.includes('podcast'), staleTime: 30_000,
    queryFn: async () => { const owns = captureLyricOwner(profile), result = await listLibraryEpisodes(scope, 'continue', 3); if (!owns()) throw new Error('Widget profile changed'); return result; } });
  useEffect(() => {
    if (!playing) {
      if (kinds.includes('stats')) void queryClient.invalidateQueries({ queryKey: ['widgetListeningStats', profile] });
      if (kinds.includes('podcast')) void queryClient.invalidateQueries({ queryKey: ['widgetContinuePodcasts', profile] });
    }
  }, [playing, song?.id, kinds, profile]);
  useEffect(() => {
    if (!native) return;
    const payload: WidgetExtraSnapshot = { profile: hashKey(`${profile}:${sourceKey}`) };
    if (kinds.includes('lyrics')) payload.lyrics = { title: ownedSongTitle ?? t('Current lyrics'), rows: ownedSongId ? widgetLyricRows(lyrics, line).map((text) => ({ id: ownedSongId, text })) : [] };
    if (kinds.includes('podcast')) payload.podcast = { title: t('Continue listening'), rows: (episodes ?? []).map((row) => ({ id: row.episode.id,
      text: `${row.episode.title}\n${row.durationSec > 0 ? `${Math.max(0, Math.ceil((row.durationSec - row.positionSec) / 60))} ${t('min remaining')}` : row.channel.title}` })) };
    if (kinds.includes('stats')) payload.stats = { title: t('Last 30 days'), rows: stats ? [
      { id: '', text: `${t('Listening time')}: ${(stats.seconds / 3600).toFixed(1)} ${t('hours')}` },
      { id: '', text: `${t('Play count')}: ${stats.plays}` },
      { id: '', text: stats.top[0]?.song.title ?? t('No listening history yet') },
    ] : [] };
    try { native.updateExtras(JSON.stringify(payload)); } catch { /* A launcher update can retry on the next real change. */ }
  }, [profile, scope, sourceKey, ownedSongId, ownedSongTitle, lyrics, line, episodes, stats, kinds, t]);
  useEffect(() => {
    if (!native) return;
    return useAuthStore.subscribe((state, previous) => {
      if (state.auth !== previous.auth || state.offlineSource !== previous.offlineSource) {
        try { native.updateExtras(JSON.stringify({ profile: hashKey(`${profileScopeId()}:${listeningSourceKey()}`) })); } catch { /* Keep private metadata out of another profile. */ }
      }
    });
  }, []);
  return null;
}
