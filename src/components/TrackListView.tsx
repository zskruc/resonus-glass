/**
 * Spotify-style header (dominant color gradient + cover that fades on scroll
 * and a collapsing fixed bar) and the song list. Shared by album and playlist
 * screens.
 */
import { GlassBackdrop, GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useComposedEventHandler,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
// The recycled list keeps a gesture-handler scroll host so horizontal row
// actions and the pull-to-reveal observer coexist with native scrolling.
import {
  ScrollView as GHScrollView,
  Gesture,
  GestureDetector,
  type GestureType,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Song, type StarType } from '@/api/subsonic';
import { useCoverTint } from '@/hooks/useDominantColor';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useSelectionMenu } from '@/hooks/useSelectionMenu';
import { useT } from '@/i18n';
import { artistTargets } from '@/lib/artistNav';
import { haptic } from '@/lib/haptics';
import { voltaDetailBackground } from '@/lib/voltaPalette';
import { minidiscAlbumCoverSize, type MinidiscAlbumPalette } from '@/lib/minidiscAlbumPalette';
import { MinidiscAlbumHeader } from '@/components/volta/MinidiscAlbumHeader';
import { PlaylistDetailHeader, playlistCoverSize } from '@/components/PlaylistDetailHeader';
import { useArtistPicker } from '@/store/artistPicker';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, tracking } from '@/theme';
import { motion } from '@/theme/motion';
import { BackChevron } from './BackChevron';
import { TopBarBackground } from './BarBlur';
import { Cover } from './Cover';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';
import { FavoriteButton } from './FavoriteButton';
import { SelectionBar, type SelectionAction } from './SelectionBar';
import { TrackRow } from './TrackRow';

/**
 * The cover across the top of an album or a playlist.
 *
 * A share of the width, capped, and measured while rendering rather than once
 * when the file was imported: turning the phone used to leave it at the size
 * it had when the app started. The height matters as much as the width on a
 * screen lying on its side, where 250 points of picture is most of the page
 * and the tracklist is what people came for (#131).
 */
function coverSize(width: number, height: number): number {
  return Math.round(Math.min(width * 0.58, height * 0.4, 250));
}
const TOPBAR_H = 48;
/** Height of the hidden search bar ("Find in playlist" Spotify style),
 * including the separation gap from the cover. */
const SEARCH_H = 72;
/** Lines of the description shown before "Show more". */
const DESCRIPTION_LINES = 2;

/** A playlist occurrence has its own identity even when Song is shared. */
interface TrackListOccurrence {
  song: Song;
  origIndex: number;
  rowKey: string;
  serverIndex: number;
}

/**
 * The list, with its scroll wired straight to what the scroll animates.
 *
 * The cover fading, the bar coming in and the gradient following the scroll all
 * hang off the scroll position, and every frame of them used to go through JS:
 * the list moved natively while they waited behind whatever else the thread was
 * doing. With music playing there is always something else, and what it looks
 * like is a header stuttering against a list that does not (#154). Native, they
 * cannot be late whatever JS is up to.
 *
 * The search bar is the one thing that stays on this side: it animates a
 * height, which the native side does not do, so it is kept in a wrapper of its
 * own rather than added to the scroll (mixing the two in one expression is what
 * would break both).
 */
