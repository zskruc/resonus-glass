/**
 * Bottom sheet to pick a target playlist and add songs in bulk (multi-select).
 * Allows creating a new playlist. Handles the addition and toasts itself, so
 * it can be reused from any screen.
 *
 * Favorites is not a row here any more: it is a property of the song rather
 * than a list it belongs to, and this sheet could never take one off. It is in
 * the ⋯ menu of the selection now (#164).
 */
import { MenuGlassCardFrame, MenuGlassCardHeader } from '@/components/MenuGlassCard';
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';


import { addToPlaylist, COVER, coverArtUrl, createPlaylist, getPlaylist, getPlaylists } from '@/api/data';
import { useScreenSize } from '@/hooks/useScreenSize';
import { type Song } from '@/api/subsonic';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { songsLabel, useT } from '@/i18n';
import { MenuRequestScope } from '@/lib/menuRequest';
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
  return {
    songs, session, key,
    request: new MenuRequestScope(() => session === undefined || usePlaylistPicker.getState().session === session),
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
  const canNotifyAfterClose = () => {
    if (props.session === undefined) return lifetime.ownsClosed(owner.key);
    const current = usePlaylistPicker.getState();
    return current.session === props.session + 1 && current.songs === null;
  };
  return <PlaylistPickerSession key={owner.key} {...props} request={owner.request}
    canNotifyAfterClose={canNotifyAfterClose} />;
}

