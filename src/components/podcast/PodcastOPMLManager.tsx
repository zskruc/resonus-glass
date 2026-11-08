/** OPML exchange uses the existing subscription API; importing never downloads episode audio. */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Text, View } from 'react-native';

import { listAddedChannels, subscribe } from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { MenuGlassCardFrame, MenuGlassCardHeader } from '@/components/MenuGlassCard';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { createPodcastOPMLImporter, exportPodcastOPML, parsePodcastOPML, PODCAST_OPML_MAX_BYTES,
  type PodcastOPMLImportPlan, type PodcastOPMLImportSnapshot } from '@/lib/podcastOPML';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

export interface PodcastOPMLManagerProps { visible: boolean; onClose(): void; onImported?(): void }
export function PodcastOPMLManager({ visible, ...props }: PodcastOPMLManagerProps) {
  return visible ? <PodcastOPMLSession {...props} /> : null;
}
const EMPTY: PodcastOPMLImportSnapshot = { rows: [], running: false, stopped: false };

function PodcastOPMLSession({ onClose, onImported }: Omit<PodcastOPMLManagerProps, 'visible'>) {
  useTheme(); const t = useT();
  const offline = useAuthStore((state) => state.offline && !state.autoOffline);
  const [owner] = useState(() => ({ auth: useAuthStore.getState().auth, profile: profileScopeId() }));
  const live = useRef(true), revision = useRef(0), close = useRef(onClose), imported = useRef(onImported);
  useEffect(() => { close.current = onClose; imported.current = onImported; }, [onClose, onImported]);
  const [busy, setBusy] = useState<'read' | 'import' | 'export' | null>(null);
  const busyRef = useRef<typeof busy>(null);
  const [plan, setPlan] = useState<PodcastOPMLImportPlan | null>(null);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const importer = useMemo(() => createPodcastOPMLImporter({ owner: () => owner,
    profile: profileScopeId, allowed: () => !isManualOffline(), added: listAddedChannels, subscribe }), [owner]);
  const current = (ticket: number) => live.current && ticket === revision.current
    && owner.auth === useAuthStore.getState().auth && owner.profile === profileScopeId();
  useEffect(() => {
    live.current = true;
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.auth !== owner.auth || profileScopeId() !== owner.profile) {
        revision.current++; importer.cancel(); close.current();
      } else if (isManualOffline()) importer.stop();
    });
    return () => { live.current = false; importer.cancel(); unsubscribe(); };
  }, [importer, owner]);
  const dismiss = () => { revision.current++; importer.cancel(); onClose(); };
  const begin = (kind: NonNullable<typeof busy>) => {
    if (busyRef.current) return null;
    busyRef.current = kind; setBusy(kind); return ++revision.current;
  };
  const finish = (ticket: number) => { if (current(ticket)) { busyRef.current = null; setBusy(null); } };

  async function choose() {
    const ticket = begin('read'); if (ticket === null) return;
    importer.cancel(); setPlan(null); setSnapshot(EMPTY); setError(''); setNotice('');
    let copied: string | undefined;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
      if (picked.canceled) return;
      const file = picked.assets[0]; if (!file) throw new Error('No document');
      if (FileSystem.cacheDirectory && file.uri.startsWith(FileSystem.cacheDirectory)) copied = file.uri;
      if (!current(ticket)) return;
      const info = await FileSystem.getInfoAsync(file.uri);
      if (!current(ticket)) return;
      if (!info.exists || info.isDirectory || (info.size ?? file.size ?? Infinity) > PODCAST_OPML_MAX_BYTES) throw new Error('Document too large');
      const text = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
      if (!current(ticket)) return;
      const parsed = parsePodcastOPML(text);
      const prepared = await importer.prepare(parsed.entries);
      if (!current(ticket) || !prepared) return;
      setPlan(prepared); setSnapshot(importer.snapshot(prepared));
      setNotice(t('{n} unique subscriptions. {duplicates} duplicates and {invalid} invalid addresses skipped.',
        { n: parsed.entries.length, duplicates: parsed.duplicates, invalid: parsed.invalid }));
    } catch {
      if (current(ticket)) setError(t('Could not read this OPML file. Choose a valid file smaller than 2 MB.'));
    } finally {
      // The picker made this cache copy for this operation. Never unlink a provider's original document.
      if (copied) await FileSystem.deleteAsync(copied, { idempotent: true }).catch(() => {});
      finish(ticket);
    }
  }

  async function start(retry = false) {
    if (!plan || !importer.owns(plan)) return;
    const ticket = begin('import'); if (ticket === null) return;
    setError('');
    try {
      const result = await importer.start(plan, (next) => { if (current(ticket)) setSnapshot(next); }, retry);
      if (current(ticket) && result.rows.some((row) => row.status === 'imported')) imported.current?.();
    } catch { if (current(ticket)) setError(t('Import stopped. Go online and try again.')); }
    finally { finish(ticket); }
  }

  async function share() {
    const ticket = begin('export'); if (ticket === null) return;
    setError('');
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable');
      if (!current(ticket)) return;
      const shows = await listAddedChannels(); if (!current(ticket)) return;
      const result = exportPodcastOPML(shows);
      if (!result.exported) { setError(t('No subscriptions with exportable feed addresses.')); return; }
      if (!FileSystem.cacheDirectory) throw new Error('No cache directory');
      const directory = `${FileSystem.cacheDirectory}podcast-opml/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true }); if (!current(ticket)) return;
      const file = `${directory}Resonus-Glass-subscriptions-${Date.now()}.opml`;
      await FileSystem.writeAsStringAsync(file, result.xml, { encoding: FileSystem.EncodingType.UTF8 });
      if (!current(ticket)) { await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {}); return; }
      await Sharing.shareAsync(file, { mimeType: 'text/x-opml', UTI: 'public.xml', dialogTitle: t('Export podcast subscriptions') });
      // Keep the accepted share's cache file available to its receiving app. The OS can evict it later.
      if (current(ticket)) setNotice(t('{n} subscriptions exported. {skipped} private or invalid addresses were excluded.',
        { n: result.exported, skipped: result.skippedSensitive + result.skippedInvalid }));
    } catch { if (current(ticket)) setError(t('Could not export podcast subscriptions.')); }
    finally { finish(ticket); }
  }

  const count = (status: string) => snapshot.rows.filter((row) => row.status === status).length;
  const done = count('existing') + count('imported') + count('failed');
  const labels = { pending: 'Ready to import', existing: 'Already subscribed', working: 'Importing', imported: 'Imported', failed: 'Failed' };
  return <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={dismiss}>
    <MenuGlassCardFrame maxWidth={430} onClose={dismiss}>
      <MenuGlassCardHeader title={t('Podcast subscriptions')} onClose={dismiss}
        subtitle={t('Import or export OPML. Importing adds shows without downloading audio.')} />
      <FlatList {...listPerf} style={styles.list} data={snapshot.rows} keyExtractor={(row) => row.entry.feedUrl}
        contentContainerStyle={styles.content} ListHeaderComponent={<View style={styles.tools}>
          <OPMLButton label={t('Choose OPML file')} onPress={() => { void choose(); }} disabled={!!busy} />
          <OPMLButton label={t('Export subscriptions')} onPress={() => { void share(); }} disabled={!!busy} />
          {busy === 'read' || busy === 'export' ? <ActivityIndicator color={colors.accent} /> : null}
          {notice ? <Text style={styles.hint}>{notice}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {offline ? <Text style={styles.hint}>{t('Go online to import subscriptions. Export is available offline.')}</Text> : null}
          {snapshot.rows.length ? <>
            <Text accessibilityLiveRegion="polite" style={styles.progressText}>{t('{done} of {total} processed · {added} added · {failed} failed',
              { done, total: snapshot.rows.length, added: count('imported'), failed: count('failed') })}</Text>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: snapshot.rows.length, now: done }} style={styles.progress}>
              <View style={[styles.fill, { width: `${100 * done / snapshot.rows.length}%` }]} />
            </View>
            {busy === 'import' ? <OPMLButton label={t('Stop import')} onPress={() => importer.stop()} /> : <>
              {count('pending') ? <OPMLButton label={t(snapshot.stopped ? 'Continue import' : 'Import new subscriptions')}
                onPress={() => { void start(); }} disabled={!!busy || offline} primary /> : null}
              {count('failed') ? <OPMLButton label={t('Retry failed subscriptions')} onPress={() => { void start(true); }} disabled={!!busy || offline} /> : null}
            </>}
          </> : null}
        </View>}
        renderItem={({ item }) => <View style={styles.row}>
          {item.status === 'working' ? <ActivityIndicator size="small" color={colors.accent} />
            : <Icon name={item.status === 'failed' ? 'alert-circle-outline' : item.status === 'imported' || item.status === 'existing' ? 'checkmark-circle' : 'radio-outline'}
              size={22} color={item.status === 'failed' ? colors.danger : colors.accent} />}
          <View style={styles.info}><Text style={styles.title} numberOfLines={2}>{item.entry.title || new URL(item.entry.feedUrl).hostname}</Text>
            <Text style={styles.hint} numberOfLines={1}>{t(labels[item.status])}</Text></View>
        </View>} />
    </MenuGlassCardFrame>
  </Modal>;
}

function OPMLButton({ label, onPress, disabled = false, primary = false }: { label: string; onPress(): void; disabled?: boolean; primary?: boolean }) {
  return <GlassPressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.button, primary && { backgroundColor: colors.accent }, disabled && { opacity: .45 }]}>
    <Text style={[styles.buttonText, primary && { color: colors.onAccent }]}>{label}</Text>
  </GlassPressable>;
}

const styles = themed((colors) => ({
  list: { flexShrink: 1, minHeight: 0 }, content: { paddingBottom: spacing.sm }, tools: { gap: spacing.sm, paddingBottom: spacing.md },
  button: { minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceHighlight }, buttonText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 }, error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  progressText: { color: colors.text, fontSize: 13, lineHeight: 19 }, progress: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceHighlight },
  fill: { height: 5, backgroundColor: colors.accent }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  info: { flex: 1 }, title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
}));
