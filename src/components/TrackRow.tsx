/** Song row inside a list (album, playlist, search results). */
import Icon from '@/components/Icon';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { COVER, songCoverUrl, star } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { formatDuration } from '@/lib/format';
import { applyStarChange, resyncFavorites, unstarWithUndo } from '@/lib/favoritesCache';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSongMenu, type SongMenuContext } from '@/store/songMenu';
import { useSettings, type SwipeAction } from '@/store/settings';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';
import { Cover, useCoverRadius } from './Cover';
import { usePressFeedback } from '@/hooks/usePressFeedback';
import { bump } from '@/lib/perfLog';
import { useAppleMusicStyle } from '@/hooks/useAppleMusicStyle';
import { appleMusicStyles } from '@/theme/appleMusic';
import { useArtistPagePalette } from '@/components/volta/ArtistPagePalette';
import { PlayingBars } from './PlayingBars';
import { ExplicitBadge, useExplicitBadge } from './ExplicitBadge';
import { FavoriteButton } from './FavoriteButton';
import { TrackSwipeable } from './TrackSwipeable';

interface Props {
  song: Song;
  /** Full recycled-cell binding, including duplicate occurrence and positions. */
  rowOccurrenceKey?: string;
  displayIndex?: number;
  serverIndex?: number;
  ownerScope?: string;
  /**
   * Optional number on the left (e.g. the track number on an album). Coexists
   * with the cover: number then cover (Spotify's "Popular" style).
   */
  position?: number;
  isCurrent?: boolean;
  /** Playlist context (to allow "remove from list" in the menu). */
  menuContext?: SongMenuContext;
  /**
   * Allows showing the heart for favorited songs (default true). Only appears
   * if the song is marked as favorite (Spotify style). Offline passes `false`
   * (no server favorites).
   */
  showFavorite?: boolean;
  /** Shows the ⋯ menu button (default true; works offline too). */
  showMenu?: boolean;
  /** Shows the mini album cover on the left (Spotify style). */
  showArtwork?: boolean;
  /** Multi-select mode: check circle and no swipe/menu/heart. */
  selecting?: boolean;
  /**
   * Swipe actions (default true). Off inside a horizontal carousel, where a
   * sideways swipe is meant to scroll it, not to queue the song under the finger.
   */
  swipeable?: boolean;
  /** Marked in selection mode. */
  selected?: boolean;
  onLongPress?: () => void;
  onPress: () => void;
  /** Press start (before onPress/onLongPress); used by the list to discard the
   *  onPress that follows the long-press to enter selection. */
  onPressIn?: () => void;
}

/** Swipe strip icon according to the configured action. */
const SWIPE_ICON: Record<Exclude<SwipeAction, 'off'>, keyof typeof Icon.glyphMap> = {
  queue: 'list',
  next: 'play-forward',
  favorite: 'heart',
  menu: 'ellipsis-horizontal',
};

/**
 * Action strip that peeks out behind the row during swipe. Invisible at rest:
 * the row is transparent (lets the header gradient through, Spotify style),
 * so the strip can only exist while the gesture lasts.
 */
