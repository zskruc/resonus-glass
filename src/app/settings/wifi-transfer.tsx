import { useEffect, useRef, useState } from 'react';
import { AppState, Text } from 'react-native';
import { useIsFocused } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SettingsGroup, SettingsPage, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { useT } from '@/i18n';
import { captureLyricOwner } from '@/lib/lyricOwner';
import { claimWifiTransfer, copyWifiTransferAddress, publishWifiTransferFiles, readWifiTransfer, startWifiTransfer, stopWifiTransfer, wifiTransferAvailable, wifiTransferTrackFileName, type TransferEntry, type WifiTransferSnapshot } from '@/lib/wifiTransfer';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { useDownloads } from '@/store/downloads';
import { podcastFile } from '@/store/podcastDownloads';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme';

export default function WifiTransferScreen() {
  useTheme();
  const t = useT(), toast = useToast((state) => state.show), focused = useIsFocused();
  const auth = useAuthStore((state) => state.auth), source = useAuthStore((state) => state.offlineSource);
  const [snapshot, setSnapshot] = useState<WifiTransferSnapshot>(), [busy, setBusy] = useState(false), [sharedCount, setSharedCount] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const ticket = useRef<number | undefined>(undefined), entries = useRef<TransferEntry[]>([]), copies = useRef<string[]>([]), active = useRef(false), mounted = useRef(true);
  const song = usePlayerStore(currentSong), files = useDownloads((state) => state.files);
  const local = song ? song.localUri ?? podcastFile(song) ?? files[song.id] : undefined;
  async function stop(clearFiles = false) {
    const old = ticket.current; ticket.current = undefined;
    if (mounted.current) setSnapshot(undefined);
    if (old !== undefined) await stopWifiTransfer(old).catch(() => {});
    if (!clearFiles) return;
    entries.current = []; if (mounted.current) setSharedCount(0);
    const owned = copies.current; copies.current = [];
    for (const uri of owned) if (FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory)) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  useEffect(() => { mounted.current = true; const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => { mounted.current = false; listener.remove(); void stop(true); }; }, []);
  useEffect(() => { return () => { void stop(true); }; }, [auth, source]);
  useEffect(() => { if (!foreground || !focused) void stop(); return () => { void stop(); }; }, [foreground, focused]);
  useEffect(() => {
    if (!snapshot?.running || !foreground || !focused) return;
    const old = ticket.current; let stopped = false, reading = false;
    const poll = async () => {
      if (old === undefined || reading || stopped) return; reading = true;
      try { const result = await readWifiTransfer(old); if (!stopped && result && ticket.current === old) setSnapshot(result); }
      catch { if (!stopped) { toast(t('Wi-Fi transfer stopped.')); void stop(); } } finally { reading = false; }
    };
    const timer = setInterval(() => void poll(), 1000); return () => { stopped = true; clearInterval(timer); };
  }, [snapshot?.running, foreground, focused, t, toast]);
  async function start() {
    if (active.current || !foreground || !focused) return; active.current = true; setBusy(true);
    const owns = captureLyricOwner(), token = claimWifiTransfer(); ticket.current = token;
    try { const result = await startWifiTransfer(token); if (!owns() || !mounted.current || !foreground || ticket.current !== token) { await stopWifiTransfer(token); return; }
      if (result?.running && entries.current.length) await publishWifiTransferFiles(token, entries.current);
      if (!owns() || ticket.current !== token) return;
      setSnapshot(await readWifiTransfer(token) ?? result); if (!result?.running) toast(t('Connect to a private Wi-Fi network and retry.')); }
    catch { if (owns()) toast(t('Connect to a private Wi-Fi network and retry.')); await stopWifiTransfer(token); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  async function addFiles() {
    if (active.current) return;
    active.current = true; setBusy(true); const owns = captureLyricOwner();
    try {
      if (snapshot?.running) { await stop(); toast(t('Transfer stopped. Start it again after choosing files.')); }
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const assets = result.assets;
      for (const asset of assets) if (FileSystem.cacheDirectory && asset.uri.startsWith(FileSystem.cacheDirectory)) copies.current.push(asset.uri);
      if (!owns() || !mounted.current) { await stop(true); return; }
      const next = [...entries.current];
      for (const asset of assets) { if (next.length >= 200) throw new Error('Too many shared files');
        const stat = await FileSystem.getInfoAsync(asset.uri); if (!owns() || !mounted.current) return;
        if (!stat.exists || stat.isDirectory || stat.size > (snapshot?.maxFileBytes ?? 512 * 1024 * 1024)) throw new Error('File is too large');
        next.push({ key: `file_${next.length}_${Date.now()}`, uri: asset.uri, name: asset.name, mime: asset.mimeType ?? 'application/octet-stream' }); }
      entries.current = next; setSharedCount(next.length);
    } catch { if (owns()) toast(t('Could not share these files. Check file size and permissions.')); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  return <SettingsPage title={t('Wi-Fi music transfer')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={settingsStyles.sectionDescription}>{t('Keep this page open. Open the address on another device on the same private Wi-Fi. Transfers stop when you leave this page or put the app in the background.')}</Text>
    <SettingsGroup><SettingRow label={t('Choose audio files to share')} right={String(sharedCount)} onPress={busy ? undefined : () => void addFiles()} />
      {local && song ? <SettingRow label={t('Share current downloaded track')} description={song.title} onPress={busy ? undefined : () => {
        if (active.current) return; active.current = true; setBusy(true); const owns = captureLyricOwner();
        void (async () => { if (snapshot?.running) { await stop(); toast(t('Transfer stopped. Start it again after choosing files.')); }
          if (!owns()) return;
          const next = [...entries.current, { key: `track_${Date.now()}`, uri: local, name: wifiTransferTrackFileName(song, local), mime: 'application/octet-stream' }];
          if (next.length > 200) throw new Error('Too many shared files'); entries.current = next; setSharedCount(next.length);
        })().catch(() => toast(t('Could not share these files. Check file size and permissions.'))).finally(() => { active.current = false; if (mounted.current) setBusy(false); });
      }} /> : null}
      <SettingRow label={t(snapshot?.running ? 'Stop transfer' : 'Start transfer')} onPress={busy || !wifiTransferAvailable ? undefined : () => { if (snapshot?.running) void stop(); else void start(); }} />
    </SettingsGroup>
    {snapshot?.running && snapshot.url ? <>
      <Text selectable style={settingsStyles.rowLabel}>{snapshot.url}</Text>
      <SettingsGroup><SettingRow label={t('Copy address')} onPress={() => { const token = ticket.current; if (token !== undefined && copyWifiTransferAddress(token)) toast(t('Copied')); }} /></SettingsGroup>
      <Text style={settingsStyles.sectionDescription}>{t('Long press the address to copy it. This address expires when transfer stops.')}</Text>
      <Text style={settingsStyles.groupTitle}>{t('Transfer progress')}</Text>
      <SettingsGroup>{snapshot.transfers.slice(-30).map((transfer) => <SettingRow key={transfer.id} label={transfer.name}
        description={t(transfer.state === 'done' ? 'Completed' : transfer.state === 'failed' ? 'Failed' : transfer.state === 'cancelled' ? 'Cancelled' : 'Transferring')}
        right={transfer.total > 0 ? `${Math.min(100, Math.round(transfer.received / transfer.total * 100))}%` : undefined} />)}</SettingsGroup>
      <Text style={settingsStyles.sectionDescription}>{t('Received songs are saved in Music / Resonus Glass / Transfer. Existing files are not overwritten. Scan phone music to include them in your library.')}</Text>
    </> : null}
  </DockScrollView></SettingsPage>;
}
