/**
 * Where the navigation bar is, for everything that has to sit above it.
 *
 * The tabs own that bar on their own three screens. With "Always show the
 * navigation bar" on, `GlobalTabBar` draws the same thing everywhere else, and
 * then the MiniPlayer, the lists and their padding all have to move up by the
 * same amount they already do inside the tabs (#96).
 *
 * Full-screen modals are the exception: the player, the queue and the lyrics
 * cover everything, and the song picker keeps its own search bar down there.
 */
import { useSegments } from 'expo-router';
import { useState } from 'react';

import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';

/** Screens that never take the bar, whatever the setting says. */
const NO_BAR = ['player', 'queue', 'lyrics', 'favorites-add', 'login'];

/** Screens that cover the MiniPlayer. `GlobalMiniPlayer` fades it out on these. */
export const NO_MINI_PLAYER = ['player', 'queue', 'lyrics', 'favorites-add'];

export function useTabBarShown(): boolean {
  const always = useSettings((s) => s.alwaysShowTabs);
  const segments = useSegments();
  const root = segments[0];
  // `undefined` is the root route resolving to the tabs on the first frame.
  const inTabs = root === '(tabs)' || root === undefined;
  if (inTabs) return true;
  return always && !NO_BAR.includes(root as string);
}

/**
 * Whether the MiniPlayer is on screen right now: something has to be playing
 * (`MiniPlayer` draws nothing without a song) and the screen has to be one
 * that doesn't cover it. Two conditions, and the bar it draws is 60 px that
 * anything floating at the bottom has to clear only while they both hold.
 */
export function useMiniPlayerShown(): boolean {
  const segments = useSegments();
  const hasSong = usePlayerStore((s) => currentSong(s) !== null);
  return hasSong && !NO_MINI_PLAYER.includes(segments[0] as string);
}

/** Visual underlay eligibility is independent of route interaction visibility. */
export function usePlayerDockUnderlay(shown: boolean): { reveal: boolean; returning: boolean } {
  const root = useSegments()[0] as string | undefined;
  const amll = useSettings((state) => state.playerPresentation === 'amll');
  const player = amll && root === 'player';
  const [previous, setPrevious] = useState({ root, shown, covered: player, underlay: false, returning: false });
  let state = previous;
  if (previous.root !== root || previous.shown !== shown) {
    const covered = player || (previous.covered && NO_MINI_PLAYER.includes(root as string));
    state = { root, shown, covered,
      underlay: player && !previous.covered ? previous.shown : covered && previous.underlay,
      returning: shown && previous.covered && !covered };
    setPrevious(state);
  }
  return { reveal: player && state.underlay, returning: state.returning };
}
