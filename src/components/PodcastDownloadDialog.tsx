/** A whole-show download asks first, using actual episodes and known time. */
import { useEffect, useMemo, useState } from 'react';

import { listAllEpisodes } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import type { PodcastChannel } from '@/api/subsonic';
import { episodesLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { hashKey } from '@/lib/localLibrary';
import { createPodcastDownloadConfirmation, podcastDownloadSelection, type PodcastDownloadRequest } from '@/lib/podcastPresentation';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { Dialog } from './Dialog';

const NO_FILES: Record<string, string> = {};
function currentFiles() {
  const state = usePodcastDownloads.getState();
  return state.scope === hashKey(profileScopeId()) ? state.files : NO_FILES;
}

export function PodcastDownloadDialog({ channel, onClose }: { channel: PodcastChannel | null; onClose(): void }) {
  return channel ? <PodcastDownloadConfirmation key={channel.id} channel={channel} onClose={onClose} /> : null;
}

function PodcastDownloadConfirmation({ channel, onClose }: { channel: PodcastChannel; onClose(): void }) {
  const t = useT(), toast = useToast((state) => state.show);
  const language = useSettings((state) => state.language);
  const authState = useAuthStore();
  const files = usePodcastDownloads((state) => state.files);
  const [request, setRequest] = useState<PodcastDownloadRequest | null>(null);
  const control = useMemo(() => createPodcastDownloadConfirmation({
    owner: () => useAuthStore.getState(),
    allowed: () => !!useAuthStore.getState().auth && !useAuthStore.getState().offline && !isManualOffline(),
    episodes: async (id) => {
      const owner = useAuthStore.getState();
      const state = usePodcastDownloads.getState();
      if (!state.hydrated || state.scope !== hashKey(profileScopeId())) await state.hydrate();
      if (owner !== useAuthStore.getState()) return [];
      return listAllEpisodes(id);
    },
    files: currentFiles,
    download: (show, episodes) => usePodcastDownloads.getState().download(show, episodes),
  }), []);

  useEffect(() => {
    let live = true;
    if (useAuthStore.getState() !== authState) { onClose(); return; }
    void control.prepare(channel).then((value) => {
      if (!live) return;
      if (!value || !control.owns(value)) { onClose(); return; }
      const selection = podcastDownloadSelection(value.channel.id, value.episodes, currentFiles());
      if (!selection.pending.length) {
        toast(t(selection.downloadable ? 'All episodes are already downloaded.' : 'No episodes'));
        onClose();
      } else setRequest(value);
    }).catch(() => {
      if (live && useAuthStore.getState() === authState) { toast(t("Couldn't load this podcast.")); onClose(); }
    });
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state !== authState) { control.cancel(); if (live) onClose(); }
    });
    return () => { live = false; control.cancel(); unsubscribe(); };
    // The opening owns its callbacks and account. Changing language or an
    // inline onClose callback must not restart a confirmed show preparation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, control]);

  const scope = hashKey(profileScopeId());
  const selection = useMemo(() => request ? podcastDownloadSelection(request.channel.id, request.episodes,
    usePodcastDownloads.getState().scope === scope ? files : NO_FILES) : null, [request, files, scope]);
  useEffect(() => {
    if (!request || !selection || selection.pending.length || !control.owns(request)) return;
    control.cancel(); onClose();
    toast(t('All episodes are already downloaded.'));
  }, [request, selection, control, onClose, toast, t]);
  const cancel = () => { control.cancel(); setRequest(null); onClose(); };
  if (!request || !control.owns(request) || !selection) return null;
  const count = episodesLabel(selection.pending.length, language);
  const message = selection.seconds > 0
    ? t('{episodes} will be saved to this device ({duration}).', { episodes: count, duration: formatTotalDuration(selection.seconds) })
    : t('{episodes} will be saved to this device.', { episodes: count });
  return <Dialog visible title={t('Download “{name}”?', { name: request.channel.title })}
    message={`${message}${selection.unknownDuration ? `\n${t('Duration excludes episodes with unknown length.')}` : ''}`}
    confirmLabel={t('Download')} onCancel={cancel} onConfirm={() => {
      const value = request;
      // Admit before closing: the modal cleanup cannot invalidate an action
      // that the user has just explicitly confirmed.
      void control.confirm(value).catch(() => {
        if (useAuthStore.getState() === value.owner) toast(t("Couldn't complete the action"));
      });
      setRequest(null);
      onClose();
    }} />;
}
