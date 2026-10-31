/** Shared floating card with actions for a song (⋯ menu). */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
} from 'react-native';

import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useScreenSize } from '@/hooks/useScreenSize';
import {
  addToPlaylist,
  canGoIntoPlaylist,
  coverArtUrl,
  songCoverUrl,
  createPlaylist,
  getPlaylist,
  getPlaylists,
  removeFromPlaylist,
  reorderPlaylist,
  star,
  unstar,
  type Song,
  COVER,
} from '@/api/data';
import { useCanShare } from '@/hooks/useCanShare';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { applyStarChange, resyncFavorites } from '@/lib/favoritesCache';
import { artistTargets } from '@/lib/artistNav';
import { exportToFolder, shareSongFile } from '@/lib/exportSong';
import { useSharePicker } from '@/store/sharePicker';
import { normKey, pickFolder } from '@/lib/localLibrary';
import { MenuRequestScope } from '@/lib/menuRequest';
import { useArtistPicker } from '@/store/artistPicker';
import { useAuthStore } from '@/store/auth';
import { useAutoDownloads } from '@/store/autoDownloads';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSongInfo } from '@/store/songInfo';
import { useSongMenu } from '@/store/songMenu';
import { showUndoToast, useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';
import { StarRating } from './StarRating';
import { MenuGlassCardFrame } from './MenuGlassCard';

const MenuCardContext = createContext(false);

/** A card scrolls as one surface, including its header and every submenu. */
function MenuContent({ card, maxHeight, contentKey, children }: {
  card: boolean;
  maxHeight: number;
  contentKey: string;
  children: ReactNode;
}) {
  return card ? (
    <ScrollView key={contentKey} style={{ maxHeight, flexShrink: 1, minHeight: 0 }} contentContainerStyle={styles.cardContent}
      keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : <>{children}</>;
}

/** Keep the sheet's existing lists; the card's outer scroll owns their drag. */
function MenuList({ card, ...props }: ScrollViewProps & { card: boolean }) {
  return card ? <View>{props.children}</View> : <ScrollView {...props} />;
}

/** Maximum height of the playlist list: proportional to the screen so it
 *  doesn't look cramped on large phones (previously a fixed 360). Measured
 *  while rendering, or a phone turned on its side gets a menu taller than the
 *  screen it is on (#131). */
function playlistsMaxH(height: number): number {
  return Math.round(height * 0.6);
}

/** Height of one action row: its vertical padding plus the icon, the tallest
 *  thing in it (`styles.action`). */
const ACTION_H = spacing.md * 2 + 24;

/**
 * How much of the action list opens without scrolling.
 *
 * The half row is the point: a row cut by the bottom edge is what tells you
 * there's more below, which a clean cut wouldn't (Spotify does the same). The
 * screen fraction caps it so the sheet doesn't swallow a short phone whole; it
 * goes up with the row count, or it would take the half row's place as the
 * limit and cut wherever it happened to land.
 */
function actionsMaxH(height: number): number {
  return Math.min(ACTION_H * 9.5, Math.round(height * 0.58));
}

/**
 * Minutes remaining until expiration, minimum 1.
 *
 * Rounded down, like any countdown: with 14:50 left it shows 14, same as a
 * clock. Rounding up would show 15 until exactly 14:00, so the first full
 * minute would repeat the chosen number — exactly what this label is meant to
 * avoid.
 *
 * The minimum of 1 is for the last minute: "0 min" would read as if the timer
 * is already gone, and it's still there.
 */
function minutesLeft(endsAt: number): number {
  return Math.max(1, Math.floor((endsAt - Date.now()) / 60_000));
}


function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Icon.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const card = useContext(MenuCardContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, card && styles.cardAction, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Icon name={icon} size={card ? 20 : 24} color={colors.text} />
      <Text style={[styles.actionText, card && styles.cardActionText]}>{label}</Text>
    </Pressable>
  );
}

/** Only the opt-in AMLL player adds these global playback-mode actions. */
function PlaybackModeActions({ canChange }: { canChange: () => boolean }) {
  const card = useContext(MenuCardContext);
  const t = useT();
  const shuffle = usePlayerStore((state) => state.shuffle);
  const repeat = usePlayerStore((state) => state.repeat);
  const repeatLabel = repeat === 'one' ? t('Repeat one song') : repeat === 'all' ? t('Repeat all songs') : t('Off');
  return (
    <>
      <Pressable accessibilityRole="switch" accessibilityLabel={t('Shuffle')}
        accessibilityState={{ checked: shuffle }}
        onPress={() => { if (canChange()) usePlayerStore.getState().toggleShuffle(); }}
        style={({ pressed }) => [styles.action, card && styles.cardAction, pressed && { opacity: .6 }]}>
        <Icon name="shuffle" size={card ? 20 : 24} color={colors.text} />
        <Text style={[styles.actionText, card && styles.cardActionText, { flex: 1 }]}>{t('Shuffle')}</Text>
        <Text style={styles.modeValue}>{shuffle ? t('On') : t('Off')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('Repeat')}: ${repeatLabel}`}
        accessibilityValue={{ text: repeatLabel }}
        onPress={() => { if (canChange()) usePlayerStore.getState().cycleRepeat(); }}
        style={({ pressed }) => [styles.action, card && styles.cardAction, pressed && { opacity: .6 }]}>
        <Icon name={repeat === 'one' ? 'repeat-outline' : 'repeat'} size={card ? 20 : 24} color={colors.text} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.actionText, card && styles.cardActionText]}>{t('Repeat')}</Text>
          <Text style={styles.modeValue}>{repeatLabel}</Text>
        </View>
      </Pressable>
      <View style={styles.divider} />
    </>
  );
}

export function SongMenuSheet() {
  const song = useSongMenu((s) => s.song);
  const session = useSongMenu((s) => s.session);
  return song ? <SongMenuContent key={session} song={song} session={session} /> : null;
}

function SongMenuContent({ song, session }: { song: Song; session: number }) {
  const mounted = useRef(true);
  const actionClosing = useRef(false);
  const exiting = useRef(false);
  const gestureTicket = useRef<number | null>(null);
  const [requests] = useState(() => new MenuRequestScope(() => {
    const current = useSongMenu.getState();
    return current.session === session && current.song !== null ||
      current.session === session + 1 && current.song === null;
  }));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = useSongMenu.getState();
      // Only the action that closed this exact window may finish after unmount.
      if (!actionClosing.current || current.session !== session + 1 || current.song !== null) {
        requests.invalidate();
      }
    };
  }, [requests, session]);
  const ownsOpenSession = () => mounted.current && useSongMenu.getState().session === session &&
    useSongMenu.getState().song !== null;
  const closeNow = () => {
    if (!ownsOpenSession()) return false;
    if (!actionClosing.current) requests.invalidate();
    useSongMenu.getState().close();
    return true;
  };
  const closeAfterGesture = () => {
    const ticket = gestureTicket.current;
    if (ticket === null || !ownsOpenSession() || !requests.owns(ticket)) return;
    actionClosing.current = false;
    closeNow();
  };
  const insets = useSafeAreaInsets();
  const { height: screenH } = useScreenSize();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const queryClient = useQueryClient();
  // Every song menu uses the same floating panel as the artist picker.
  const isCard = true;
  const cardMaxHeight = Math.min(640, Math.max(0, screenH - insets.top - insets.bottom - 88));
  const actionStyle = [styles.action, isCard && styles.cardAction];
  const actionTextStyle = [styles.actionText, isCard && styles.cardActionText];
  const rowIconSize = isCard ? 20 : 24;
  const context = useSongMenu((s) => s.context);
  const showLyrics = useSongMenu((s) => s.showLyrics);
  const startInSleep = useSongMenu((s) => s.sleep);
  const extras = useSongMenu((s) => s.extras);
  const { dismiss: animateDismiss, dismissing, makePan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    true,
    closeAfterGesture,
    'card',
    session,
  );
  const dismiss = (after: () => void) => {
    exiting.current = true;
    animateDismiss(after);
  };
  const isOpenSession = () => ownsOpenSession() && !exiting.current && !dismissing.value;
  const startGesture = () => {
    // UI onStart accepted this gesture before queuing it. A normal fast
    // swipe may already be dismissing when the JS queue gets to this call.
    if (!ownsOpenSession() || exiting.current) return;
    actionClosing.current = false;
    gestureTicket.current = requests.begin();
  };
  // Gesture.onStart registers these callbacks; refs are read only after activation.
  // eslint-disable-next-line react-hooks/refs
  const pan = makePan().onStart(() => { if (!dismissing.value) scheduleOnRN(startGesture); });
  // Second drag, for the grabber and the header (see the JSX below).
  // eslint-disable-next-line react-hooks/refs
  const headerPan = makePan().enabled(!isCard).onStart(() => { if (!dismissing.value) scheduleOnRN(startGesture); });
  // Animated dismiss: the sheet slides down and then the Modal is unmounted.
  // All actions close through here.
  const close = () => {
    if (!isOpenSession()) return;
    const ticket = requests.begin();
    actionClosing.current = false;
    dismiss(() => {
      if (requests.owns(ticket)) closeNow();
    });
  };
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const canShare = useCanShare();
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const rateSong = usePlayerStore((s) => s.rateSong);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAtSongEnd = usePlayerStore((s) => s.setSleepAtSongEnd);
  const cancelSleepTimer = usePlayerStore((s) => s.cancelSleepTimer);
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const sleepAtSongEnd = usePlayerStore((s) => s.sleepAtSongEnd);
  const toast = useToast((s) => s.show);
  const t = useT();
  const downloaded = useDownloads((s) => !!(song && s.files[song.id]));
  // The downloaded file itself, and what it was made at: exporting copies what
  // is on the phone, and a transcode should not be handed over as if it were
  // the server's original.
  const dlUri = useDownloads((s) => (song ? s.files[song.id] : undefined));
  const dlBitRate = useDownloads((s) => (song ? s.dlBitRates[song.id] : undefined));
  const downloadSong = useDownloads((s) => s.downloadSong);
  const deleteDownloads = useDownloads((s) => s.deleteSongs);
  const openArtistPicker = useArtistPicker((s) => s.open);
  const favIds = useFavoriteIds(!!song);
  const favorited = song ? (favIds ? favIds.has(song.id) : !!song.starred) : false;

  const [mode, updateMode] = useState<'actions' | 'playlists' | 'sleep' | 'rating' | 'export'>(
    startInSleep ? 'sleep' : 'actions',
  );
  const [creating, setCreating] = useState<number | null>(null);
  // The action list is scrolled to the top: only then does a downward drag
  // belong to the sheet (see the `pan` below).
  const [atTop, setAtTop] = useState(true);
  // "Already in the playlist" prompt pending confirmation (Spotify style).
  const [dupPrompt, setDupPrompt] = useState<{ playlistId: string; name: string; ticket: number } | null>(null);
  // Removing a download asks first, like albums and playlists do.
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const beginRequest = () => {
    actionClosing.current = false;
    setCreating(null);
    setDupPrompt(null);
    setConfirmDelete(null);
    return requests.begin();
  };
  const cancelConfirmation = () => {
    if (!isOpenSession()) return;
    requests.invalidate();
    setCreating(null);
    setDupPrompt(null);
    setConfirmDelete(null);
    setAtTop(true);
  };
  const ownsConfirmation = (ticket: number) => isOpenSession() && requests.owns(ticket);
  const dismissAction = (after: () => void) => {
    if (!isOpenSession()) return;
    const ticket = beginRequest();
    dismiss(() => {
      if (requests.owns(ticket) && closeNow()) after();
    });
  };
  const setMode = (next: typeof mode) => {
    if (!isOpenSession()) return;
    cancelConfirmation();
    updateMode(next);
  };

  const { data: playlists, isLoading: loadingPlaylists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: (!!auth || offline) && canGoIntoPlaylist(song) && mode === 'playlists',
  });

  const explicit = useExplicitBadge(song?.explicitStatus);

  const go = (path: string) =>
    dismissAction(() => {
      router.push(path);
    });

  /**
   * Copies the download into a folder the user picks (#57).
   *
   * The sheet is only closed once a folder has been chosen: cancelling the
   * system picker leaves the menu where it was, which is what cancelling
   * should do. The copy then runs on its own, announced by the toast, because
   * a large file over a document provider is not instant.
   */
  async function saveToFolder() {
    if (!isOpenSession() || !dlUri) return;
    const ticket = beginRequest();
    actionClosing.current = true;
    closeNow();
    const folder = await pickFolder();
    if (!folder || !requests.owns(ticket)) return;
    toast(t('Exporting…'));
    try {
      const name = await exportToFolder(song, dlUri, folder);
      if (requests.owns(ticket)) toast(t('Saved as “{name}”', { name }));
    } catch {
      if (requests.owns(ticket)) toast(t("Couldn't save the file"));
    }
  }

  /** Hands the download to another app through the system share sheet (#57). */
  async function sendToApp() {
    if (!isOpenSession() || !dlUri) return;
    const ticket = beginRequest();
    actionClosing.current = true;
    closeNow();
    try {
      // Both of these name the button that was pressed, not the mechanism
      // behind it: "share" in this app is the link a server mints, which is in
      // this very menu and is a different thing (raised by @ztx-lyghters).
      // They also say different things: this one is the system reporting it
      // has no share sheet, before anything has been attempted, and the one
      // below is an attempt that failed.
      if (!(await shareSongFile(song, dlUri)) && requests.owns(ticket)) {
        toast(t("Sending to another app isn't available on this device"));
      }
    } catch {
      if (requests.owns(ticket)) toast(t("Couldn't send the file"));
    }
  }

  /** Actually adds (without checking duplicates) and closes with a toast. */
  async function doAdd(playlistId: string, playlistName: string, alreadyDismissed = false, ticket?: number) {
    if (!canGoIntoPlaylist(song) || !isOpenSession() || ticket !== undefined && !requests.owns(ticket)) return;
    const actionTicket = beginRequest();
    actionClosing.current = true;
    if (alreadyDismissed) closeNow();
    else dismiss(() => {
      if (requests.owns(actionTicket)) closeNow();
    });
    try {
      // A selected mutation finishes for this song, even if another menu opens.
      await addToPlaylist(playlistId, song.id);
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      // If the list has auto-download, fetch the newly added song now.
      void useAutoDownloads.getState().reconcile(playlistId, true);
      if (requests.owns(actionTicket)) toast(t('Added to “{name}”', { name: playlistName }));
    } catch {
      if (requests.owns(actionTicket)) toast(t("Couldn't add to the playlist"));
    }
  }

  async function addTo(playlistId: string, playlistName: string) {
    if ((!auth && !offline) || !canGoIntoPlaylist(song) || !isOpenSession()) return;
    const ticket = beginRequest();
    // Spotify-style duplicate warning: if already present, ask first. If the
    // check fails (network), add without warning: better than blocking.
    try {
      const { songs } = await getPlaylist(playlistId);
      if (!ownsConfirmation(ticket)) return;
      if (songs.some((s) => s.id === song.id)) {
        setDupPrompt({ playlistId, name: playlistName, ticket });
        return;
      }
    } catch {
      // ignore
    }
    if (ownsConfirmation(ticket)) await doAdd(playlistId, playlistName, false, ticket);
  }

  async function createAndAdd(name: string) {
    if (creating === null || !ownsConfirmation(creating) || (!auth && !offline) || !canGoIntoPlaylist(song) || !name.trim()) return;
    const ticket = beginRequest();
    actionClosing.current = true;
    if (isCard) closeNow();
    else dismiss(() => {
      if (requests.owns(ticket)) closeNow();
    });
    try {
      const id = await createPlaylist(name.trim());
      // Creating and adding are one accepted transaction: never leave the
      // user's new playlist empty just because they opened another menu.
      await addToPlaylist(id, song.id);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      if (requests.owns(ticket)) toast(t('Added to “{name}”', { name: name.trim() }));
    } catch {
      if (requests.owns(ticket)) toast(t("Couldn't create the playlist"));
    }
  }

  function removeFromList() {
    if ((!auth && !offline) || !context) return;
    close();
    const { playlistId, index } = context;
    const key = ['playlist', playlistId];
    // Optimistic: the song disappears from the list immediately; the real
    // deletion is delayed until the toast expires. «Undo» cancels it and
    // restores it in its position (the server never knew about it).
    const prev = queryClient.getQueryData<{ playlist: unknown; songs: Song[] }>(key);
    const prevList = queryClient.getQueryData<{ id: string; songCount?: number }[]>(['playlists']);
    if (prev) {
      const nextSongs = prev.songs.filter((_, i) => i !== index);
      queryClient.setQueryData(key, { ...prev, songs: nextSongs });
      // Optimistic count in the Library (`songsLabel`).
      queryClient.setQueryData<{ id: string; songCount?: number }[]>(['playlists'], (list) =>
        list?.map((p) => (p.id === playlistId ? { ...p, songCount: nextSongs.length } : p)),
      );
    }
    showUndoToast(t('Removed from playlist'), t('Undo'), {
      commit: () => {
        void (async () => {
          try {
              // We rewrite the list to the final state (without the removed song)
              // instead of removing by index: it's a "set", identical online and
              // offline, so there's no double deletion if the deferred commit
              // falls already in offline mode. If it was the last song (list at
              // 0), the index method is the proven one.
            if (prev) {
              const finalIds = prev.songs.filter((_, i) => i !== index).map((s) => s.id);
              if (finalIds.length > 0) await reorderPlaylist(playlistId, finalIds);
              else await removeFromPlaylist(playlistId, index);
            }
          } catch {
            useToast.getState().show(t("Couldn't complete the action"));
          }
          queryClient.invalidateQueries({ queryKey: key });
          queryClient.invalidateQueries({ queryKey: ['playlists'] });
        })();
      },
      undo: () => {
        if (prev) queryClient.setQueryData(key, prev);
        else queryClient.invalidateQueries({ queryKey: key });
        if (prevList) queryClient.setQueryData(['playlists'], prevList);
      },
    });
  }

  return (
    <Modal transparent animationType="none" visible onRequestClose={() => {
      if (creating !== null || confirmDelete !== null || dupPrompt) cancelConfirmation();
      else close();
    }}>
      {/* Gestures inside an RN Modal need a root view of their own: the
          Modal renders in a native hierarchy outside the app's. */}
      {!(creating || confirmDelete || dupPrompt) && <MenuGlassCardFrame onClose={close}
        backdropStyle={backdropStyle} cardStyle={[sheetStyle, { padding: 0 }]} onLayout={onSheetLayout}>
          <MenuCardContext.Provider value={isCard}>
          <MenuContent card={isCard} maxHeight={cardMaxHeight} contentKey={`${song.id}:${mode}`}>
          {/* The header has its own drag, always enabled: it's the way out
              when the list below is scrolled and keeps the gesture for itself
              (and the only one in the playlist view, where the list owns it
              entirely). Two detectors instead of one around everything so both
              can never fire at once. */}
          <GestureDetector gesture={headerPan}>
            <View>
              {/* Spotify-style grabber: the visual cue that the sheet can be
                  dragged down to dismiss. */}
              {!isCard && <View style={styles.grabber} />}
              <View style={[styles.headerRow, isCard && styles.cardHeaderRow]}>
                <Cover uri={songCoverUrl(song, COVER.thumb)} size={isCard ? 36 : 48} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.title, isCard && styles.cardTitle]} numberOfLines={1}>
                    {song.title}
                  </Text>
                  {explicit || song.artist ? (
                    <View style={styles.subRow}>
                      <ExplicitBadge status={song.explicitStatus} />
                      {song.artist ? (
                        <Text style={[styles.artist, isCard && styles.cardArtist]} numberOfLines={1}>
                          {song.artist}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('Close')}
                  hitSlop={4} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
              <View style={styles.divider} />
            </View>
          </GestureDetector>

          <GestureDetector gesture={pan.enabled(!isCard && mode !== 'playlists' && atTop)}>
            <View>
              {mode === 'playlists' ? (
                <View style={!isCard && { maxHeight: playlistsMaxH(screenH) }}>
                  <Pressable
                    style={actionStyle}
                    onPress={() => setMode('actions')}
                  >
                    <Icon name="chevron-back" size={rowIconSize} color={colors.text} />
                    <Text style={actionTextStyle}>{t('Add to a playlist')}</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [...actionStyle, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      if (isOpenSession()) setCreating(beginRequest());
                    }}
                  >
                    <View style={[styles.newPlaylistIcon, isCard && styles.cardNewPlaylistIcon]}>
                      <Icon name="add" size={rowIconSize} color={colors.text} />
                    </View>
                    <Text style={actionTextStyle}>{t('New playlist')}</Text>
                  </Pressable>
                  {loadingPlaylists ? (
                    <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
                  ) : (
                    <MenuList card={isCard}>
                      {(playlists ?? []).map((p) => (
                        <Pressable
                          key={p.id}
                          accessibilityRole="button"
                          accessibilityLabel={p.name}
                          style={({ pressed }) => [...actionStyle, pressed && { opacity: 0.6 }]}
                          onPress={() => addTo(p.id, p.name)}
                        >
                          <Cover uri={coverArtUrl( p.coverArt ?? p.id, COVER.thumb)} size={isCard ? 32 : 40} />
                          <Text style={actionTextStyle} numberOfLines={1}>
                            {p.name}
                          </Text>
                        </Pressable>
                      ))}
                    </MenuList>
                  )}
                </View>
              ) : mode === 'sleep' ? (
                <View>
                  <Pressable style={actionStyle} onPress={() => setMode('actions')}>
                    <Icon name="chevron-back" size={rowIconSize} color={colors.text} />
                    <Text style={actionTextStyle}>{t('Sleep timer')}</Text>
                  </Pressable>
                  {[15, 30, 45, 60].map((m) => (
                    <Pressable
                      key={m}
                      style={({ pressed }) => [...actionStyle, pressed && { opacity: 0.6 }]}
                      onPress={() => {
                        setSleepTimer(m);
                        toast(t('Will pause in {n} min', { n: m }));
                        close();
                      }}
                    >
                      <Icon name="time-outline" size={rowIconSize} color={colors.text} />
                      <Text style={actionTextStyle}>{t('{n} minutes', { n: m })}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    style={({ pressed }) => [...actionStyle, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      setSleepAtSongEnd();
                      toast(t('Will pause when the song ends'));
                      close();
                    }}
                  >
                    <Icon name="musical-note-outline" size={rowIconSize} color={colors.text} />
                    <Text style={actionTextStyle}>{t('When the song ends')}</Text>
                  </Pressable>
                  {sleepEndsAt || sleepAtSongEnd ? (
                    <Pressable
                      style={({ pressed }) => [...actionStyle, pressed && { opacity: 0.6 }]}
                      onPress={() => {
                        cancelSleepTimer();
                        toast(t('Sleep timer off'));
                        close();
                      }}
                    >
                      <Icon name="close-circle-outline" size={rowIconSize} color={colors.danger} />
                      <Text style={[...actionTextStyle, { color: colors.danger }]}>
                        {t('Turn off')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : mode === 'export' ? (
                <View>
                  <Pressable style={actionStyle} onPress={() => setMode('actions')}>
                    <Icon name="chevron-back" size={rowIconSize} color={colors.text} />
                    <Text style={actionTextStyle}>{t('Export')}</Text>
                  </Pressable>
                  {/* Said before the file leaves, not after: a download made at
                      a lower bitrate is a worse copy than the server's, and the
                      only moment that matters is while deciding to hand it to
                      someone. */}
                  {dlBitRate ? (
                    <Text style={[styles.note, isCard && styles.cardNote]}>
                      {t('This download is a {n} kbps copy, not the original file.', {
                        n: dlBitRate,
                      })}
                    </Text>
                  ) : null}
                  {/* Picking a folder is the Storage Access Framework, which is
                      Android's. Elsewhere the share sheet is the only way out. */}
                  {Platform.OS === 'android' ? (
                    <Action
                      icon="folder-outline"
                      label={t('Save to a folder')}
                      onPress={() => void saveToFolder()}
                    />
                  ) : null}
                  <Action
                    icon="share-outline"
                    label={t('Send to another app')}
                    onPress={() => void sendToApp()}
                  />
                </View>
              ) : mode === 'rating' ? (
                <View>
                  <Pressable style={actionStyle} onPress={() => setMode('actions')}>
                    <Icon name="chevron-back" size={rowIconSize} color={colors.text} />
                    <Text style={actionTextStyle}>{t('Rate')}</Text>
                  </Pressable>
                  <View style={styles.ratingRow}>
                    <StarRating
                      id={song.id}
                      rating={song.userRating}
                      size={isCard ? 28 : 34}
                      onRated={(r) => rateSong(song.id, r)}
                    />
                  </View>
                </View>
              ) : (
                // Scrolls: with every action enabled the list is taller than
                // the room a sheet should take. `onScroll` hands the drag back
                // to the sheet only at the top, so pulling down mid-list scrolls
                // instead of dismissing.
                <MenuList card={isCard}
                  style={{ maxHeight: actionsMaxH(screenH) }}
                  scrollEventThrottle={16}
                  onScroll={(e) => { if (!isCard) setAtTop(e.nativeEvent.contentOffset.y <= 0); }}
                >
                  {extras.playbackModes ? <PlaybackModeActions canChange={isOpenSession} /> : null}
                  {canGoIntoPlaylist(song) ? <Action
                    icon="add-circle-outline"
                    label={t('Add to a playlist')}
                    onPress={() => setMode('playlists')}
                  /> : null}
                  {canGoIntoPlaylist(song) && context ? (
                    <Action
                      icon="remove-circle-outline"
                      label={t('Remove from playlist')}
                      onPress={removeFromList}
                    />
                  ) : null}
                  <Action
                    icon="play-forward-outline"
                    label={t('Play next')}
                    onPress={() => {
                      playNext(song);
                      toast(t('Playing next'));
                      close();
                    }}
                  />
                  <Action
                    icon="list-outline"
                    label={t('Add to queue')}
                    onPress={() => {
                      addToQueue(song);
                      toast(t('Added to queue'));
                      close();
                    }}
                  />
                  <Action
                    icon={favorited ? 'heart' : 'heart-outline'}
                    label={favorited ? t('Remove from favorites') : t('Add to favorites')}
                    onPress={() => {
                      (favorited ? unstar(song.id) : star(song.id))
                        .then(() => applyStarChange('song', song.id, !favorited, song))
                        .catch(resyncFavorites);
                      toast(favorited ? t('Removed from favorites') : t('Added to favorites'));
                      close();
                    }}
                  />
                  {song.albumId || song.album ? (
                    <Action
                      icon="disc-outline"
                      label={t('Go to album')}
                      onPress={() => {
                        if (song.albumId) { go(`/album/${song.albumId}`); return; }
                        if (song.album) {
                          const key = normKey(song.album) + '|' + normKey(song.artist || '');
                          go(`/album/${key}`);
                        }
                      }}
                    />
                  ) : null}
                  {song.artistId || song.artist ? (
                    <Action
                      icon="person-outline"
                      label={t('Go to artist')}
                      onPress={() => {
                        const targets = artistTargets(song);
                        if (targets.length > 1) {
                          // We close the sheet and, after its exit animation, open the
                          // picker (avoids two visible Modals at once).
                          dismissAction(() => {
                            openArtistPicker(targets);
                          });
                          return;
                        }
                        const id = targets[0]?.id ?? (song.artist ? normKey(song.artist) : '');
                        if (id) go(`/artist/${id}`);
                      }}
                    />
                  ) : null}
                  {downloaded ? (
                    <Action
                      icon="arrow-down-circle-outline"
                      label={t('Remove download')}
                      // Asks first, like albums and playlists do: this one used
                      // to delete on the spot (#48).
                      onPress={() => {
                        if (isOpenSession()) setConfirmDelete(beginRequest());
                      }}
                    />
                  ) : !offline && !song.url ? (
                    <Action
                      icon="download-outline"
                      label={t('Download')}
                      onPress={() => {
                        void downloadSong(song);
                        toast(t('Downloading…'));
                        close();
                      }}
                    />
                  ) : null}
                  {/* Downloaded songs only. Exporting one that is not on the
                      phone would be a download wearing another word: network,
                      time, data and a size worth warning about. That one is two
                      steps, Download and then Export, and both say what they
                      are (#57). */}
                  {downloaded ? (
                    <Action
                      icon="save-outline"
                      label={t('Export')}
                      onPress={() => setMode('export')}
                    />
                  ) : null}
                  {showLyrics ? (
                    <Action
                      icon="mic-outline"
                      label={t('Lyrics')}
                      onPress={() => {
                        if (extras.lyrics) dismissAction(extras.lyrics);
                        else go('/lyrics');
                      }}
                    />
                  ) : null}
                  {/* The player's buttons that are hidden from its bottom row,
                      so hiding them does not hide what they open (#248). */}
                  {extras.queue ? (
                    <Action icon="layers-outline" label={t('View queue')} onPress={() => go('/queue')} />
                  ) : null}
                  {extras.devices ? (
                    <Action
                      icon="laptop-outline"
                      label={t('Devices')}
                      onPress={() => {
                        const open = extras.devices!;
                        dismissAction(() => {
                          open();
                        });
                      }}
                    />
                  ) : null}
                  {extras.speed ? (
                    <Action
                      icon="speedometer-outline"
                      label={t('Playback speed')}
                      onPress={() => {
                        const open = extras.speed!;
                        dismissAction(() => {
                          open();
                        });
                      }}
                    />
                  ) : null}
                  {/* Online only (similar songs are found by the server) and not for
                      stations (`url`), which have no "similar". */}
                  {!offline && !song.url ? (
                    <Action
                      icon="sparkles-outline"
                      label={t('Start mix')}
                      onPress={() => {
                        if (!isOpenSession()) return;
                        const ticket = beginRequest();
                        actionClosing.current = true;
                        dismiss(() => {
                          if (requests.owns(ticket)) closeNow();
                        });
                        // The queue changes underneath without the song restarting, so
                        // without this nothing on screen says the mix actually began.
                        // And it's only said once tracks have arrived: announcing a
                        // mix that came up empty is how the failure stayed invisible.
                        void startRadio(song, t('Mix of “{name}”', { name: song.title })).then(
                          (started) => {
                            if (!requests.owns(ticket)) return;
                            toast(
                              started
                                ? t('Mix started')
                                : t("Couldn't find anything to mix with this song"),
                            );
                          },
                        );
                      }}
                    />
                  ) : null}
                  {/* Rate (Subsonic setRating): non-Jellyfin server account and not
                      radio. Offline is recorded and uploaded on reconnect (the local
                      profile has no account, so it doesn't appear there). */}
                  {!!auth && serverType !== 'jellyfin' && !song.url ? (
                    <Action icon="star-outline" label={t('Rate')} onPress={() => setMode('rating')} />
                  ) : null}
                  {/* Only with a server that mints share links (`useCanShare`),
                      and never for a station: its `url` is not the server's to
                      share. */}
                  {canShare && !song.url ? (
                    <Action
                      icon="share-social-outline"
                      label={t('Share')}
                      onPress={() => {
                        dismissAction(() => {
                          useSharePicker.getState().open({ id: song.id, name: song.title });
                        });
                      }}
                    />
                  ) : null}
                  <Action
                    icon="moon-outline"
                    label={
                      sleepEndsAt
                        ? t('Sleep timer ({n} min left)', { n: minutesLeft(sleepEndsAt) })
                        : sleepAtSongEnd
                          ? t('Sleep timer (end of song)')
                          : t('Sleep timer')
                    }
                    onPress={() => setMode('sleep')}
                  />
                  <Action
                    icon="information-circle-outline"
                    label={t('Song information')}
                    onPress={() => {
                      dismissAction(() => {
                        useSongInfo.getState().open(song);
                      });
                    }}
                  />
                </MenuList>
              )}
            </View>
          </GestureDetector>
          </MenuContent>
          </MenuCardContext.Provider>
      </MenuGlassCardFrame>}

      <Dialog
        inlineMenu
        visible={confirmDelete !== null}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: song.title })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => {
          if (confirmDelete !== null && ownsConfirmation(confirmDelete)) cancelConfirmation();
        }}
        onConfirm={() => {
          if (confirmDelete === null || !ownsConfirmation(confirmDelete)) return;
          cancelConfirmation();
          void deleteDownloads([song.id]);
          // «Undo» still there: confirming by mistake is a tap away from
          // getting it back (offline there'd be nowhere to download from).
          toast(
            t('Download removed'),
            offline ? undefined : { label: t('Undo'), run: () => void downloadSong(song) },
          );
          if (isCard) closeNow();
          else close();
        }}
      />

      <Dialog
        inlineMenu
        visible={creating !== null}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => {
          if (creating !== null && ownsConfirmation(creating)) cancelConfirmation();
        }}
        onConfirm={createAndAdd}
      />

      <Dialog
        inlineMenu
        visible={!!dupPrompt}
        title={t('Already added')}
        message={dupPrompt ? t('This song is already in “{name}”.', { name: dupPrompt.name }) : undefined}
        confirmLabel={t('Add anyway')}
        onCancel={() => {
          if (dupPrompt && ownsConfirmation(dupPrompt.ticket)) cancelConfirmation();
        }}
        onConfirm={() => {
          const d = dupPrompt;
          if (d && ownsConfirmation(d.ticket)) void doAdd(d.playlistId, d.name, isCard, d.ticket);
        }}
      />
    </Modal>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  card: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderRadius: 28,
    overflow: 'hidden',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.22)',
  },
  cardContent: { padding: 16 },
  cardHeaderRow: { gap: 10, paddingBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  cardArtist: { fontSize: 13 },
  cardAction: { minHeight: 48, paddingVertical: 10, gap: 12 },
  cardActionText: { fontSize: 17, flex: 1, flexShrink: 1 },
  modeValue: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  cardNote: { paddingLeft: 0 },
  cardNewPlaylistIcon: { width: 32, height: 32 },
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
  // Spotify's little handle. Its only job is to advertise the drag gesture,
  // so it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  artist: { color: colors.textSecondary, fontSize: fontSize.sm, flexShrink: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  ratingRow: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
  // Aligned with the action labels above it, so it reads as part of the list
  // rather than as a banner dropped on top of it.
  note: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    paddingBottom: spacing.sm,
    paddingLeft: 24 + spacing.lg,
  },
  newPlaylistIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
