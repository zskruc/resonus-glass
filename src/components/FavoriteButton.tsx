/** Heart to mark/unmark favorites (Subsonic star/unstar). */
import Icon from '@/components/Icon';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { GlassPressable } from '@/components/glass';

import { canGoIntoPlaylist, star, unstar, type Song, type StarType } from '@/api/data';
import { applyStarChange, resyncFavorites, unstarWithUndo } from '@/lib/favoritesCache';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { usePins } from '@/store/pins';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors } from '@/theme';
import { useArtistPagePalette } from '@/components/volta/ArtistPagePalette';

interface Props {
  id: string;
  type?: StarType;
  starred?: boolean;
  size?: number;
  /** Song lists only: take the favourite off behind an «Undo» toast (#98). */
  undo?: boolean;
  /** Readable ink when this button sits over the floating glass player. */
  unselectedColor?: string;
  /** Optional player presentation; defaults retain the shared heart button. */
  glyph?: 'heart' | 'star';
  selectedColor?: string;
  style?: StyleProp<ViewStyle>;
  hitSlop?: PressableProps['hitSlop'];
  /** Recycled list binding; isolates local requests and Undo callbacks. */
  resetKey?: string;
  /** Player-only opt-in: holding adds this track to a playlist; list rows keep their existing hold. */
  playlistSong?: Song;
}

