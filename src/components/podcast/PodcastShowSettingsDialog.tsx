import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { PodcastChannel } from '@/api/subsonic';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { getPodcastPreferences, usePodcastPreferences } from '@/store/podcastPreferences';
import { useToast } from '@/store/toast';
import { DEFAULT_PODCAST_PLAYBACK } from '@/lib/podcastPlaybackPolicy';
import { useT } from '@/i18n';
import { colors } from '@/theme';
import { Dialog } from '../Dialog';
import { SelectList, SwitchList } from '../SettingsUI';

export function PodcastShowSettingsDialog({ channel, onClose }: { channel: PodcastChannel | null; onClose(): void }) {
  return channel ? <Settings key={`${profileScopeId()}|${channel.id}`} channel={channel} onClose={onClose} /> : null;
}
function Settings({ channel, onClose }: { channel: PodcastChannel; onClose(): void }) {
  const t = useT(), toast = useToast((s) => s.show);
  const [owner] = useState(() => useAuthStore.getState().auth);
  const [profile] = useState(profileScopeId);
  const [value, setValue] = useState(() => ({ ...DEFAULT_PODCAST_PLAYBACK }));
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false);
  const owns = () => profile === profileScopeId() && owner === useAuthStore.getState().auth;
  useEffect(() => {
    let live = true;
    void usePodcastPreferences.getState().load().then(() => {
      if (live && owns()) { setValue({ ...getPodcastPreferences(channel.id) }); setReady(true); }
    }).catch(() => { if (live && owns()) toast(t("Couldn't load podcast settings.")); });
    const off = useAuthStore.subscribe(() => { if (!owns()) onClose(); });
    return () => { live = false; off(); };
    // The opening owns its account and callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const options = [0, 15, 30, 45, 60, 90, 120, 180, 300, 600].map((seconds) => ({ value: seconds, label: seconds ? t('{n} seconds', { n: seconds }) : t('Off') }));
  return <Dialog visible title={t('Podcast settings')} message={channel.title} confirmLabel={saving ? t('Saving…') : t('Save')}
    onCancel={() => { if (!saving) onClose(); }} onConfirm={() => {
      if (!ready || saving || !owns()) return;
      setSaving(true);
      void usePodcastPreferences.getState().save(channel.id, value).then((saved) => { if (saved && owns()) onClose(); })
        .catch(() => { if (owns()) toast(t("Couldn't save podcast settings.")); }).finally(() => setSaving(false));
    }} neutral={{ label: t('Restore defaults'), onPress: () => { if (ready && !saving) setValue({ ...DEFAULT_PODCAST_PLAYBACK }); } }}>
    {!ready ? <Text style={{ color: colors.textSecondary }}>{t('Loading…')}</Text> : <View pointerEvents={saving ? 'none' : 'auto'}>
      <SelectList label={t('Skip intro')} value={value.introSec} options={options} onChange={(introSec) => setValue((old) => ({ ...old, introSec }))} />
      <SelectList label={t('Skip outro')} value={value.outroSec} options={options} onChange={(outroSec) => setValue((old) => ({ ...old, outroSec }))} />
      <SwitchList options={[{ label: t('Continuous playback'), description: t('Play the next episode when this one ends.'), value: value.continuous, onChange: (continuous) => setValue((old) => ({ ...old, continuous })) }]} />
    </View>}
  </Dialog>;
}