const AnimatedList = Reanimated.createAnimatedComponent(FlashList<TrackListOccurrence>);
const NO_SCROLL_ANCHOR = { disabled: true };
const playlistHeaderUtility = { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' } as const;

/** Normalizes for searching: lowercase and without accents. */
function normQ(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

interface Props {
  /** Playlist-only compositions; album layouts keep their existing geometry. */
  playlistPresentation?: boolean;
  /** Volta album actions keep favorite in the existing overflow menu. */
  albumActionLayout?: 'volta';
  /** Album-only Minidisc presentation; playlist and Spotify headers retain their layout. */
  albumPresentation?: { palette: MinidiscAlbumPalette; meta?: string };
  title: string;
  subtitle?: string;
  /** If provided, the subtitle links to the artist when tapped. */
  artistId?: string;
  /** Album artists; with multiple, the subtitle opens the picker. */
  artists?: { id: string; name: string }[];
  /** Circular artist photo next to the subtitle (Spotify style). */
  artistImageUri?: string;
  /**
   * What the list says about itself (a playlist's or an album's description),
   * above the metadata. Two lines, with "Show more" under them when there is
   * more: the words say the tap is there, which is what a bare cut text never
   * did. Whoever wants the header quiet turns it off in Settings › Appearance.
   */
  description?: string;
  /** Metadata line (e.g. "Album · 2021 · 12 songs · 48 min"). */
  meta?: string;
  /**
   * The record carries a parental advisory: the E goes at the head of the
   * metadata line. A word in that line would have said the same thing, but the
   * badge is what the rows below it use and reading one mark in two shapes on
   * the same screen is worse than reading it twice.
   */
  explicit?: boolean;
  /** Genres of the album, as a scrollable row of chips that browse each one.
   *  Empty or absent shows nothing at all, not an empty row. */
  genres?: string[];
  coverUri?: string;
  /** Custom cover art (e.g. Favorites artwork); replaces coverUri. */
  renderCover?: (size: number) => ReactNode;
  /** If provided, the cover is tappable (e.g. open the fullscreen viewer). */
  onCoverPress?: () => void;
  /** Hides the header cover and reclaims that space (e.g. Favorites). */
  hideCover?: boolean;
  /** Gradient/bar color if there's no cover with a dominant color. */
  accentColor?: string;
  songs: Song[];
  currentId?: string;
  /** Numbers the tracks (useful on albums). */
  numbered?: boolean;
  /**
   * Disc header to render ABOVE the row at that index (multi-disc albums):
   * index → label map ("Disc 2", disc title...). Only used without an active
   * search filter (filtered results have no discs).
   */
  discHeaders?: Record<number, string>;
  /** If provided, shows a heart to mark the album as a favorite. */
  favorite?: { id: string; type: StarType; starred: boolean };
  /** Offline download button (album/playlist header). */
  download?: {
    status: 'none' | 'active' | 'done';
    /** Progress 0..1 while `status` is 'active'. */
    progress: number;
    onPress: () => void;
  };
  /** If provided, shows a ⋯ button. */
  onMenu?: () => void;
  /** If provided, each song's menu allows removing it from this playlist. */
  playlistId?: string;
  /** Real server index for each song, in case the list is reordered. */
  playlistIndices?: number[];
  /** If provided, shows a sort button to the left of ⋯. */
  onSort?: () => void;
  /**
   * Action row below the others (Spotify style), e.g. "+ Add…" in Favorites.
   * The icon is "+" unless another is specified (the mix screen uses it to
   * reshuffle).
   */
  addAction?: { label: string; icon?: keyof typeof Icon.glyphMap; onPress: () => void };
  /** Extra content at the bottom of the list (e.g. "More from this artist"). */
  footer?: ReactNode;
  /** What to show below the header when there are no songs (e.g. empty playlist). */
  emptyState?: ReactNode;
  /** Shows the mini album cover on each row (playlists/favorites). */
  showArtwork?: boolean;
  /**
   * Hidden "search in list" bar above the header: revealed by pulling down
   * from the very top (Spotify-style gesture).
   */
  searchable?: boolean;
  /** Search bar hint text (defaults to "Find in playlist"). */
  searchPlaceholder?: string;
  /**
   * Enables multi-select (enter via long-press on a row). Each action receives
   * the marked songs; `indices` are their real positions (via `playlistIndices`
   * if the list is reordered).
   */
  selection?: {
    /** Remove from this list (playlist: by index; favorites: unstar). */
    onRemove?: (songs: Song[], indices: number[]) => void;
    /** Add to another playlist. */
    onAddTo?: (songs: Song[]) => void;
    /** Bulk download. */
    onDownload?: (songs: Song[]) => void;
    /** Favorites screen: there, "Remove" already is unfavouriting. */
    favorites?: boolean;
  };
  /** `opts` goes straight to `playQueue`: the shuffle button asks for the list
   *  dealt, which the screen owning the songs is the one who can request. */
  onPlay: (startIndex: number, opts?: { shuffled?: boolean }) => void | Promise<void | boolean>;
}

export function TrackListView({
  playlistPresentation,
  albumActionLayout,
  albumPresentation,
  title,
  subtitle,
  artistId,
  artists,
  artistImageUri,
  description,
  meta,
  explicit,
  genres,
  coverUri,
  renderCover,
  onCoverPress,
  hideCover,
  accentColor,
  songs,
  currentId,
  numbered,
  discHeaders,
  favorite,
  download,
  onMenu,
  playlistId,
  playlistIndices,
  onSort,
  addAction,
  footer,
  emptyState,
  showArtwork,
  searchable,
  searchPlaceholder,
  selection,
  onPlay,
}: Props) {
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useScreenSize();
  const bottomPad = useScreenBottomPadding();
  const appleMusic = useSettings((s) => s.uiStyle === 'appleMusic');
  const minidisc = appleMusic ? albumPresentation : undefined;
  const voltaAlbum = appleMusic && !minidisc && albumActionLayout === 'volta';
  const tint = useCoverTint(minidisc ? undefined : coverUri, true);
  const dominant = tint.color;
  const appleBackground = voltaDetailBackground(dominant, colors.background, colors.text, colors.textSecondary);
  // A cover read for the first time fades its tint in over the page, instead
  // of the header being painted the plain grey and jumping to the colour a
  // moment later. One already read is there from the first frame.
  const tintIn = useSharedValue(tint.known ? 1 : 0);
  useEffect(() => {
    if (!tint.known) return;
    tintIn.set(withTiming(1, { duration: motion.duration.fade, reduceMotion: motion.reduceMotion.decorative }));
  }, [tint.known, tintIn]);
  const headerColor = minidisc?.palette.backgroundTop ?? (appleMusic ? appleBackground : accentColor ?? dominant);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const queueDealt = usePlayerStore((s) => s.queueDealt);
  // The shuffle button gets tinted only if this list is the one playing;
  // otherwise, the (global) shuffle mode would also tint the buttons of
  // unrelated albums/playlists, which was confusing.
  //
  // The mode is not the only way to end up listening shuffled: this button
  // hands the list over dealt without touching the mode (see `shufflePlay`),
  // and reading the mode alone meant pressing it lit nothing at all. What it
  // says is "what you are hearing is this list, shuffled", however it got that
  // way, so tapping a song in the list afterwards puts it out again.
  const shuffleActive = useMemo(
    () => (shuffle || queueDealt) && !!currentId && songs.some((s) => s.id === currentId),
    [shuffle, queueDealt, currentId, songs],
  );
  const openArtistPicker = useArtistPicker((s) => s.open);
  // The caller worked out whether the record carries an advisory; whether it is
  // drawn is the badge's own switch, asked here so the metadata line is not
  // built around a badge that never comes.
  const showExplicit = useExplicitBadge(explicit ? 'explicit' : undefined);
  const subtitleTargets = artistTargets({ artistId, artists });
  const onSubtitlePress =
    subtitleTargets.length > 1
      ? () => openArtistPicker(subtitleTargets)
      : subtitleTargets.length === 1
        ? () => router.push(`/artist/${subtitleTargets[0].id}`)
        : undefined;

  const scrollY = useSharedValue(0);
  const headerScroll = useAnimatedScrollHandler({
    onScroll: (event) => { scrollY.set(event.contentOffset.y); },
  });
  const dockScroll = useLiquidDockScrollHandler();
  const onScroll = useComposedEventHandler([headerScroll, dockScroll]);

  // ── In-list search ──────────────────────────────────────────────────────
  // The bar is rendered collapsed (height 0) above the header; a pull-down
  // gesture when the list is at the very top reveals it, and scrolling back
  // collapses it. Like Spotify's "Find in playlist".
  const listRef = useRef<FlashListRef<TrackListOccurrence>>(null);
  // Reanimated forwards this ref as a prop. An object ref lets FlashList's
  // internal RN Animated scroller traverse ref.current.props.data on render.
  const bindListRef = useCallback((instance: FlashListRef<TrackListOccurrence> | null) => {
    listRef.current = instance;
  }, []);
  const listScope = useId();
  const ownerScope = JSON.stringify([listScope, playlistId, title]);
  const onPlayRef = useRef(onPlay);
  useLayoutEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  const playAtIndex = useCallback((index: number) => { void onPlayRef.current(index); }, []);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [searchMaterialMounted, setSearchMaterialMounted] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionHasMore, setDescriptionHasMore] = useState(false);
  const [searchH] = useState(() => new Animated.Value(0));
  const searchBar = !!searchable && songs.length > 0;

  // `setRevealed` is async: the gesture fires `onChange` many times per drag,
  // and several would pass the `!revealed` guard before the re-render, each
  // triggering haptic. The ref updates instantly and stops the rest.
  const revealedRef = useRef(false);
  const searchMotionOwner = useRef({
    active: true, generation: 0, animation: null as Animated.CompositeAnimation | null,
  });
  useLayoutEffect(() => {
    const owner = searchMotionOwner.current;
    owner.active = true;
    return () => {
      owner.active = false;
      owner.generation++;
      owner.animation?.stop();
      owner.animation = null;
    };
  }, []);

  function animateSearchBar(toValue: number) {
    const owner = searchMotionOwner.current;
    if (!owner.active) return;
    const generation = ++owner.generation;
    owner.animation?.stop();
    // A collapsed search field must not leave an enabled native material
    // inside the list's capture source. Retain it through BOTH directions of
    // the height animation, then detach only this owner's finished close.
    setSearchMaterialMounted(true);
    const animation = Animated.timing(searchH, { toValue, duration: motion.duration.fade, useNativeDriver: false });
    owner.animation = animation;
    animation.start(({ finished }) => {
      if (!owner.active || generation !== owner.generation) return;
      owner.animation = null;
      if (finished && toValue === 0) setSearchMaterialMounted(false);
    });
  }

  function revealSearchBar() {
    if (!searchMotionOwner.current.active || revealedRef.current) return;
    revealedRef.current = true;
    haptic('light');
    setRevealed(true);
    animateSearchBar(SEARCH_H);
  }

  function collapseSearchBar() {
    if (!searchMotionOwner.current.active) return;
    revealedRef.current = false;
    setRevealed(false);
    animateSearchBar(0);
  }

  // Only the search state transition reaches JS; header and dock scrolling
  // share one UI-thread event instead of forwarding every scroll sample.
  useAnimatedReaction(
    () => revealed && !searching && scrollY.get() > 30,
    (shouldCollapse, previous) => {
      if (shouldCollapse && !previous) scheduleOnRN(collapseSearchBar);
    },
  );

  // Simultaneous pan with the list scroll: doesn't steal the gesture, just
  // observes. Android doesn't fire overscroll events (the list clamps offset
  // at 0), so the "pull down at the top" must be detected separately. The
  // simultaneity is declared on the list (simultaneousHandlers prop with the
  // gesture ref): without it, native scroll cancels this Pan before it starts.
  const revealPanRef = useRef<GestureType | undefined>(undefined);
  // FlashList creates its native host when this function's identity changes.
  // Keep it stable while the search gesture itself changes state.
  const renderScrollComponent = useCallback((props: ComponentProps<typeof GHScrollView>) => (
    <GHScrollView {...props} simultaneousHandlers={revealPanRef} />
  ), []);
  const revealSent = useSharedValue(false);
  const revealPan = Gesture.Pan()
    // eslint-disable-next-line react-hooks/refs -- RNGH registers this ref; it does not read the current gesture during React rendering.
    .withRef(revealPanRef)
    .enabled(searchBar && !searching && !revealed)
    // Only downward drags: upward ones (normal scroll) cancel it.
    .activeOffsetY(10)
    .failOffsetY(-10)
    .onBegin(() => { revealSent.set(false); })
    // eslint-disable-next-line react-hooks/refs -- RNGH invokes the observer after a native gesture begins, outside rendering.
    .onChange((e) => {
      // Ordinary scrolling stays on the UI thread. Only one actual reveal
      // crosses to JS, without synchronously reading a shared value there.
      if (!revealSent.get() && scrollY.get() <= 1 && e.translationY > 60) {
        revealSent.set(true);
        scheduleOnRN(revealSearchBar);
      }
    });

  // ── Multi-select ────────────────────────────────────────────────────────
  /**
   * One key per row: the song's id, and which time it appears if the same song
   * is in the list more than once. A playlist may hold the same track twice,
   * and while these were the plain id every one of those rows was the same row
   * as far as anything here could tell: ticking one ticked them all, and
   * removing one removed them all, which left none (#132). The queue screen
   * already numbers its rows this way, and for the same reason.
   *
   * A server playlist index follows the particular occurrence through sorting;
   * without one, count each occurrence of the song as the fallback identity.
   */
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return songs.map((s, index) => {
      // A server position distinguishes duplicate playlist entries even when
      // sorting changes the order of otherwise identical Song objects.
      if (playlistIndices) return `${s.id}#server:${playlistIndices[index]}`;
      const n = seen.get(s.id) ?? 0;
      seen.set(s.id, n + 1);
      return `${s.id}#${n}`;
    });
  }, [playlistIndices, songs]);
  // FlashList 2.0.2 memoizes cell children by item, omitting index. Distinct
  // descriptors make changing duplicate occurrences observable to that memo,
  // while keeping the original Song object for playback and song actions.
  const occurrences = useMemo<TrackListOccurrence[]>(() => songs.map((song, origIndex) => ({
    song,
    origIndex,
    rowKey: rowKeys[origIndex],
    serverIndex: playlistIndices ? playlistIndices[origIndex] : origIndex,
  })), [playlistIndices, rowKeys, songs]);

  // null = normal mode; a Set (even empty) = selecting.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const selecting = selectedIds !== null;
  // Row that just entered selection via long-press. On release, the `onPress` of
  // that same gesture arrives with `selecting` already active and would undo the
  // selection; we discard it once. Reset in `onPressIn` (start of each press),
  // so no residue remains even if `onPress` doesn't fire after the long-press.
  const justLongPressed = useRef<string | null>(null);
  const allSelected = selecting && selectedIds.size === songs.length && songs.length > 0;

  function toggleSelect(key: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Runs a selection-mode action with the marked items and exits the mode. */
  function runSelectionAction(fn: (sel: Song[], indices: number[]) => void) {
    const sel: Song[] = [];
    const indices: number[] = [];
    songs.forEach((s, i) => {
      if (selectedIds?.has(rowKeys[i])) {
        sel.push(s);
        indices.push(playlistIndices ? playlistIndices[i] : i);
      }
    });
    setSelectedIds(null);
    if (sel.length > 0) fn(sel, indices);
  }

  const selectionMenu = useSelectionMenu(runSelectionAction, {
    favorites: selection?.favorites,
  });
  // What this list lets you do with a selection, each one built once: the bar
  // takes two of them and ⋯ holds whatever is left.
  const addToAction: SelectionAction[] = selection?.onAddTo
    ? [
        {
          icon: 'add-circle-outline',
          label: t('Add to a playlist'),
          onPress: () => runSelectionAction((sel) => selection.onAddTo!(sel)),
        },
      ]
    : [];
  const removeAction: SelectionAction[] = selection?.onRemove
    ? [
        {
          icon: 'remove-circle-outline',
          label: t('Remove'),
          onPress: () => runSelectionAction((sel, idx) => selection.onRemove!(sel, idx)),
        },
      ]
    : [];
  const downloadAction: SelectionAction[] = selection?.onDownload
    ? [
        {
          icon: 'download-outline',
          label: t('Download'),
          onPress: () => runSelectionAction((sel) => selection.onDownload!(sel)),
        },
      ]
    : [];

  // Without cover, the header is shorter: the gradient and bar collapse adjust
  // to a smaller distance so the transition fits.
  const art = playlistPresentation ? playlistCoverSize(screenW, screenH, appleMusic) : minidisc ? minidiscAlbumCoverSize(screenW, screenH) : appleMusic
    ? Math.round(Math.min(screenW * 0.76, screenH * 0.43, 360))
    : coverSize(screenW, screenH);
  const cover = hideCover ? 0 : art;
  const collapse = hideCover ? 120 : art;
  // Down past the title and the buttons, so the header is the cover's colour
  // and not only the space around the cover.
  const gradientH = insets.top + TOPBAR_H + cover + 280;
  const band = searchable ? SEARCH_H * 4 : 0;
  const coverStyle = useAnimatedStyle(() => ({
    opacity: appleMusic ? 1 : interpolate(scrollY.get(), [0, collapse * 0.7], [1, 0], Extrapolation.CLAMP),
  }));
  const barContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), playlistPresentation ? [art + 16, art + 52] : [collapse * 0.5, collapse * 0.85], [0, 1], Extrapolation.CLAMP),
  }));
  const barBgOpacity = useDerivedValue(() =>
    interpolate(scrollY.get(), [0, collapse * 0.85], [0, 1], Extrapolation.CLAMP));
  const gradientStyle = useAnimatedStyle(() => ({
    opacity: tintIn.get(), transform: [{ translateY: -Math.max(scrollY.get(), 0) }],
  }));

  // Live filtering; preserves each song's original index so play/enqueue/remove
  // still point to the correct position.
  const filtered = useMemo(() => {
    const q = normQ(query.trim());
    if (!searchable || !q) return null;
    return occurrences.filter(({ song }) =>
      normQ(song.title).includes(q) || (song.artist && normQ(song.artist).includes(q)),
    );
  }, [searchable, query, occurrences]);
  const shownRows = filtered ?? occurrences;

  function cancelSearch() {
    Keyboard.dismiss();
    setQuery('');
    setSearching(false);
    collapseSearchBar();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function shufflePlay() {
    if (songs.length === 0) return;
    // The queue itself comes out dealt; the shuffle mode is not touched. It
    // used to be turned on here, and since the mode is remembered between
    // sessions it stayed on for the next album someone pressed Play on.
    void onPlay(0, { shuffled: true });
  }

  return (
    <View style={[styles.root, appleMusic && { backgroundColor: minidisc?.palette.background ?? appleBackground }]}>
      {minidisc ? <LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill}
        colors={[minidisc.palette.backgroundTop, minidisc.palette.background]} /> : null}
      <View style={{ flex: 1 }}>
      {/* Dominant color gradient; scrolls with 1:1 parallax. Hidden in search
          mode to keep the screen flat black. */}
      {searching || appleMusic ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.gradientWrap,
            {
              top: -band,
              height: gradientH + band,
              // Moves down with the revealed search bar, which pushes the header
              // down without moving the scroll offset. On its own view, because
              // this is a height animated from JS and the scroll below is not:
              // one expression holding both would drag the scroll back onto this
              // side, which is the whole thing being avoided (see `AnimatedList`).
              transform: [{ translateY: searchH }],
            },
          ]}
        >
          <Reanimated.View
            style={[
              StyleSheet.absoluteFill,
              // And follows the scroll 1:1, natively.
              gradientStyle,
            ]}
          >
            {/* Color band above the gradient: when the search bar is revealed,
                content shifts down SEARCH_H px and this fills the gap at the top.
                Inside the view's own bounds: hanging above them, Android left
                the gap grey. */}
            {band > 0 ? (
              <View style={[styles.gradientAbove, { height: band, backgroundColor: headerColor }]} />
            ) : null}
            <LinearGradient
              {...easedFade(headerColor, colors.background)}
              style={[StyleSheet.absoluteFill, { top: band }]}
            />
          </Reanimated.View>
        </Animated.View>
      )}

      <GestureDetector gesture={revealPan}>
      <AnimatedList
        ref={bindListRef}
        renderScrollComponent={renderScrollComponent}
        // Search and description change the header height intentionally. The
        // default anchor compensation would counteract those changes.
        maintainVisibleContentPosition={NO_SCROLL_ANCHOR}
        maxItemsInRecyclePool={32}
        // Two bounded pools: ordinary rows and rows with a disc label. Keep
        // FlashList's default draw distance; FlatList's window knobs do not
        // describe a recycler and must not be carried over.
        getItemType={(row) => !filtered && discHeaders?.[row.origIndex] ? 'disc' : 'track'}
        data={shownRows}
        // The row's own key, not the song's: the same song can be in the list
        // twice and React was being handed the same key for both.
        keyExtractor={(row) => row.rowKey}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: insets.top + TOPBAR_H + spacing.md,
            paddingBottom: bottomPad,
            // Centred on a wide screen instead of stretched across it: a row
            // whose title is at one edge and whose duration is at the other,
            // a hand's width apart, is a phone screen that was pulled (#131).
            paddingHorizontal: centredPadding(screenW, spacing.lg),
          },
        ]}
        scrollEventThrottle={16}
        onScroll={onScroll}
        ListHeaderComponent={
          <View>
            {searchBar ? (
              /* Collapsed = height 0 (invisible); the gesture reveals it. The clip
                 goes in a no-padding container: any padding would impose a
                 minimum height and show a sliver. */
              <Animated.View style={[styles.searchClip, { height: searchH }]}>
              <View style={styles.searchRow}>
                <View collapsable={false} style={styles.searchBox}>
                  {searchMaterialMounted ? <GlassBackdrop radius={radius.pill} tint={colors.highlight} variant="regular" /> : null}
                  <Icon name="search" size={18} color={colors.textSecondary} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={searchPlaceholder ?? t('Find in playlist')}
                    placeholderTextColor={colors.textSecondary}
                    value={query}
                    onChangeText={setQuery}
                    onFocus={() => setSearching(true)}
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                  {query.length > 0 ? (
                    <GlassPressable variant="subtle"
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('Clear')}
                      onPress={() => setQuery('')}
                    >
                      <Icon name="close-circle" size={18} color={colors.textSecondary} />
                    </GlassPressable>
                  ) : null}
                </View>
                {searching ? (
                  <GlassPressable variant="subtle" hitSlop={8} accessibilityRole="button" onPress={cancelSearch}>
                    <Text style={styles.searchCancel}>{t('Cancel')}</Text>
                  </GlassPressable>
                ) : null}
              </View>
              </Animated.View>
            ) : null}
            {/* While searching, the large header is hidden: results stay flush
                with the bar, which is what Spotify does. */}
            {searching ? null : playlistPresentation ? (
              <PlaylistDetailHeader title={title} owner={subtitle} description={description} meta={meta}
                coverUri={coverUri} art={art} apple={appleMusic} onCoverPress={onCoverPress}
                artwork={renderCover?.(art)} disabled={songs.length === 0} onPlay={() => { if (songs.length) void onPlay(0); }}
                onShuffle={shufflePlay} shuffleActive={shuffleActive} onMenu={onMenu}
                utility={<>
                  {favorite ? <FavoriteButton id={favorite.id} type={favorite.type} starred={favorite.starred}
                    size={24} glyph={appleMusic ? 'star' : undefined} style={playlistHeaderUtility} /> : null}
                  {download ? <Pressable onPress={download.onPress} style={playlistHeaderUtility} accessibilityRole="button"
                    accessibilityLabel={download.status === 'done' ? t('Remove download') : t('Download')}
                    accessibilityValue={download.status === 'active' ? { text: `${Math.round(download.progress * 100)}%` } : undefined}>
                    {download.status === 'active' ? <ActivityIndicator color={colors.accent} /> : <Icon
                      name={download.status === 'done' ? 'checkmark-circle' : 'arrow-down-circle-outline'}
                      size={25} color={download.status === 'done' ? colors.accent : colors.textSecondary} />}
                  </Pressable> : null}
                  {onSort ? <Pressable onPress={onSort} style={playlistHeaderUtility} accessibilityRole="button" accessibilityLabel={t('Sort')}>
                    <Icon name="swap-vertical" size={22} color={colors.textSecondary} />
                  </Pressable> : null}
                </>} />
            ) : minidisc ? (
              <MinidiscAlbumHeader title={title} subtitle={subtitle} onSubtitlePress={onSubtitlePress}
                meta={minidisc.meta} explicit={showExplicit} coverUri={coverUri} coverSize={art}
                onCoverPress={onCoverPress} description={description} genres={genres} palette={minidisc.palette}
                disabled={songs.length === 0} shuffleActive={shuffleActive} onShuffle={shufflePlay}
                onPlay={() => { if (songs.length > 0) void onPlay(0); }} download={download}
                artwork={renderCover?.(art)} />
            ) : (
          <View style={[styles.header, appleMusic && voltaStyles.header]}>
            {hideCover ? null : (
              <Reanimated.View style={[styles.coverCenter, appleMusic && voltaStyles.coverCenter, coverStyle]}>
                {onCoverPress ? (
                  <Pressable
                    onPress={onCoverPress}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={t('View cover')}
                  >
                    {renderCover ? renderCover(art) : <Cover uri={coverUri} size={art} />}
                  </Pressable>
                ) : renderCover ? (
                  renderCover(art)
                ) : (
                  <Cover uri={coverUri} size={art} />
                )}
              </Reanimated.View>
            )}
            <Text style={[styles.title, appleMusic && voltaStyles.title]} numberOfLines={appleMusic ? 3 : 2}>
              {title}
            </Text>
            {subtitle ? (
              onSubtitlePress ? (
                <GlassPressable buttonMaterial={false} variant="subtle" hitSlop={6} style={[styles.subtitleRow, appleMusic && voltaStyles.subtitleRow]} onPress={onSubtitlePress}>
                  {artistImageUri && !appleMusic ? (
                    <View style={styles.artistPhoto}>
                      <Cover uri={artistImageUri} size={24} />
                    </View>
                  ) : null}
                  <Text style={[styles.subtitle, styles.subtitleLink, appleMusic && voltaStyles.subtitle]}>{subtitle}</Text>
                </GlassPressable>
              ) : (
                <Text style={[styles.subtitle, appleMusic && voltaStyles.subtitle]}>{subtitle}</Text>
              )
            ) : null}
            {description?.trim() ? (
              <View>
                {/* The whole text, drawn invisibly: with `numberOfLines` set,
                    onTextLayout only reports the lines that survived, so the
                    copy below can't tell whether anything was cut. */}
                <Text
                  style={styles.descriptionMeasure}
                  onTextLayout={(e) =>
                    setDescriptionHasMore(e.nativeEvent.lines.length > DESCRIPTION_LINES)
                  }
                >
                  {description.trim()}
                </Text>
                <Text
                  style={[styles.description, appleMusic && voltaStyles.description]}
                  numberOfLines={descriptionExpanded ? undefined : DESCRIPTION_LINES}
                >
                  {description.trim()}
                </Text>
                {descriptionHasMore ? (
                  <GlassPressable variant="subtle"
                    accessibilityRole="button"
                    onPress={() => setDescriptionExpanded((v) => !v)}
                    style={[styles.descriptionMore, appleMusic && voltaStyles.centered]}
                    hitSlop={spacing.sm}
                  >
                    <Text style={styles.descriptionMoreText}>
                      {descriptionExpanded ? t('Show less') : t('Show more')}
                    </Text>
                  </GlassPressable>
                ) : null}
              </View>
            ) : null}
            {showExplicit || meta ? (
              <View style={[styles.metaRow, appleMusic && voltaStyles.metaRow]}>
                {showExplicit ? <ExplicitBadge status="explicit" /> : null}
                {meta ? <Text style={[styles.meta, appleMusic && voltaStyles.meta]}>{meta}</Text> : null}
              </View>
            ) : null}
            {/* Deliberately quiet: same weight as the metadata line above, so
                it reads as one more piece of album info and not as a control.
                Horizontal because an album with eight tags shouldn't push the
                play button down the screen. */}
            {genres && genres.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.genres}
                contentContainerStyle={styles.genresContent}
              >
                {genres.map((g) => (
                  <Link key={g} href={`/genre/${encodeURIComponent(g)}`} asChild>
                    <GlassPressable variant="subtle" style={styles.genreChip}>
                      <Text style={styles.genreText}>{g}</Text>
                    </GlassPressable>
                  </Link>
                ))}
              </ScrollView>
            ) : null}

            {appleMusic ? <>
              <View style={[voltaStyles.actions, voltaAlbum && voltaStyles.albumActions]}>
                <GlassPressable variant="subtle"
                  style={[voltaStyles.roundAction, voltaAlbum && voltaStyles.albumRoundAction]}
                  accessibilityRole="button"
                  accessibilityLabel={t('Shuffle')}
                  disabled={songs.length === 0}
                  onPress={shufflePlay}
                >
                  <Icon name="shuffle" size={voltaAlbum ? 16 : 23} color={shuffleActive ? colors.accent : colors.text} />
                </GlassPressable>
                <GlassPressable variant="prominent"
                  style={[voltaStyles.playPill, voltaAlbum && voltaStyles.albumPlayPill, songs.length === 0 && { opacity: 0.45 }]}
                  accessibilityRole="button" accessibilityLabel={t('Play')}
                  disabled={songs.length === 0}
                  onPress={() => songs.length > 0 && onPlay(0)}
                >
                  <Icon name="play" size={voltaAlbum ? 14 : 22} color={colors.onInverse} />
                  <Text style={[voltaStyles.playLabel, voltaAlbum && voltaStyles.albumPlayLabel]}>{t('Play')}</Text>
                </GlassPressable>
                {download ? (
                  <GlassPressable variant="subtle" style={[voltaStyles.roundAction, voltaAlbum && voltaStyles.albumRoundAction]}
                    accessibilityRole="button"
                    accessibilityLabel={download.status === 'done' ? t('Remove download') : t('Download')}
                    accessibilityValue={download.status === 'active' ? { text: `${Math.round(download.progress * 100)}%` } : undefined}
                    onPress={download.onPress}
                  >
                    {download.status === 'active' ? <ActivityIndicator size="small" color={colors.text} /> : (
                      <Icon name={download.status === 'done' ? 'checkmark-circle' : 'arrow-down-circle-outline'}
                        size={voltaAlbum ? 20 : 25} color={download.status === 'done' ? colors.accent : colors.text} />
                    )}
                  </GlassPressable>
                ) : voltaAlbum ? (
                  <GlassPressable variant="subtle" style={[voltaStyles.roundAction, voltaStyles.albumRoundAction, { opacity: 0.35 }]}
                    accessibilityRole="button" accessibilityLabel={t('Download')} disabled>
                    <Icon name="arrow-down-circle-outline" size={20} color={colors.text} />
                  </GlassPressable>
                ) : favorite ? (
                  <FavoriteButton id={favorite.id} type={favorite.type} starred={favorite.starred}
                    size={23} glyph="star" style={voltaStyles.roundAction} />
                ) : <View style={voltaStyles.roundSpacer} />}
                {voltaAlbum && onMenu ? (
                  <GlassPressable variant="subtle" style={[voltaStyles.roundAction, voltaStyles.albumRoundAction]}
                    accessibilityRole="button" accessibilityLabel={t('More options')} onPress={onMenu}>
                    <Icon name="ellipsis-horizontal" size={17} color={colors.text} />
                  </GlassPressable>
                ) : null}
              </View>
              {(!voltaAlbum && favorite && download) || onSort ? (
                <View style={voltaStyles.secondaryActions}>
                  {!voltaAlbum && favorite && download ? <FavoriteButton id={favorite.id} type={favorite.type}
                    starred={favorite.starred} glyph="star" size={23} style={voltaStyles.roundAction} /> : null}
                  {onSort ? <GlassPressable style={voltaStyles.sortAction} accessibilityRole="button"
                    accessibilityLabel={t('Sort')} onPress={onSort}>
                    <Icon name="swap-vertical" size={20} color={colors.textSecondary} />
                    <Text style={voltaStyles.sortLabel}>{t('Sort')}</Text>
                  </GlassPressable> : null}
                </View>
              ) : null}
            </> : (
            <View style={styles.actions}>
              <View style={styles.actionsLeft}>
                {favorite ? (
                  <FavoriteButton
                    id={favorite.id}
                    type={favorite.type}
                    starred={favorite.starred}
                    size={28}
                  />
                ) : null}
                {download ? (
                  <GlassPressable variant="subtle"
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={
                      download.status === 'done' ? t('Remove download') : t('Download')
                    }
                    onPress={download.onPress}
                    style={styles.downloadWrap}
                  >
                    {download.status === 'active' ? (
                      <>
                        <ActivityIndicator size="small" color={colors.accent} />
                        <Text style={[styles.downloadProgress, { color: colors.accent }]}>
                          {Math.round(download.progress * 100)}%
                        </Text>
                      </>
                    ) : (
                      <Icon
                        name={
                          download.status === 'done'
                            ? 'arrow-down-circle'
                            : 'arrow-down-circle-outline'
                        }
                        size={26}
                        color={download.status === 'done' ? colors.accent : colors.textSecondary}
                      />
                    )}
                  </GlassPressable>
                ) : null}
                {onSort ? (
                  <GlassPressable variant="subtle"
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('Sort')}
                    onPress={onSort}
                  >
                    <Icon name="swap-vertical" size={24} color={colors.textSecondary} />
                  </GlassPressable>
                ) : null}
                {onMenu ? (
                  <GlassPressable variant="subtle"
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('More options')}
                    onPress={onMenu}
                  >
                    <Icon name="ellipsis-horizontal" size={26} color={colors.textSecondary} />
                  </GlassPressable>
                ) : null}
              </View>

              <View style={styles.actionsRight}>
                <GlassPressable variant="subtle"
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('Shuffle')}
                  onPress={shufflePlay}
                >
                  <Icon
                    name="shuffle"
                    size={26}
                    color={shuffleActive ? colors.accent : colors.textSecondary}
                  />
                </GlassPressable>
                <GlassPressable variant="prominent" tint={colors.accent}
                  style={[styles.playButton, { backgroundColor: colors.accent }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('Play')}
                  onPress={() => songs.length > 0 && onPlay(0)}
                >
                  <Icon
                    name="play"
                    size={28}
                    color={colors.onAccent}
                  />
                </GlassPressable>
              </View>
            </View>
            )}

            {addAction ? (
              <GlassPressable variant="regular"
                accessibilityRole="button"
                onPress={addAction.onPress}
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
              >
                <View style={styles.addBox}>
                  <Icon
                    name={addAction.icon ?? 'add'}
                    size={26}
                    color={colors.textSecondary}
                  />
                </View>
                <Text style={styles.addLabel}>{addAction.label}</Text>
              </GlassPressable>
            ) : null}
          </View>
            )}
          </View>
        }
        extraData={selectedIds}
        renderItem={({ item }) => {
          // The occurrence owns its positions; FlashList's result index is
          // irrelevant to play, remove and numbering, including while filtered.
          const { song, origIndex, rowKey, serverIndex } = item;
          // Disc header (only when not searching, where origIndex === index).
          const discLabel = filtered ? undefined : discHeaders?.[origIndex];
          const row = (
            <TrackRow
              song={song}
              rowOccurrenceKey={rowKey}
              displayIndex={origIndex}
              serverIndex={serverIndex}
              ownerScope={ownerScope}
              // With artwork visible the number is omitted: the album stays as
              // usual (only the artist's Popular shows number + cover).
              position={numbered && !showArtwork ? song.track ?? origIndex + 1 : undefined}
              isCurrent={currentId === song.id}
              showArtwork={showArtwork}
              menuContext={
                playlistId
                  ? { playlistId, index: serverIndex }
                  : undefined
              }
              selecting={selecting}
              selected={!!selectedIds?.has(rowKey)}
              onPressIn={() => {
                justLongPressed.current = null;
              }}
              onLongPress={
                selection && !selecting
                  ? () => {
                      haptic('medium');
                      setSelectedIds(new Set([rowKey]));
                      justLongPressed.current = rowKey;
                    }
                  : undefined
              }
              onPress={() => {
                // Discards the onPress that follows the selection long-press:
                // otherwise it would deselect the song you entered selection with.
                if (justLongPressed.current === rowKey) return;
                if (selecting) toggleSelect(rowKey);
                else playAtIndex(origIndex);
              }}
            />
          );
          if (!discLabel) return row;
          return (
            <>
              <DiscHeader label={discLabel} color={minidisc?.palette.textSecondary} />
              {row}
            </>
          );
        }}
        ListEmptyComponent={
          filtered ? (
            <Text style={styles.noResults}>{t('No results for “{q}”', { q: query.trim() })}</Text>
          ) : emptyState ? (
            <>{emptyState}</>
          ) : null
        }
        ListFooterComponent={footer ? <>{footer}</> : null}
      />
      </GestureDetector>
      </View>

      {/* Fixed top bar: the background and title appear on collapse. In
          selection mode it's replaced by ✕ + counter + select all. */}
      <View style={[styles.bar, { height: insets.top + TOPBAR_H, paddingTop: insets.top }]}>
        {selecting ? (
          <>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: headerColor }]} />
            <GlassPressable variant="subtle"
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('Close')}
              onPress={() => setSelectedIds(null)}
            >
              <Icon name="close" size={26} color={colors.text} />
            </GlassPressable>
            <Text style={styles.barTitle} numberOfLines={1}>
              {t('{n} selected', { n: selectedIds.size })}
            </Text>
            <GlassPressable variant="subtle"
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('Select all')}
              onPress={() =>
                setSelectedIds(allSelected ? new Set() : new Set(rowKeys))
              }
            >
              <Icon
                name="checkmark-done"
                size={24}
                color={allSelected ? colors.accent : colors.text}
              />
            </GlassPressable>
          </>
        ) : (
          <>
            <TopBarBackground color={headerColor} opacity={barBgOpacity} />
            <BackChevron size={28} label={t('Close')} color={minidisc?.palette.text}
              style={minidisc ? [voltaStyles.roundAction, { backgroundColor: minidisc.palette.controlFill }] : appleMusic ? voltaStyles.roundAction : undefined} />
            <Reanimated.Text
              style={[styles.barTitleCentered, { top: insets.top + 10 }, appleMusic && { left: minidisc ? 70 : 76, right: minidisc ? 126 : 76 },
                minidisc && { color: minidisc.palette.text }, barContentStyle]}
              numberOfLines={1}
            >
              {title}
            </Reanimated.Text>
            {appleMusic ? (
              <View style={voltaStyles.barActions}>
                {minidisc ? <View style={[minidiscToolbar.group, { backgroundColor: minidisc.palette.controlFill }]}>
                  {favorite ? <FavoriteButton id={favorite.id} type={favorite.type} starred={favorite.starred}
                    size={23} glyph="star" style={minidiscToolbar.button} /> : null}
                  {onMenu ? <GlassPressable buttonMaterial={false} style={minidiscToolbar.button} accessibilityRole="button"
                    accessibilityLabel={t('More options')} onPress={onMenu}>
                    <Icon name="ellipsis-horizontal" size={23} color={minidisc.palette.text} />
                  </GlassPressable> : null}
                </View> : onMenu ? <GlassPressable style={voltaStyles.roundAction} accessibilityRole="button"
                  accessibilityLabel={t('More options')} onPress={onMenu}>
                  <Icon name="ellipsis-horizontal" size={23} color={colors.text} />
                </GlassPressable> : null}
              </View>
            ) : null}
          </>
        )}
      </View>

      {selecting ? (
        <SelectionBar
          count={selectedIds.size}
          // Second slot: taking songs out of this list where that is a thing,
          // and downloading where it isn't. Whichever one loses the slot is
          // the one behind ⋯.
          actions={[...addToAction, ...(removeAction.length > 0 ? removeAction : downloadAction)]}
          menu={[
            ...(removeAction.length > 0 ? downloadAction : []),
            ...selectionMenu.actions,
          ]}
        />
      ) : null}
      {selectionMenu.dialogs}
    </View>
  );
}

