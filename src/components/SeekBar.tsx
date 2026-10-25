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
import { useState } from 'react';
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, themed, useTheme } from '@/theme';

export function SeekBar({
  duration,
  style,
  tint,
}: {
  duration: number;
  style?: StyleProp<ViewStyle>;
  /** The played part and the thumb, the text colour if not given. */
  tint?: string;
}) {
  // Its own subscription to the theme: the screens around it have one, but a
  // component that reads a colour is the one that has to be told to paint again.
  useTheme();
  const t = useT();
  const positionSec = usePlayerStore((s) => s.positionSec);
  const seekTo = usePlayerStore((s) => s.seekTo);
  // Null while nobody is touching it, which is when the song is in charge.
  const [held, setHeld] = useState<number | null>(null);
  const shown = held ?? positionSec;
  // Tapping the right-hand time switches it between the length and what is
  // left, and the choice is kept.
  const remaining = useSettings((s) => s.showRemainingTime);
  const setRemaining = useSettings((s) => s.setShowRemainingTime);

  return (
    <View style={style}>
      <Slider
        style={[styles.slider, Platform.OS === 'ios' && styles.sliderIos]}
        thumbSize={Platform.OS === 'ios' ? 12 : undefined}
        minimumValue={0}
        maximumValue={duration}
        value={shown}
        // Held down without moving yet: the thumb is already the finger's, so
        // the position stops being sent to it from here on.
        onSlidingStart={() => setHeld(positionSec)}
        onSlidingCancel={() => setHeld(null)}
        onValueChange={setHeld}
        onSlidingComplete={(value) => {
          // Let go before the store is told, since `seekTo` writes the new
          // position straight away: there is no moment showing the old one.
          setHeld(null);
          seekTo(value);
        }}
        minimumTrackTintColor={tint ?? colors.text}
        maximumTrackTintColor={colors.mediaTrack}
        thumbTintColor={tint ?? colors.text}
      />
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(shown)}</Text>
        <Pressable
          // Not upward: that is the end of the bar, which has to seek.
          hitSlop={{ top: 0, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={remaining ? t('Show total time') : t('Show remaining time')}
          onPress={() => setRemaining(!remaining)}
        >
          <Text style={styles.time}>
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
