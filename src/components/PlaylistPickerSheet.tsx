/**
 * Floating playlist membership picker for individual songs or a multi-selection.
 * Adds missing songs or removes all selected instances, and creates playlists, so
 * it can be reused from any screen.
 *
 * Favorites is not a row here any more: it is a property of the song rather
 * than a list it belongs to, and this sheet could never take one off. It is in
 * the ⋯ menu of the selection now (#164).
 */
import { MenuGlassCardFrame, MenuGlassCardHeader } from '@/components/MenuGlassCard';
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';


import { addSongsToPlaylist, canEditPlaylist, COVER, coverArtUrl, createPlaylist, getPlaylists, playlistMembership, removeSongsFromPlaylist } from '@/api/data';
import { useScreenSize } from '@/hooks/useScreenSize';
import { type Song } from '@/api/subsonic';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { songsLabel, useT } from '@/i18n';
import { MenuRequestScope } from '@/lib/menuRequest';
import { membershipOf } from '@/lib/playlistMembership';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useAutoDownloads } from '@/store/autoDownloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';

/** Maximum height of the playlist list: proportional to the screen so it
 *  doesn't look cramped on large phones (previously a fixed 400), and read
 *  while rendering so a turn does not leave it taller than the screen (#131). */
function playlistsMaxH(height: number): number {
  return Math.round(height * 0.6);
}

/** Global instance (mounted once in the root layout): any place can open it
 *  via `usePlaylistPicker.open(songs)` without rendering its own sheet. */
export function GlobalPlaylistPicker() {
  const songs = usePlaylistPicker((s) => s.songs);
  const session = usePlaylistPicker((s) => s.session);
  const close = usePlaylistPicker((s) => s.close);
  return <PlaylistPickerSheet key={session} session={session} songs={songs} onClose={close} />;
}

type PlaylistPickerProps = {
  /** Songs to add; null = sheet hidden. */
  songs: Song[] | null;
  /** Playlist to hide from the list (the source one). */
  excludeId?: string;
  onClose: () => void;
  /** Global instances also reject callbacks before a replacement has rendered. */
  session?: number;
};

function pickerOwner(songs: Song[] | null, session: number | undefined, key: number) {
  const auth = useAuthStore.getState().auth;
  const offline = useAuthStore.getState().offline;
  const profile = profileScopeId();
  return {
    songs, session, key, auth, offline, profile,
    request: new MenuRequestScope(() => useAuthStore.getState().auth === auth
      && useAuthStore.getState().offline === offline && profileScopeId() === profile
      && (session === undefined || usePlaylistPicker.getState().session === session)),
  };
}

class PickerLifetime {
  private revision = 0;
  private active = true;
  constructor(private songs: Song[] | null) {}
  advance(songs: Song[] | null) { this.songs = songs; this.revision++; }
  setActive(active: boolean) { this.active = active; }
  ownsClosed(revision: number) {
    return this.active && this.revision === revision + 1 && this.songs === null;
  }
}

/** Local callers also receive a fresh state and scope when their song batch changes. */
export function PlaylistPickerSheet(props: PlaylistPickerProps) {
  const auth = useAuthStore((state) => state.auth);
  const offline = useAuthStore((state) => state.offline);
  const [lifetime] = useState(() => new PickerLifetime(props.songs));
  const [owner, setOwner] = useState(() => pickerOwner(props.songs, props.session, 0));
  useEffect(() => {
    lifetime.setActive(true);
    return () => lifetime.setActive(false);
  }, [lifetime]);
  if (owner.songs !== props.songs || owner.session !== props.session) {
    lifetime.advance(props.songs);
    owner.request.dispose();
    setOwner(pickerOwner(props.songs, props.session, owner.key + 1));
  }
  const profileChanged = owner.auth !== auth || owner.offline !== offline || owner.profile !== profileScopeId();
  const { songs: selectedSongs, onClose, session } = props;
  useEffect(() => {
    if (profileChanged && selectedSongs && (session === undefined || usePlaylistPicker.getState().session === session)) onClose();
  }, [profileChanged, selectedSongs, onClose, session]);
  if (profileChanged) return null;
  const canNotifyAfterClose = () => {
    if (props.session === undefined) return lifetime.ownsClosed(owner.key);
    const current = usePlaylistPicker.getState();
    return current.session === props.session + 1 && current.songs === null;
  };
  return <PlaylistPickerSession key={owner.key} {...props} request={owner.request}
    canNotifyAfterClose={canNotifyAfterClose} />;
}

