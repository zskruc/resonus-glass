/**
 * The progress bar and the two times under it, for the player and the lyrics
 * screen.
 *
 * A component of its own, and not markup repeated on both screens, for what it
 * has to hold: while the thumb is being dragged the numbers follow IT and not
 * the song. The left one is where you are about to land, which is the whole
 * point of dragging it, and the song goes on playing underneath — so its
 * position has to stop reaching the slider until the finger lifts, or the thumb
 * is pulled back out from under it twice a second.
 *
 * It subscribes to the position itself, which is what keeps a tick from
 * repainting the screen around it: the player is one large component (#50) and
 * the lyrics screen is following the song word by word.
 */
import { GlassSlider as Slider } from '@/components/glass';
import type { PlayerSliderComponent } from '@/components/AmllSlider';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { canApplyPlayerSeek } from '@/lib/playerSeek';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, themed, useTheme } from '@/theme';

export function SeekBar({
  duration,
  style,
  tint,
  textTint,
  mutedTrackTint,
  sliderComponent,
  active = true,
}: {
  duration: number;
  style?: StyleProp<ViewStyle>;
  /** The played part and the thumb, the text colour if not given. */
  tint?: string;
  textTint?: string;
  mutedTrackTint?: string;
  /** Player-only visual; settings and ordinary player bars retain GlassSlider. */
  sliderComponent?: PlayerSliderComponent;
  /** False while a retained player is hidden or the app is in the background. */
  active?: boolean;
}) {
  // Its own subscription to the theme: the screens around it have one, but a
  // component that reads a colour is the one that has to be told to paint again.
  useTheme();
  const t = useT();
  const positionSec = usePlayerStore((s) => s.positionSec);
  const songKey = usePlayerStore((s) => currentSong(s)?.id);
  const PlayerSlider = sliderComponent ?? Slider;
  // Null while nobody is touching it, which is when the song is in charge.
  const [held, setHeld] = useState<{ song: string; value: number } | null>(null);
  const dragSong = useRef<string | undefined>(undefined);
  const shown = active && held !== null && held.song === songKey ? held.value : positionSec;
  useLayoutEffect(() => {
    dragSong.current = undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A source/visibility handoff cancels a held position before the next frame.
    setHeld(null);
  }, [songKey, active]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        dragSong.current = undefined;
        setHeld(null);
      }
    });
    return () => subscription.remove();
  }, []);
  // Tapping the right-hand time switches it between the length and what is
  // left, and the choice is kept.
  const remaining = useSettings((s) => s.showRemainingTime);
  const setRemaining = useSettings((s) => s.setShowRemainingTime);

  return (
    <View style={style}>
      <PlayerSlider
        {...(sliderComponent ? { interactionKey: JSON.stringify([songKey, active]) } : {})}
        style={[styles.slider, Platform.OS === 'ios' && styles.sliderIos]}
        thumbSize={Platform.OS === 'ios' ? 12 : undefined}
        minimumValue={0}
        maximumValue={duration}
        value={shown}
        disabled={!active}
        // Held down without moving yet: the thumb is already the finger's, so
        // the position stops being sent to it from here on.
        onSlidingStart={() => {
          const state = usePlayerStore.getState();
          dragSong.current = canApplyPlayerSeek(songKey, currentSong(state)?.id, active, AppState.currentState === 'active')
            ? songKey : undefined;
          if (dragSong.current !== undefined) setHeld({ song: dragSong.current, value: state.positionSec });
          else setHeld(null);
        }}
        onSlidingCancel={() => { dragSong.current = undefined; setHeld(null); }}
        onValueChange={(value) => {
          const key = dragSong.current;
          if (key !== undefined && canApplyPlayerSeek(key, currentSong(usePlayerStore.getState())?.id, active, AppState.currentState === 'active')) {
            setHeld({ song: key, value });
          } else { dragSong.current = undefined; setHeld(null); }
        }}
        onSlidingComplete={(value) => {
          // Let go before the store is told, since `seekTo` writes the new
          // position straight away: there is no moment showing the old one.
          const key = dragSong.current;
          dragSong.current = undefined;
          setHeld(null);
          const state = usePlayerStore.getState();
          if (canApplyPlayerSeek(key, currentSong(state)?.id, active, AppState.currentState === 'active')) state.seekTo(value);
        }}
        activeTrackTintColor={tint}
        minimumTrackTintColor={tint ?? colors.text}
        maximumTrackTintColor={mutedTrackTint ?? colors.mediaTrack}
        thumbTintColor={tint ?? colors.text}
      />
      <View style={styles.times}>
        <Text style={[styles.time, textTint ? { color: textTint } : undefined]}>{formatDuration(shown)}</Text>
        <Pressable
          // Not upward: that is the end of the bar, which has to seek.
          hitSlop={{ top: 0, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={remaining ? t('Show total time') : t('Show remaining time')}
          onPress={() => setRemaining(!remaining)}
        >
          <Text style={[styles.time, textTint ? { color: textTint } : undefined]}>
            {remaining ? `-${formatDuration(Math.max(0, duration - shown))}` : formatDuration(duration)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed((colors) => ({
  // The visible track edge to edge of the content, like Spotify: the slider
  // brings padding of its own and the thumb extends into the gap without being
  // clipped. On iOS it pads differently and draws a fatter thumb, so there the
  // negative margin overshoots and the knob is pinned to the Android size.
  slider: { marginHorizontal: -15 },
  sliderIos: { marginHorizontal: 0 },
  // Snug against the bar: the slider brings lots of vertical space (touch area).
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: { color: colors.textTime, fontSize: fontSize.xs },
}));