export function FavoriteButton({ id, type = 'song', starred, size = 22, undo, unselectedColor,
  glyph = 'heart', selectedColor, style, hitSlop = 10, resetKey, playlistSong }: Props) {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const pagePalette = useArtistPagePalette();
  const toast = useToast((s) => s.show);
  const binding = useMemo(() => ({ id, type, resetKey }), [id, type, resetKey]);
  const favoriteBinding = useMemo(() => ({ binding, starred }), [binding, starred]);
  const playlistBinding = useMemo(() => ({ binding, song: playlistSong, auth, offline }), [binding, playlistSong, auth, offline]);
  const currentBinding = useRef<object | null>(binding);
  const currentFavorite = useRef<object | null>(favoriteBinding);
  const currentPlaylist = useRef<object | null>(playlistBinding);
  const operation = useRef(0);
  const pointer = useRef<{ binding: object; playlistBinding?: object; timestamp?: number; touch: boolean; held?: boolean } | null>(null);
  const pending = useRef<{ binding: object; serial: number } | null>(null);
  const [favorite, setFavorite] = useState({ binding: favoriteBinding, value: !!starred });
  const [waiting, setWaiting] = useState({ binding, value: false });
  const fav = favorite.binding === favoriteBinding ? favorite.value : !!starred;
  const busy = waiting.binding === binding && waiting.value;
  const canHold = type === 'song' && playlistSong?.id === id && canGoIntoPlaylist(playlistSong);
  const trackPointer = resetKey !== undefined || canHold;

  // Binding-derived state resets in the first render of a recycled item.
  // Committed ownership guards asynchronous callbacks, including A -> B -> A.
  useLayoutEffect(() => {
    currentBinding.current = binding;
    currentFavorite.current = favoriteBinding;
    return () => {
      currentBinding.current = null;
      currentFavorite.current = null;
    };
  }, [binding, favoriteBinding]);
  useLayoutEffect(() => {
    currentPlaylist.current = playlistBinding;
    return () => { currentPlaylist.current = null; };
  }, [playlistBinding]);

  function releasePointer(event: GestureResponderEvent) {
    if (currentBinding.current !== binding) return;
    const pressed = pointer.current;
    if (!pressed || (pressed.timestamp !== undefined && event.nativeEvent.timestamp < pressed.timestamp)) return;
    // Keep the touch owner through the synchronous onPress that follows a
    // release; a delayed old event must not expire a newer touch transaction.
    queueMicrotask(() => { if (pointer.current === pressed) pointer.current = null; });
  }

  async function toggle(e?: GestureResponderEvent) {
    e?.stopPropagation();
    if (currentBinding.current !== binding) return;
    const pressed = pointer.current;
    if (trackPointer && pressed?.timestamp !== undefined && e?.nativeEvent.timestamp !== undefined
      && e.nativeEvent.timestamp < pressed.timestamp) return;
    pointer.current = null;
    if (pressed?.held || trackPointer && pressed && pressed.binding !== binding) return;
    if ((!auth && !offline) || busy
      || pending.current?.binding === binding) return;
    const serial = ++operation.current;
    const setFav = (value: boolean) => {
      if (currentBinding.current === binding && currentFavorite.current === favoriteBinding
        && operation.current === serial) setFavorite({ binding: favoriteBinding, value });
    };
    const setBusy = (value: boolean) => {
      if (currentBinding.current === binding && operation.current === serial) setWaiting({ binding, value });
    };
    haptic('medium');
    // In a song list the heart is small and sits where a finger scrolls, so
    // taking a favourite off waits behind «Undo» and nothing is asked of the
    // server until the toast goes. On the player, an artist or an album it is
    // a deliberate tap on a screen about that one thing: it goes out at once.
    if (fav && undo) {
      setFav(false);
      unstarWithUndo(type, id, () => setFav(true));
      return;
    }
    const nextFav = !fav;
    setFav(nextFav); // optimistic update
    setBusy(true);
    const request = { binding, serial };
    pending.current = request;
    try {
      if (nextFav) await star(id, type);
      else await unstar(id, type);
      // Only the id is known here, so removing is exact and adding leaves the
      // list to refresh when something needs it (see `favoritesCache`).
      applyStarChange(type, id, nextFav);
      // Albums are only listed as favourites, so the pin would outlive the row.
      if (!nextFav && type === 'album') usePins.getState().unpin(`album:${id}`);
      toast(nextFav ? t('Added to favorites') : t('Removed from favorites'));
    } catch {
      setFav(!nextFav); // revert on failure
      resyncFavorites();
      toast(t("Couldn't complete the action"));
    } finally {
      if (pending.current === request) pending.current = null;
      setBusy(false);
    }
  }

  function held(event: GestureResponderEvent) {
    event.stopPropagation();
    if (!canHold || !playlistSong || (!auth && !offline)
      || currentBinding.current !== binding || currentPlaylist.current !== playlistBinding) return;
    const pressed = pointer.current;
    if (pressed && (pressed.binding !== binding || pressed.playlistBinding !== playlistBinding
      || pressed.held || pressed.timestamp !== undefined && event.nativeEvent.timestamp < pressed.timestamp)) return;
    // Pressability normally consumes the release after a long press. Keep the
    // accepted touch marked too, so a queued release cannot toggle a favorite.
    if (pressed) pressed.held = true;
    else pointer.current = { binding, playlistBinding, timestamp: event.nativeEvent.timestamp, touch: false, held: true };
    haptic('medium');
    usePlaylistPicker.getState().open([playlistSong]);
  }

  return (
    <GlassPressable
      hitSlop={hitSlop}
      style={style}
      // PressIn also fires when one finger reenters the press rect. Only a
      // native touch-down may replace the owner of a recycled cell's touch.
      onTouchStart={!trackPointer ? undefined : (event) => {
        if (currentBinding.current !== binding) return;
        const timestamp = event.nativeEvent.timestamp;
        if (pointer.current?.timestamp !== undefined && timestamp < pointer.current.timestamp) return;
        pointer.current = { binding, playlistBinding, timestamp, touch: true };
      }}
      onTouchEnd={!trackPointer ? undefined : releasePointer}
      onTouchCancel={!trackPointer ? undefined : releasePointer}
      onPressIn={!trackPointer ? undefined : (event) => {
        if (currentBinding.current !== binding || pointer.current) return;
        pointer.current = { binding, playlistBinding, timestamp: event.nativeEvent.timestamp, touch: false };
      }}
      onPressOut={!trackPointer ? undefined : (event) => {
        if (!pointer.current?.touch) releasePointer(event);
      }}
      onPress={toggle}
      onLongPress={canHold ? held : undefined}
      accessibilityRole="button"
      accessibilityLabel={fav ? t('Remove from favorites') : t('Add to favorites')}
    >
      <Icon
        name={fav ? glyph : glyph === 'star' ? 'star-outline' : 'heart-outline'}
        size={size}
        color={fav ? selectedColor ?? pagePalette?.accent ?? colors.accent
          : unselectedColor ?? pagePalette?.textSecondary ?? colors.textSecondary}
      />
    </GlassPressable>
  );
}