function PlaylistPickerSession({ songs, excludeId, onClose, request }: PlaylistPickerProps & {
  request: MenuRequestScope;
  canNotifyAfterClose: () => boolean;
}) {
  const { height: screenH } = useScreenSize();
  const queryClient = useQueryClient();
  const toast = useToast((state) => state.show);
  const t = useT();
  const lang = useSettings((state) => state.language);
  const mounted = useRef(false);
  const closing = useRef(false);
  const gestureTicket = useRef<number | null>(null);
  const busyRow = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState<number | null>(null);
  const [present, setPresent] = useState<Record<string, string[]>>({});
  const touched = useRef(new Set<string>());
  const completedReads = useRef(new Map<string, string | undefined>());
  const visible = !!songs?.length;
  const wanted = useMemo(() => [...new Set((songs ?? []).map((song) => song.id))], [songs]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.invalidate(); };
  }, [request]);
  const owns = (ticket: number) => mounted.current && request.owns(ticket);
  const closeAfterGesture = () => {
    const ticket = gestureTicket.current;
    if (ticket === null || !owns(ticket)) return;
    closing.current = true; request.invalidate(); onClose();
  };
  const { dismiss, dismissing, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(visible, closeAfterGesture, 'card');
  const canAct = () => mounted.current && !closing.current && !dismissing.value && request.isActive();
  const close = () => {
    if (!canAct()) return;
    closing.current = true;
    const ticket = request.begin();
    dismiss(() => { if (owns(ticket)) onClose(); });
  };
  const { data: playlists, isLoading } = useQuery({ queryKey: ['playlists'], queryFn: () => getPlaylists(), enabled: visible });
  const targets = useMemo(() => (playlists ?? []).filter((playlist) => playlist.id !== excludeId), [playlists, excludeId]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const lists = targets.filter((playlist) => canEditPlaylist(playlist) && !touched.current.has(playlist.id)
      && (!completedReads.current.has(playlist.id) || completedReads.current.get(playlist.id) !== playlist.changed));
    const current = () => active && mounted.current && request.isActive() && !closing.current;
    void playlistMembership(lists, wanted, (id, ids) => {
      if (!current() || touched.current.has(id)) return;
      completedReads.current.set(id, lists.find((playlist) => playlist.id === id)?.changed);
      setPresent((previous) => ({ ...previous, [id]: ids }));
    }, () => !current()).catch(() => {
      if (!current()) return;
      // The mutation itself reads fresh data and fails closed; a failed mark
      // lookup may offer a safe add attempt, never an unverified removal.
      setPresent((previous) => {
        const next = { ...previous };
        for (const playlist of lists) next[playlist.id] ??= [];
        return next;
      });
    });
    return () => { active = false; };
  }, [visible, targets, wanted, request]);

  if (!visible || !songs) return null;
  const refresh = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: ['playlist', id] });
    void queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };
  const failure = (error: unknown, removing = false) => {
    const message = error instanceof Error ? error.message : '';
    toast(message === 'This playlist cannot be edited.' ? t('This playlist cannot be edited.')
      : message === 'Playlist changed. Reopen it and try again.' ? t('Playlist changed. Reopen it and try again.')
      : removing ? t("Couldn't complete the action") : t("Couldn't add to the playlist"));
  };
  async function toggle(id: string) {
    const playlist = targets.find((item) => item.id === id);
    if (!canAct() || busyRow.current || !playlist || !canEditPlaylist(playlist) || !present[id]) return;
    const ticket = request.begin();
    busyRow.current = id; setBusy(id); touched.current.add(id);
    const removing = membershipOf(present[id], wanted) === 'all';
    try {
      const ids = removing
        ? await removeSongsFromPlaylist(id, wanted, { stillCurrent: () => owns(ticket) })
        : await addSongsToPlaylist(id, songs!, { stillCurrent: () => owns(ticket) });
      if (!owns(ticket)) return;
      setPresent((previous) => ({ ...previous, [id]: ids }));
      refresh(id);
      if (!removing) void useAutoDownloads.getState().reconcile(id, true);
    } catch (error) {
      if (!owns(ticket)) return;
      failure(error, removing); refresh(id);
      // A batch may have partly committed before a network error. Re-read
      // membership rather than pretending the old checkbox is still exact.
      touched.current.delete(id); completedReads.current.delete(id);
      await playlistMembership([playlist], wanted, (target, ids) => {
        if (owns(ticket)) setPresent((previous) => ({ ...previous, [target]: ids }));
      }, () => !owns(ticket), { fresh: true }).catch(() => {});
    } finally {
      busyRow.current = null;
      if (owns(ticket)) setBusy(null);
    }
  }
  const cancelCreating = () => {
    if (creating === null || !owns(creating) || !canAct()) return;
    request.invalidate(); setCreating(null);
  };
  async function createAndAdd(name: string) {
    const expected = creating;
    if (expected === null || !owns(expected) || !canAct() || busyRow.current || !name.trim()) return;
    const ticket = request.begin();
    const owner = useAuthStore.getState().auth, profile = profileScopeId(), offline = useAuthStore.getState().offline;
    const sameProfile = () => useAuthStore.getState().auth === owner && profileScopeId() === profile && useAuthStore.getState().offline === offline;
    busyRow.current = 'create'; setBusy('create'); setCreating(null);
    try {
      const id = await createPlaylist(name.trim());
      if (!sameProfile()) return;
      const ids = await addSongsToPlaylist(id, songs!, { stillCurrent: sameProfile });
      if (!owns(ticket)) return;
      touched.current.add(id); setPresent((previous) => ({ ...previous, [id]: ids })); refresh(id);
      void useAutoDownloads.getState().reconcile(id, true);
    } catch (error) { if (owns(ticket)) failure(error); }
    finally { busyRow.current = null; if (owns(ticket)) setBusy(null); }
  }
  return <Modal transparent animationType="none" visible onRequestClose={() => creating !== null ? cancelCreating() : close()}>
    {creating === null && <MenuGlassCardFrame onClose={close} backdropStyle={backdropStyle} cardStyle={sheetStyle} onLayout={onSheetLayout}>
      <MenuGlassCardHeader title={t('Manage playlists')} onClose={close} />
      <Text style={styles.description}>{t('Add missing songs or remove all matching entries from a selected playlist.')}</Text>
      <View style={{ maxHeight: playlistsMaxH(screenH), flexShrink: 1, minHeight: 0 }}>
        <Pressable disabled={!!busy} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          onPress={() => { if (!canAct() || busyRow.current) return; setCreating(request.begin()); }}>
          <View style={styles.newPlaylistIcon}><Icon name="add" size={24} color={colors.text} /></View>
          <Text style={styles.rowText}>{t('New playlist')}</Text>
          {busy === 'create' && <ActivityIndicator size="small" color={colors.accent} />}
        </Pressable>
        {isLoading ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} /> :
          <ScrollView style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled">
            {targets.map((playlist) => {
              const ids = present[playlist.id];
              const editable = canEditPlaylist(playlist);
              const state = ids ? membershipOf(ids, wanted) : null;
              return <Pressable key={playlist.id} disabled={!editable || !ids || !!busy}
                accessibilityRole="checkbox" accessibilityState={{ checked: state === 'some' ? 'mixed' : state === 'all', disabled: !editable || !ids || !!busy }}
                style={({ pressed }) => [styles.row, !editable && { opacity: 0.55 }, pressed && { opacity: 0.6 }]}
                onPress={() => void toggle(playlist.id)}>
                <Cover uri={coverArtUrl(playlist.coverArt ?? playlist.id, COVER.thumb)} size={40} />
                <View style={styles.rowBody}><Text style={styles.rowText} numberOfLines={1}>{playlist.name}</Text>
                  {!editable ? <Text style={styles.rowCount}>{t('Read-only playlist')}</Text>
                    : state === 'some' ? <Text style={styles.rowCount}>{t('{n} of {songs}', { n: ids!.length, songs: songsLabel(wanted.length, lang) })}</Text>
                    : state === 'all' ? <Text style={styles.rowCount}>{t('Remove all matching entries')}</Text> : null}
                </View>
                {busy === playlist.id || !ids && editable ? <ActivityIndicator size="small" color={colors.textMuted} />
                  : <Icon name={!editable ? 'lock-closed-outline' : state === 'all' ? 'checkmark-circle' : state === 'some' ? 'remove-circle-outline' : 'ellipse-outline'}
                    size={24} color={state === 'all' || state === 'some' ? colors.accent : colors.textMuted} />}
              </Pressable>;
            })}
          </ScrollView>}
      </View>
    </MenuGlassCardFrame>}
    <Dialog inlineMenu visible={creating !== null} title={t('New playlist')} input={{ placeholder: t('Playlist name') }} confirmLabel={t('Create')}
      onCancel={cancelCreating} onConfirm={createAndAdd} />
  </Modal>;
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: 'transparent',
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    // Smaller than the old spacing.lg because the grabber below already brings
    // its own margin: together they add up to the same top gap as before.
    paddingTop: spacing.sm,
  },
  // Spotify's little handle. Its only job is to advertise the drag gesture, so
  // it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', paddingBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
  rowBody: { flex: 1 },
  rowCount: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 4 },
  description: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.sm },
  newPlaylistIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