function PlaylistPickerSession({ songs, excludeId, onClose, request, canNotifyAfterClose }: PlaylistPickerProps & {
  request: MenuRequestScope;
  canNotifyAfterClose: () => boolean;
}) {
  const { height: screenH } = useScreenSize();
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const mounted = useRef(false);
  const closing = useRef(false);
  const gestureTicket = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.invalidate();
    };
  }, [request]);
  const owns = (ticket: number) => mounted.current && request.owns(ticket);
  const closeAfterGesture = () => {
    const ticket = gestureTicket.current;
    if (ticket === null || !owns(ticket)) return;
    closing.current = true;
    request.invalidate();
    onClose();
  };
  const visible = !!songs && songs.length > 0;
  const { dismiss, dismissing, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    visible,
    closeAfterGesture,
    'card',
  );
  const canAct = () => mounted.current && !closing.current && !dismissing.value && request.isActive();
  const close = () => {
    if (!canAct()) return;
    closing.current = true;
    const ticket = request.begin();
    dismiss(() => { if (owns(ticket)) onClose(); });
  };
  const [creating, setCreating] = useState<number | null>(null);
  // "Already in the playlist" prompt pending confirmation (Spotify style).
  const [dupPrompt, setDupPrompt] = useState<{
    ticket: number;
    playlistId: string;
    name: string;
    /** The ones not in that playlist yet. Empty when every one of them is. */
    fresh: Song[];
  } | null>(null);

  const { data: playlists, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: visible,
  });

  if (!songs || songs.length === 0) return null;

  const beginAction = () => {
    if (!canAct()) return null;
    const ticket = request.begin();
    setCreating(null);
    setDupPrompt(null);
    return ticket;
  };
  const cancelCreating = (ticket: number | null) => {
    if (ticket === null || !owns(ticket)) return;
    request.invalidate();
    setCreating(null);
  };
  const cancelDuplicate = (ticket: number | undefined) => {
    if (ticket === undefined || !owns(ticket)) return;
    request.invalidate();
    setDupPrompt(null);
  };

  /** A mutation keeps its batch; only its own close and notices remain cancellable. */
  function transactionUi(ticket: number) {
    let closeTicket: number | null = null;
    let closed = false;
    return {
      current: () => closed ? canNotifyAfterClose() : owns(closeTicket ?? ticket),
      close: () => {
        if (!canAct() || !owns(ticket)) return;
        closing.current = true;
        closeTicket = request.begin();
        const expected = closeTicket;
        dismiss(() => {
          if (!owns(expected)) return;
          closed = true;
          onClose();
        });
      },
    };
  }

  async function addBatch(playlistId: string, name: string, adding: Song[], ui: ReturnType<typeof transactionUi>) {
    ui.close();
    try {
      for (const s of adding) await addToPlaylist(playlistId, s.id);
      // Optimistic count in the Library (`songsLabel`): without this the
      // subtitle doesn't update until that screen is reloaded.
      queryClient.setQueryData<{ id: string; songCount?: number }[]>(['playlists'], (list) =>
        list?.map((p) =>
          p.id === playlistId ? { ...p, songCount: (p.songCount ?? 0) + adding.length } : p,
        ),
      );
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      // If the list has auto-download, fetch the newly added songs now.
      void useAutoDownloads.getState().reconcile(playlistId, true);
      if (ui.current()) toast(
        adding.length === 1
          ? t('Added to “{name}”', { name })
          : t('{n} added to “{name}”', { n: adding.length, name }),
      );
    } catch {
      if (ui.current()) toast(t("Couldn't add to the playlist"));
    }
  }

  /** Duplicate confirmation has not committed anything until this guard passes. */
  async function doAdd(playlistId: string, name: string, ticket: number, which?: Song[]) {
    if (!canAct() || !owns(ticket)) return;
    const adding = [...(which ?? songs ?? [])];
    if (adding.length === 0) return;
    await addBatch(playlistId, name, adding, transactionUi(ticket));
  }

  async function addAllTo(playlistId: string, name: string, currentTicket?: number) {
    const ticket = currentTicket ?? beginAction();
    if (ticket === null || !songs || !owns(ticket)) return;
    // Spotify-style duplicate warning: if any already present, ask first. If
    // the check fails (network), add without warning: better than blocking.
    try {
      const { songs: existing } = await getPlaylist(playlistId);
      if (!owns(ticket)) return;
      const have = new Set(existing.map((s) => s.id));
      const fresh = songs.filter((s) => !have.has(s.id));
      if (fresh.length < songs.length) {
        setCreating(null);
        setDupPrompt({ ticket, playlistId, name, fresh });
        return;
      }
    } catch {
      // ignore
    }
    if (!owns(ticket)) return;
    await doAdd(playlistId, name, ticket);
  }

  /** The warning has something to offer besides adding them all again. */
  const hasFresh = !!dupPrompt && dupPrompt.fresh.length > 0;

  async function createAndAdd(name: string, expectedTicket: number | null) {
    if (expectedTicket === null || !owns(expectedTicket)) return;
    const ticket = beginAction();
    if (ticket === null) return;
    const playlistName = name.trim();
    const adding = [...(songs ?? [])];
    if (!playlistName || adding.length === 0) return;
    const ui = transactionUi(ticket);
    try {
      // Creating commits the complete transaction. A new playlist is empty,
      // so its originally confirmed songs need no duplicate preflight.
      const id = await createPlaylist(playlistName);
      await addBatch(id, playlistName, adding, ui);
    } catch {
      if (!ui.current()) return;
      ui.close();
      if (ui.current()) toast(t("Couldn't create the playlist"));
    }
  }

  return (
    <Modal transparent animationType="none" visible onRequestClose={() => {
      if (creating !== null) cancelCreating(creating);
      else if (dupPrompt) cancelDuplicate(dupPrompt.ticket);
      else close();
    }}>
      {/* Gestures inside an RN Modal need a root view of their own: the Modal
          renders in a native hierarchy outside the app's. */}
      {creating === null && !dupPrompt && <MenuGlassCardFrame onClose={close}
        backdropStyle={backdropStyle} cardStyle={sheetStyle} onLayout={onSheetLayout}>
          <MenuGlassCardHeader title={t('Add to a playlist')} onClose={close} />
          <View style={{ maxHeight: playlistsMaxH(screenH), flexShrink: 1, minHeight: 0 }}>
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  const ticket = beginAction();
                  if (ticket === null) return;
                  setCreating(ticket);
                }}
              >
                <View style={styles.newPlaylistIcon}>
                  <Icon name="add" size={24} color={colors.text} />
                </View>
                <Text style={styles.rowText}>{t('New playlist')}</Text>
              </Pressable>
              {isLoading ? (
                <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
              ) : (
                <ScrollView
                  style={{ flexShrink: 1, minHeight: 0 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {(playlists ?? [])
                    .filter((p) => p.id !== excludeId)
                    .map((p) => (
                      <Pressable
                        key={p.id}
                        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                        onPress={() => addAllTo(p.id, p.name)}
                      >
                        <Cover uri={coverArtUrl(p.coverArt ?? p.id, COVER.thumb)} size={40} />
                        <Text style={styles.rowText} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </Pressable>
                    ))}
                </ScrollView>
              )}
          </View>
      </MenuGlassCardFrame>}

      <Dialog
        inlineMenu
        visible={creating !== null}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => cancelCreating(creating)}
        onConfirm={(name) => createAndAdd(name, creating)}
      />

      {/* Three ways out rather than a switch inside the dialog (#132). A switch
          would be state to read and understand before pressing a button that no
          longer does what it says; each of these says what it does. With none
          of them new there is nothing to skip, so the pair collapses back into
          the single button it always was. */}
      <Dialog
        inlineMenu
        visible={!!dupPrompt}
        title={t('Already added')}
        // The counts are in the sentence because the two cases used to be one
        // word apart ("some of these" against "these"), and the one where none
        // of them are new drops the second button as well, so it came out
        // looking like the old warning that could only be answered by putting
        // every song in again (#132). "All" rather than "12 of 12": nothing to
        // skip should read as its own sentence, not as arithmetic.
        message={
          dupPrompt
            ? songs.length === 1
              ? t('This song is already in “{name}”.', { name: dupPrompt.name })
              : hasFresh
                ? t('{n} of {songs} are already in “{name}”.', {
                    n: songs.length - dupPrompt.fresh.length,
                    songs: songsLabel(songs.length, lang),
                    name: dupPrompt.name,
                  })
                : t('All {songs} are already in “{name}”.', {
                    songs: songsLabel(songs.length, lang),
                    name: dupPrompt.name,
                  })
            : undefined
        }
        // Adding only the new ones is the confirm, in the corner and in the
        // accent: it is the one nearly everybody wants and the only one that
        // cannot go wrong. Adding them all again sits right on top of it, not
        // off in the left corner where "Don't remind me" goes: these two are
        // both answers to the same question and get read one against the
        // other, so they belong in the same column.
        neutral={
          hasFresh
            ? {
                label: t('Add anyway'),
                align: 'end',
                onPress: () => {
                  const d = dupPrompt;
                  if (!d || !owns(d.ticket)) return;
                  setDupPrompt(null);
                  void doAdd(d.playlistId, d.name, d.ticket);
                },
              }
            : undefined
        }
        confirmLabel={hasFresh ? t('Add only the new ones') : t('Add anyway')}
        onCancel={() => cancelDuplicate(dupPrompt?.ticket)}
        onConfirm={() => {
          const d = dupPrompt;
          if (!d || !owns(d.ticket)) return;
          setDupPrompt(null);
          void doAdd(d.playlistId, d.name, d.ticket, hasFresh ? d.fresh : undefined);
        }}
      />
    </Modal>
  );
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
  rowText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  newPlaylistIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
