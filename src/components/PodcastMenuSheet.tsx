/** One device-owned podcast menu, presented by the existing floating glass card. */
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import type { PodcastChannel, PodcastEpisode, SubsonicAuth } from '@/api/subsonic';
import type { PlayerExtras } from '@/store/songMenu';
import { addChannel, episodeToSong, listAllEpisodes, podcastCover, queueEpisode, refreshChannel,
  removeChannel, setChannelAutoDownload, setEpisodePlayed, togglePodcastHeart } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { usePodcastAddedIds, usePodcastAutoDownloadIds, usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import Icon from './Icon';
import { SheetModal } from './SheetModal';

type Extras = PlayerExtras & { sleep?: boolean };
type Target = { channel: PodcastChannel; episode?: PodcastEpisode; owner: string; auth: SubsonicAuth | null; extras?: Extras };
let opener: ((channel: PodcastChannel, episode?: PodcastEpisode, extras?: Extras) => void) | undefined;
const hostIds = new WeakMap<object, number>();
let hostSequence = 0;
function hostId(auth: object | null) {
  if (!auth) return 'local';
  let id = hostIds.get(auth); if (!id) { id = ++hostSequence; hostIds.set(auth, id); }
  return id;
}
export function openPodcastMenu(channel: PodcastChannel): void { opener?.(channel); }
export function openPodcastEpisodeMenu(channel: PodcastChannel, episode: PodcastEpisode, extras?: Extras): void { opener?.(channel, episode, extras); }

export function PodcastMenuSheet() {
  const t = useT(), toast = useToast((state) => state.show);
  const auth = useAuthStore((state) => state.auth), offline = useAuthStore((state) => state.offline);
  const owner = profileScopeId();
  const [target, setTarget] = useState<Target | null>(null);
  const [confirmation, setConfirmation] = useState<{ target: Target; remove: boolean } | null>(null);
  const [mode, setMode] = useState<'actions' | 'sleep' | 'notes'>('actions');
  const openRef = useRef<() => void>(() => {});
  const favorites = usePodcastFavoriteIds(!!target);
  const automatic = usePodcastAutoDownloadIds();
  const added = usePodcastAddedIds();
  const files = usePodcastDownloads((state) => state.files);
  const episodes = useQuery({ queryKey: ['podcastEpisodes', target?.channel.id],
    queryFn: () => listAllEpisodes(target!.channel.id), enabled: !!target });
  useEffect(() => {
    opener = (channel, episode, extras) => {
      setMode(extras?.sleep ? 'sleep' : 'actions');
      setConfirmation(null);
      setTarget({ channel, episode, owner: profileScopeId(), auth: useAuthStore.getState().auth, extras });
      openRef.current();
    };
    return () => { opener = undefined; };
  }, []);
  const current = (value: Target) => value.owner === profileScopeId() && value.auth === useAuthStore.getState().auth;
  const perform = (value: Target, run: () => Promise<unknown>) => {
    if (current(value)) void run().catch(() => { if (current(value)) toast(t("Couldn't complete the action")); });
  };
  const row = (icon: keyof typeof Icon.glyphMap, label: string, action: () => void, danger = false) => (
    <Pressable key={label} style={({ pressed }) => [styles.row, pressed && { opacity: .6 }]} onPress={action} accessibilityRole="button">
      <Icon name={icon} size={23} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.action, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
  return <>
    <SheetModal key={`${owner}|${hostId(auth)}|${offline}`} openRef={openRef} onClosed={() => setTarget(null)}>
      {(close) => {
        if (!target || !current(target)) return null;
        const value = target, ch = value.channel, episode = value.episode;
        const heart = favorites.has(episode?.id ?? ch.id);
        const list = episode ? [episode] : episodes.data ?? [];
        const downloaded = list.filter((item) => files[item.id]);
        if (mode === 'sleep') return <>
          {row('chevron-back', t('Sleep timer'), () => setMode('actions'))}
          {[15, 30, 45, 60].map((minutes) => row('time-outline', t('{n} minutes', { n: minutes }), () => close(() => {
            if (current(value)) usePlayerStore.getState().setSleepTimer(minutes);
          })))}
          {row('stop-circle-outline', t('When the episode ends'), () => close(() => {
            if (current(value)) usePlayerStore.getState().setSleepAtSongEnd();
          }))}
          {row('close-circle-outline', t('Turn off'), () => close(() => {
            if (current(value)) usePlayerStore.getState().cancelSleepTimer();
          }))}
        </>;
        if (mode === 'notes') return <>
          {row('chevron-back', t('Episode notes'), () => setMode('actions'))}
          <Text style={[styles.action, { paddingVertical: spacing.md }]}>{episode?.description}</Text>
        </>;
        return <>
          <View style={styles.header}>
            <Cover uri={podcastCover(ch)} size={48} rounded placeholderIcon="headset-outline" />
            <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={2}>{episode?.title || ch.title}</Text>
              {episode ? <Text style={styles.sub} numberOfLines={1}>{ch.title}</Text> : null}</View>
          </View>
          {row('play-outline', t('Play'), () => close(() => perform(value, async () => {
            const ready = episode ? [episode] : await listAllEpisodes(ch.id);
            if (!current(value)) return;
            const playable = ready.filter((item) => item.url && (!isManualOffline() || files[item.id]));
            if (!playable.length) { toast(t('Not available offline')); return; }
            if (episode) queueEpisode(episode, ch);
            else await usePlayerStore.getState().playQueue(playable.map((item) => episodeToSong(item, ch)), 0, ch.title, `/podcast/${ch.id}`);
          })))}
          {row(heart ? 'heart' : 'heart-outline', t(heart ? 'Remove from favorites' : 'Add to favorites'), () => close(() =>
            perform(value, () => togglePodcastHeart(episode?.id ?? ch.id, episode ? 'episode' : 'channel', ch.id))))}
          {episode ? <>
            {episode.description ? row('document-text-outline', t('Episode notes'), () => setMode('notes')) : null}
            {row('checkmark-circle-outline', t('Mark as played'), () => close(() => perform(value, () => setEpisodePlayed(episodeToSong(episode, ch), true))))}
            {row('refresh-outline', t('Mark as unplayed'), () => close(() => perform(value, () => setEpisodePlayed(episodeToSong(episode, ch), false))))}
            {value.extras?.queue ? row('list-outline', t('Queue'), () => close(() => { if (current(value)) router.push('/queue'); })) : null}
            {value.extras?.speed ? row('speedometer-outline', t('Playback speed'), () => close(() => { if (current(value)) value.extras?.speed?.(); })) : null}
            {value.extras?.devices ? row('volume-high-outline', t('Output device'), () => close(() => { if (current(value)) value.extras?.devices?.(); })) : null}
            {row('moon-outline', t('Sleep timer'), () => setMode('sleep'))}
          </> : <>
            {!added.has(ch.id) ? row('add', t('Add podcast'), () => close(() => perform(value, () => addChannel(ch.id)))) : null}
            {row(automatic.has(ch.id) ? 'cloud-done' : 'cloud-download-outline', t('Download new episodes'), () => close(() =>
              perform(value, async () => {
                const on = !automatic.has(ch.id); await setChannelAutoDownload(ch.id, on);
                if (current(value)) toast(t(on ? 'Auto-download on' : 'Auto-download off'));
              })))}
            <Text style={styles.hint}>{t('The latest 3 of each new batch, over Wi-Fi only.')}</Text>
          </>}
          {!offline ? row('download-outline', t(episode ? 'Download episode' : 'Download episodes'), () => close(() =>
            perform(value, async () => {
              const ready = episode ? [episode] : await listAllEpisodes(ch.id);
              if (current(value)) await usePodcastDownloads.getState().download(ch, ready);
            }))) : null}
          {downloaded.length ? row('trash-outline', t('Delete downloaded episodes'), () => close(() => setConfirmation({ target: value, remove: false })), true) : null}
          {!episode && ch.feedUrl && !offline ? row('refresh', t('Refresh'), () => close(() => perform(value, () => refreshChannel(ch.feedUrl!)))) : null}
          {!episode && ch.siteUrl && /^https?:\/\//i.test(ch.siteUrl) ? row('link-outline', t('Open website'), () => close(() => perform(value, () => Linking.openURL(ch.siteUrl!)))) : null}
          {!episode ? row('trash-outline', t('Unsubscribe'), () => close(() => setConfirmation({ target: value, remove: true })), true) : null}
        </>;
      }}
    </SheetModal>
    <Dialog visible={!!confirmation && current(confirmation.target)} title={t(confirmation?.remove ? 'Unsubscribe' : 'Delete downloaded episodes')}
      message={confirmation?.remove ? t('Remove “{name}” and its episodes from this device?', { name: confirmation.target.channel.title }) : t('Downloaded audio will be removed. Your shows, favorites and listening progress are kept.')}
      confirmLabel={t(confirmation?.remove ? 'Unsubscribe' : 'Delete')} destructive onCancel={() => setConfirmation(null)} onConfirm={() => {
        const value = confirmation; setConfirmation(null); if (!value || !current(value.target)) return;
        perform(value.target, async () => {
          if (value.remove) await removeChannel(value.target.channel.id);
          else {
            const ready = value.target.episode ? [value.target.episode] : await listAllEpisodes(value.target.channel.id);
            if (current(value.target)) await usePodcastDownloads.getState().deleteEpisodes(ready.map((item) => item.id));
          }
        });
      }} />
  </>;
}

const styles = themed((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: .5, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 3 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  action: { flex: 1, color: colors.text, fontSize: fontSize.md },
  hint: { color: colors.textSecondary, fontSize: fontSize.xs, marginLeft: 23 + spacing.md, marginBottom: spacing.sm },
}));