/** Disc header (thin separator + label) for multi-disc albums. */
function DiscHeader({ label, color }: { label: string; color?: string }) {
  return (
    <View style={styles.discHeader}>
      <Text style={[styles.discHeaderText, color ? { color } : undefined]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const minidiscToolbar = StyleSheet.create({
  group: { flexDirection: 'row', borderRadius: 999, paddingHorizontal: 3 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

const styles = themed((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  gradientWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  gradientAbove: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  searchClip: {
    overflow: 'hidden',
  },
  searchRow: {
    height: SEARCH_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // The gap to the cover goes inside the animated height: this way it
    // collapses along with the bar (an external margin would always be visible).
    paddingBottom: spacing.md,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // Translucent to let the header's dominant color through (Spotify).
    backgroundColor: 'transparent',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 44,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingVertical: 0,
  },
  searchCancel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  noResults: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  addBox: {
    width: 48,
    height: 48,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  discHeader: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  discHeaderText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  header: {
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  coverCenter: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    letterSpacing: tracking.display,
    fontWeight: '500',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  subtitleLink: {
    color: colors.text,
    fontWeight: '500',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
  },
  artistPhoto: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  // Same weight and colour as the metadata under it: what the playlist says
  // about itself belongs with the rest of what it says, not above it as a
  // second title.
  description: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  // Same text, same width, no paint: only here to count the lines.
  descriptionMeasure: {
    position: 'absolute',
    opacity: 0,
    pointerEvents: 'none',
    width: '100%',
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  // Under the text, never over it: the header sits on the dominant color
  // gradient, so a patch of the plain background would show as a rectangle.
  descriptionMore: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  descriptionMoreText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  // The row keeps the gap the line used to keep for itself, so a header with
  // no badge sits exactly where it always did.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  // `flexGrow: 0` or the row would stretch to fill the header column.
  genres: { flexGrow: 0, marginTop: spacing.sm },
  genresContent: { gap: spacing.sm, paddingRight: spacing.lg },
  genreChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  genreText: { color: colors.textSecondary, fontSize: fontSize.xs },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  downloadWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  downloadProgress: {
    color: colors.accent,
    fontSize: fontSize.xs,
    fontWeight: '500',
    minWidth: 32,
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  playButton: {
    backgroundColor: colors.accent,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  barTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  barTitleCentered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    // The same clearance on both sides, the width of the back chevron and its
    // gap: centered on the screen, and a long name stops short of the chevron.
    left: spacing.lg + 28 + spacing.md,
    right: spacing.lg + 28 + spacing.md,
    textAlign: 'center',
    includeFontPadding: false,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
}));

/** Volta's centered artwork/title and symmetric action layout, adapted for RN. */
const voltaStyles = themed((colors) => ({
  header: { paddingHorizontal: 4, paddingBottom: spacing.xl },
  coverCenter: { marginTop: spacing.sm, marginBottom: spacing.xl },
  title: { fontSize: fontSize.xl, lineHeight: 30, textAlign: 'center', letterSpacing: tracking.heading },
  subtitle: { fontSize: 18, lineHeight: 24, textAlign: 'center', color: colors.textSecondary, fontWeight: '400' },
  subtitleRow: { alignSelf: 'center', justifyContent: 'center', maxWidth: '100%' },
  centered: { alignSelf: 'center' },
  description: { textAlign: 'center', marginTop: spacing.sm },
  metaRow: { justifyContent: 'center', marginTop: spacing.sm },
  meta: { textAlign: 'center', fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginVertical: spacing.xl },
  // AlbumDetailView.actionRow: shuffle, play, download, overflow (favorite).
  // Existing list padding + the 4dp header inset provide its 20dp side margin.
  albumActions: { gap: 14, marginVertical: 20 },
  albumRoundAction: { width: 50, height: 50 },
  albumPlayPill: { height: 'auto' as const, minHeight: 50, paddingVertical: 12, paddingHorizontal: 12, gap: 7 },
  albumPlayLabel: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, flexShrink: 1 },
  secondaryActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg,
    marginTop: -spacing.md, marginBottom: spacing.md },
  sortAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  sortLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  roundAction: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.highlight,
    alignItems: 'center', justifyContent: 'center',
  },
  roundSpacer: { width: 44 },
  playPill: {
    flex: 1, height: 48, borderRadius: radius.pill, backgroundColor: colors.text,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  playLabel: { color: colors.onInverse, fontSize: fontSize.md, fontWeight: '500' },
  barActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
}));

/**
 * The header's fade from the cover colour into the page, eased rather than
 * straight: a straight blend has a visible corner where it starts and a line
 * where it lands. Smoothstep eases in and out of both, over several stops since
 * the gradient itself only blends in straight lines between them.
 */
function easedFade(from: string, to: string): { colors: [string, string, ...string[]]; locations: [number, number, ...number[]] } {
  const a = hexChannels(from);
  const b = hexChannels(to);
  if (!a || !b) return { colors: [from, from, to], locations: [0, 0.35, 1] };
  const START = 0.25;
  const STEPS = 8;
  const colors: string[] = [from];
  const locations: number[] = [0];
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS;
    const k = u * u * (3 - 2 * u);
    colors.push(
      `rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * k)).join(', ')})`,
    );
    locations.push(START + (1 - START) * u);
  }
  return {
    colors: colors as [string, string, ...string[]],
    locations: locations as [number, number, ...number[]],
  };
}

function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