function SwipeActionPanel({
  icon,
  side,
}: {
  icon: keyof typeof Icon.glyphMap;
  /** Side where the strip peeks out: the icon sticks to the edge it enters from. */
  side: 'left' | 'right';
}) {
  const pagePalette = useArtistPagePalette();
  return (
    <View
      style={[
        styles.queueAction,
        { backgroundColor: pagePalette?.accent ?? colors.accent, alignItems: side === 'left' ? 'flex-start' : 'flex-end' },
      ]}
    >
      <Icon name={icon} size={22} color={pagePalette?.onText ?? colors.onAccent} />
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function TrackRowBase({
  song,
  rowOccurrenceKey,
  displayIndex,
  serverIndex,
  ownerScope,
  position,
  isCurrent,
  menuContext,
  showFavorite = true,
  showMenu = true,
  showArtwork = false,
  selecting = false,
  swipeable = true,
  selected = false,
  onLongPress,
  onPress,
  onPressIn,
}: Props) {
  bump('render · TrackRow');
  const openMenu = useSongMenu((s) => s.open);
  const t = useT();
  const rowIdentity = JSON.stringify([ownerScope, rowOccurrenceKey ?? song.id, displayIndex, serverIndex]);
  const binding = useMemo(() => ({ rowIdentity, song }), [rowIdentity, song]);
  const currentBinding = useRef<object | null>(null);
  const pointer = useRef<{ binding: object; timestamp?: number; touch: boolean } | null>(null);
  const menuPointer = useRef<{ binding: object; timestamp?: number; touch: boolean } | null>(null);
  useLayoutEffect(() => {
    currentBinding.current = binding;
    return () => { currentBinding.current = null; };
  }, [binding]);
  const press = usePressFeedback(rowIdentity);

  function ownsPointer(pressed = pointer.current, event?: GestureResponderEvent) {
    return currentBinding.current === binding && (!pressed || (pressed.binding === binding
      && (pressed.timestamp === undefined || event?.nativeEvent.timestamp === undefined
        || event.nativeEvent.timestamp >= pressed.timestamp)));
  }

  function releasePointer(ref: typeof pointer, event?: GestureResponderEvent) {
    if (currentBinding.current !== binding) return;
    const pressed = ref.current;
    if (pressed?.timestamp !== undefined && event?.nativeEvent.timestamp !== undefined
      && event.nativeEvent.timestamp < pressed.timestamp) return;
    // RN sends PressOut before Press. Keep the start owner through that event,
    // while allowing a later accessibility activation without a pointer.
    queueMicrotask(() => { if (ref.current === pressed) ref.current = null; });
  }

  function touchStart(ref: typeof pointer, event: GestureResponderEvent) {
    if (currentBinding.current !== binding) return;
    const timestamp = event.nativeEvent.timestamp;
    if (ref.current?.timestamp !== undefined && timestamp < ref.current.timestamp) return;
    ref.current = { binding, timestamp, touch: true };
  }
  // Memoized below, and with its own `propsEqual` at that: the list repainting
  // does not reach the rows, so each one asks for the appearance itself.
  useTheme();
  const appleMusic = useAppleMusicStyle();
  const pagePalette = useArtistPagePalette();
  const accent = pagePalette?.accent ?? colors.accent;
  const showDuration = useSettings((s) => s.showSongDuration);
  const showRating = useSettings((s) => s.showListRating);
  const swipeAction = useSettings((s) => s.swipeAction);
  const swipeLeftAction = useSettings((s) => s.swipeLeftAction);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const toast = useToast((s) => s.show);

  // Favorite: the central favorites list (`favIds`) is the reliable source —
  // it reflects mark/unmark upon invalidation. The song's `starred` (which
  // getAlbum fetches but does NOT refresh) is only used as a fallback while that
  // list is still loading; otherwise, unmarking on an album would keep the heart
  // visible (the OR with `song.starred` never became false).
  const favIds = useFavoriteIds(showFavorite);
  const favorited = showFavorite && (favIds ? favIds.has(song.id) : !!song.starred);
  const downloaded = useDownloads((s) => !!s.files[song.id]);
  const offline = useAuthStore((s) => s.offline);
  /**
   * Not playable without a connection: visible but grayed out and not playable.
   *
   * Worked out here rather than trusted from the song, because the mark is put
   * on by the offline data path and a list can reach the screen without having
   * been through it: anything the server answered before the connection went
   * away carries no mark at all, and would sit here looking perfectly playable
   * (@ztx-lyghters). The rule is the player's own, so the row cannot promise
   * what the player will refuse.
   */
  const unavailable = offline
    ? !song.url && !song.localUri && !downloaded
    : !!song.unavailable;
  const explicit = useExplicitBadge(song.explicitStatus);
  const swipeEnabled = swipeable && !selecting && !unavailable &&
    (swipeAction !== 'off' || swipeLeftAction !== 'off');

  // Swipe right = configurable action (Spotify-style gesture). The row returns
  // on its own; the background strip only peaks during the gesture.
  // NOTE: the gesture only coexists well with scroll if the parent list uses
  // react-native-gesture-handler (FlatList/ScrollView from that library).
  async function toggleFavoriteSwipe() {
    // Removing is deferred behind «Undo»; the heart here reads from the cached
    // list, so there is no state of its own to put back.
    if (favorited) {
      unstarWithUndo('song', song.id);
      return;
    }
    try {
      await star(song.id, 'song');
      // The cached list is patched, not thrown away: see `favoritesCache`.
      applyStarChange('song', song.id, true, song);
      toast(t('Added to favorites'));
    } catch {
      resyncFavorites();
      toast(t("Couldn't complete the action"));
    }
  }

  function runSwipeAction(action: SwipeAction) {
    haptic('light');
    switch (action) {
      case 'queue':
        addToQueue(song);
        toast(t('Added to queue'));
        break;
      case 'next':
        playNext(song);
        toast(t('Playing next'));
        break;
      case 'favorite':
        void toggleFavoriteSwipe();
        break;
      case 'menu':
        openMenu(song, menuContext);
        break;
      default:
        break;
    }
  }

  const row = (
    <AnimatedPressable
      // The row dims late rather than not at all: it used to light up on the
      // way past while somebody scrolled, which read as taps nobody made, so
      // it stopped answering the finger entirely. The wait is in the fade now
      // and not in the gesture (see `usePressFeedback`).
      //
      // Not downloaded: dimmed and with warning on tap OUTSIDE selection; inside
      // selection it behaves normally (long-press enters, tap marks) so it can
      // be added to a list even though it can't be played. One or the other:
      // the press style sets opacity too, and after `dimmed` it undid it.
      style={[styles.row, appleMusic && appleMusicStyles.mediaRow, unavailable && !selecting ? styles.dimmed : press.style]}
      // PressIn can fire again when the same finger re-enters the press rect.
      // Native touch-down, rather than re-entry, owns a recycled row's press.
      onTouchStart={(event) => touchStart(pointer, event)}
      onTouchEnd={(event) => releasePointer(pointer, event)}
      onTouchCancel={(event) => releasePointer(pointer, event)}
      onPressIn={(event) => {
        if (currentBinding.current !== binding) return;
        if (!pointer.current) pointer.current = { binding, timestamp: event.nativeEvent.timestamp, touch: false };
        if (!ownsPointer(pointer.current, event)) return;
        press.onPressIn();
        if (!(unavailable && !selecting)) onPressIn?.();
      }}
      onPressOut={(event) => {
        if (ownsPointer(pointer.current, event)) press.onPressOut();
        if (!pointer.current?.touch) releasePointer(pointer, event);
      }}
      onPress={(event) => {
        if (!ownsPointer(pointer.current, event)) return;
        pointer.current = null;
        if (unavailable && !selecting) toast(t('Not available offline'));
        else onPress();
      }}
      onLongPress={onLongPress ? (event) => {
        if (!ownsPointer(pointer.current, event)) return;
        press.onPressOut();
        onLongPress();
      } : undefined}
    >
      {selecting ? (
        <Icon
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? accent : pagePalette?.textMuted ?? colors.textMuted}
        />
      ) : null}
      {/* One line whatever happens: the slot fits any track number worth
          having, and past that a number that does not fit should be cut rather
          than push the row taller than every other one. */}
      {position !== undefined ? (
        // The slot says which track this is, so on the one playing it says so
        // with the bars instead of the number. Same slot, so nothing shifts
        // when the song changes.
        <View style={styles.leftSlot}>
          {isCurrent ? (
            <PlayingBars />
          ) : (
            <Text style={[styles.position, pagePalette && { color: pagePalette.textMuted }]} numberOfLines={1}>
              {position}
            </Text>
          )}
        </View>
      ) : null}
      {showArtwork ? (
        <View style={styles.artwork}>
          {/* Fast lists should not start two-image fades on every newly mounted
              row. Keep the decoded cache and render the thumbnail directly. */}
          <Cover uri={songCoverUrl(song, COVER.thumb)} resetKey={rowIdentity} size={48} transition={0} />
          {/* Over the picture where there is no number to give up, behind a
              scrim so the bars read on artwork of any colour. */}
          {isCurrent && position === undefined ? (
            <ArtworkPlaying />
          ) : null}
        </View>
      ) : null}

      <View style={styles.info}>
        <Text
          style={[styles.title, appleMusic && appleMusicStyles.rowTitle,
            pagePalette && { color: pagePalette.text }, isCurrent && { color: accent }]}
          numberOfLines={1}
        >
          {song.title}
        </Text>
        {downloaded || explicit || song.artist ? (
          <View style={styles.subRow}>
            {downloaded ? (
              <Icon name="arrow-down-circle" size={13} color={accent} />
            ) : null}
            {/* Ahead of the name, like every other player draws it: the badge
                is about the track, and an artist name long enough to be cut
                would take the badge off the row with it. */}
            <ExplicitBadge status={song.explicitStatus} />
            {song.artist ? (
              <Text style={[styles.artist, appleMusic && appleMusicStyles.rowSubtitle,
                pagePalette && { color: pagePalette.textSecondary }]} numberOfLines={1}>
                {song.artist}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {favorited && !selecting && !unavailable ? (
        <FavoriteButton id={song.id} resetKey={rowIdentity} starred undo size={20} />
      ) : null}
      {showRating && song.userRating ? (
        <View style={styles.rating} accessibilityLabel={t('Rate {n} stars', { n: song.userRating })}>
          {Array.from({ length: song.userRating }).map((_, i) => (
            <Icon key={i} name="star" size={12} color={accent} />
          ))}
        </View>
      ) : null}
      {showDuration ? <Text style={[styles.duration, pagePalette && { color: pagePalette.textMuted }]}>{formatDuration(song.duration)}</Text> : null}
      {showMenu && !selecting && !unavailable ? (
        <Pressable
          hitSlop={8}
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel={t('More options')}
          onTouchStart={(event) => touchStart(menuPointer, event)}
          onTouchEnd={(event) => releasePointer(menuPointer, event)}
          onTouchCancel={(event) => releasePointer(menuPointer, event)}
          onPressIn={(event) => {
            if (currentBinding.current !== binding || menuPointer.current) return;
            menuPointer.current = { binding, timestamp: event.nativeEvent.timestamp, touch: false };
          }}
          onPressOut={(event) => { if (!menuPointer.current?.touch) releasePointer(menuPointer, event); }}
          onPress={(event) => {
            if (!ownsPointer(menuPointer.current, event)) return;
            menuPointer.current = null;
            openMenu(song, menuContext);
          }}
        >
          <Icon name="ellipsis-horizontal" size={18} color={pagePalette?.textSecondary ?? colors.textSecondary} />
        </Pressable>
      ) : null}
    </AnimatedPressable>
  );

  // Disabled swipes do not need animated wrappers or gesture handlers, even
  // when the list itself allows swiping. Keep ordinary row press feedback.
  if (!swipeEnabled) return row;

  return (
    <TrackSwipeable
      rowIdentity={`${rowIdentity}:${swipeAction}:${swipeLeftAction}`}
      allowRight={swipeAction !== 'off'}
      allowLeft={swipeLeftAction !== 'off'}
      actionWidth={22 + spacing.lg * 2}
      renderAction={(direction) => {
        const action = direction > 0 ? swipeAction : swipeLeftAction;
        return action === 'off' ? null : (
          <SwipeActionPanel icon={SWIPE_ICON[action]} side={direction > 0 ? 'left' : 'right'} />
        );
      }}
      onSwipe={(direction) => {
        runSwipeAction(direction > 0 ? swipeAction : swipeLeftAction);
      }}
    >
      {row}
    </TrackSwipeable>
  );
}

function sameMenuContext(a?: SongMenuContext, b?: SongMenuContext): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.playlistId === b.playlistId && a.index === b.index;
}

/**
 * `memo` comparison: re-renders only if something the row paints or how it
 * behaves changes. Callbacks (`onPress`/`onPressIn`) are recreated on every
 * parent render, but their behavior depends on the occurrence, playback/server
 * positions, list scope and selection state compared here. TrackListView's
 * playback dispatcher reads the latest list callback. Closure identity itself
 * is intentionally ignored; for `onLongPress` only whether it's active (allows
 * entering selection) matters. Without this, changing the current song would
 * re-render ALL visible rows (each receives new closures), not just the two
 * whose `isCurrent` changes. Internal subscriptions (downloads, settings,
 * favorites) keep re-rendering their row on their own when needed.
 */
function propsEqual(a: Props, b: Props): boolean {
  return (
    a.song === b.song &&
    a.rowOccurrenceKey === b.rowOccurrenceKey &&
    a.displayIndex === b.displayIndex &&
    a.serverIndex === b.serverIndex &&
    a.ownerScope === b.ownerScope &&
    a.position === b.position &&
    a.isCurrent === b.isCurrent &&
    a.showFavorite === b.showFavorite &&
    a.showMenu === b.showMenu &&
    a.showArtwork === b.showArtwork &&
    a.selecting === b.selecting &&
    a.swipeable === b.swipeable &&
    a.selected === b.selected &&
    !!a.onLongPress === !!b.onLongPress &&
    sameMenuContext(a.menuContext, b.menuContext)
  );
}

export const TrackRow = memo(TrackRowBase, propsEqual);

/** Its own component so only the playing row reads the cover corner. */
function ArtworkPlaying() {
  const corner = useCoverRadius(48);
  return (
    <View style={[styles.artworkPlaying, { borderRadius: corner }]}>
      <PlayingBars />
    </View>
  );
}

const styles = themed((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
    // Transparent: the header color gradient (album/playlist) seeps through
    // the first rows, like Spotify. The swipe action no longer needs to be
    // covered: it hides on its own at rest (see QueueAction).
  },
  queueAction: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
  },
  position: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  leftSlot: {
    // Three digits' worth. A hundred-track compilation is a real thing, and at
    // 24 the number wrapped: "100" came out as a 10 with a 0 under it, and the
    // row grew a line to hold it. The width is generous on purpose, since the
    // font is the reader's to choose and some are wider than others.
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Separates the three-dot icon from the right edge and expands the touch area
  // (Spotify style): the vertical padding makes almost the entire row height
  // on that side tappable, so it's much easier to hit with a finger.
  menuButton: {
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    paddingVertical: spacing.md,
  },
  artwork: {
    width: 48,
    height: 48,
  },
  artworkPlaying: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  info: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  duration: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  rating: {
    flexDirection: 'row',
    gap: 1,
  },
  // Song not available offline (mirror): dimmed and not tappable.
  dimmed: {
    opacity: 0.4,
  },
}));
