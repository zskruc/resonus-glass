import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, type ScrollView } from 'react-native';
import { DockScrollView } from '@/components/DockScrollView';
import { Dialog } from '@/components/Dialog';
import { Field, SettingRow, SettingsGroup, SettingsPage, SwitchList, TextRow, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { playLongAudioAt } from '@/hooks/useLongAudioPlayback';
import { formatDuration } from '@/lib/format';
import { canRememberLongAudio, longAudioResumePosition, LONG_AUDIO_BOOKMARK_LIMIT } from '@/lib/longAudio';
import { useAuthStore } from '@/store/auth';
import { longAudioScope, useLongAudio } from '@/store/longAudio';
import { useLongAudioTarget } from '@/store/longAudioTarget';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme';

export default function LongAudioSettings() {
  useTheme();
  const t = useT();
  useAuthStore((state) => state.auth);
  useAuthStore((state) => state.offlineSource);
  const [opening] = useState(() => {
    const handoff = useLongAudioTarget.getState(), scope = longAudioScope();
    return { scope, session: handoff.session, song: handoff.scope === scope ? handoff.song : currentSong(usePlayerStore.getState()) };
  });
  const [selected, setSelected] = useState(opening.song);
  const [note, setNote] = useState('');
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const operation = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const scope = longAudioScope(), sameAccount = opening.scope === scope;
  const data = useLongAudio();
  const playingId = usePlayerStore((state) => currentSong(state)?.id);
  const ready = sameAccount && data.profile === scope && data.hydrated;
  const song = sameAccount && canRememberLongAudio(selected) ? selected : null;
  const entry = song && Object.hasOwn(data.entries, song.id) ? data.entries[song.id] : undefined;
  const saved = useMemo(() => ready ? Object.values(data.entries).sort((a, b) => b.updatedAt - a.updatedAt) : [], [data.entries, ready]);
  useEffect(() => { void useLongAudio.getState().load(scope); }, [scope]);
  useEffect(() => () => { operation.current++; useLongAudioTarget.getState().clear(opening.session); }, [opening.session]);
  const act = async (work: () => Promise<boolean>) => {
    if (!ready || busy) return;
    const token = ++operation.current; setBusy(true);
    try {
      const ok = await work();
      if (token === operation.current && scope === longAudioScope() && !ok) useToast.getState().show(t('Could not save or open this audio. Please retry.'));
    } catch {
      if (token === operation.current && scope === longAudioScope()) useToast.getState().show(t('Could not save or open this audio. Please retry.'));
    } finally { if (token === operation.current) setBusy(false); }
  };
  return <SettingsPage title={t('Long audio and bookmarks')}>
    <DockScrollView ref={scroll} contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={settingsStyles.sectionDescription}>{t('Opt in per track for ASMR, concerts or other long recordings. Positions and note bookmarks are kept on this device for this account.')}</Text>
      {song ? <>
        <SettingsGroup><Field label={t('Song')} value={song.title} />
          {song.artist ? <Field label={t('Artist')} value={song.artist} /> : null}
          <Field label={t('Saved position')} value={formatDuration(entry?.positionSec)} />
        </SettingsGroup>
        <SwitchList options={[{ label: t('Remember this audio position'),
          description: t('Save while listening, pausing and leaving the app. Continue playing rewinds 10 seconds.'),
          value: !!entry?.enabled, onChange: (enabled) => { void act(() => data.setEnabled(scope, song, enabled)); } }]} />
        <SettingsGroup>
          <SettingRow icon="play-outline" label={t('Continue playing')}
            right={formatDuration(longAudioResumePosition(entry))}
            onPress={!busy && ready && entry?.enabled ? () => { void act(() => playLongAudioAt(song, longAudioResumePosition(entry), scope)); } : undefined} />
          <SettingRow icon="refresh-outline" label={t('Reset saved position')}
            onPress={!busy && ready && entry ? () => { void act(() => data.resetPosition(scope, song)); } : undefined} />
          {entry ? <SettingRow icon="trash-outline" label={t('Remove saved audio')} destructive
            onPress={ready && !busy ? () => setConfirmForget(true) : undefined} /> : null}
        </SettingsGroup>
        <Text style={settingsStyles.sectionTitle}>{t('Audio bookmarks')}</Text>
        <TextRow label={t('Bookmark note')} value={note} maxLength={160} onChange={setNote} placeholder={t('Optional note')} />
        <SettingRow icon="bookmark-outline" label={t('Bookmark current position')}
          description={playingId === song.id ? t('Tap a saved bookmark to play from that point.') : t('Play this audio first to bookmark the current position.')}
          right={`${entry?.bookmarks.length ?? 0}/${LONG_AUDIO_BOOKMARK_LIMIT}`}
          onPress={ready && !busy && playingId === song.id && (entry?.bookmarks.length ?? 0) < LONG_AUDIO_BOOKMARK_LIMIT ? () => {
            const player = usePlayerStore.getState();
            if (currentSong(player)?.id !== song.id) return;
            void act(async () => {
              const ok = await data.addBookmark(scope, song, player.positionSec, note);
              if (ok && scope === longAudioScope()) setNote('');
              return ok;
            });
          } : undefined} />
        {(entry?.bookmarks ?? []).map((mark) => <SettingsGroup key={mark.id}>
          <SettingRow icon="play-outline" label={mark.note || t('Audio bookmark')} right={formatDuration(mark.seconds)}
            onPress={ready && !busy ? () => { void act(() => playLongAudioAt(song, mark.seconds, scope)); } : undefined} />
          <SettingRow icon="trash-outline" label={t('Delete bookmark')} destructive
            onPress={ready && !busy ? () => { void act(() => data.removeBookmark(scope, song, mark.id)); } : undefined} />
        </SettingsGroup>)}
      </> : <Text style={settingsStyles.sectionDescription}>{t('Open a song menu to choose long audio, or select a saved recording below.')}</Text>}
      {data.error ? <SettingRow icon="refresh-outline" label={t('Retry')} description={t('Long-audio data could not be read or saved. Existing bookmarks are retained.')}
        onPress={() => { if (data.hydrated) void data.retry(); else void data.load(scope); }} /> : null}
      <Text style={settingsStyles.sectionTitle}>{t('Saved long audio')}</Text>
      {saved.length ? <SettingsGroup>{saved.slice(0, limit).map((item) => <SettingRow key={item.song.id}
        label={item.song.title} description={item.song.artist || undefined} right={formatDuration(item.positionSec)} chevron
        onPress={() => { if (scope !== longAudioScope()) return; setSelected(item.song); setNote(''); scroll.current?.scrollTo({ y: 0, animated: true }); }} />)}</SettingsGroup>
        : <Text style={settingsStyles.sectionDescription}>{t('No saved long audio yet')}</Text>}
      {saved.length > limit ? <SettingRow label={t('Load more')} onPress={() => setLimit((value) => value + 20)} /> : null}
    </DockScrollView>
    <Dialog visible={confirmForget && !!song} title={t('Remove saved audio')}
      message={t('Remove this recording’s saved position and bookmarks? The audio file is kept.')}
      confirmLabel={t('Remove')} destructive onCancel={() => setConfirmForget(false)} onConfirm={() => {
        setConfirmForget(false); if (song) void act(() => data.forget(scope, song.id));
      }} />
  </SettingsPage>;
}
