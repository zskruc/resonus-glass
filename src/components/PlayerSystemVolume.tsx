import { GlassSlider } from '@/components/glass';
import type { PlayerSliderComponent } from '@/components/AmllSlider';
import Icon from '@/components/Icon';
import { getMediaControlsState, setSystemMusicVolume, systemMediaControlsAvailable, useMediaControls } from '@/hooks/useMediaControls';
import { useT } from '@/i18n';
import { canApplyMediaVolumeDrag, mediaVolumeLevel, mediaVolumeOutputKey } from '@/lib/mediaControls';
import { useJukebox } from '@/store/jukebox';
import { usePlayerStore } from '@/store/player';
import { useUpnp } from '@/store/upnp';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Text, View, type StyleProp, type ViewStyle } from 'react-native';

function currentOutputKey(): string {
  const upnp = useUpnp.getState();
  const jukebox = useJukebox.getState();
  const route = getMediaControlsState();
  return mediaVolumeOutputKey(upnp.connected ? 'upnp' : jukebox.active ? 'jukebox' : null,
    upnp.connected ? upnp.deviceId : null, route.routeKind, route.routeName, route.routeId);
}

/**
 * AM++-style output volume row, using the existing Kyant catalog slider.
 * Local playback writes STREAM_MUSIC; remote playback writes only Resonus's
 * existing UPnP/Jukebox volume API. Neither path changes ReplayGain.
 */
export function PlayerSystemVolume({
  tint,
  trackTint = tint,
  style,
  active = true,
  sliderComponent,
  mutedTrackTint,
}: {
  tint: string;
  /** Only the filled track follows artwork; device icons and labels stay neutral. */
  trackTint?: string;
  style?: StyleProp<ViewStyle>;
  /** False for a retained but hidden player screen: stop native observation. */
  active?: boolean;
  sliderComponent?: PlayerSliderComponent;
  mutedTrackTint?: string;
}) {
  const t = useT();
  const state = useMediaControls(active);
  const upnp = useUpnp((s) => s.connected);
  const upnpId = useUpnp((s) => s.deviceId);
  const jukebox = useJukebox((s) => s.active);
  const remoteVolume = usePlayerStore((s) => s.volume);
  const remote = upnp || jukebox;
  const outputKey = mediaVolumeOutputKey(upnp ? 'upnp' : jukebox ? 'jukebox' : null,
    upnp ? upnpId : null, state.routeKind, state.routeName, state.routeId);
  const [held, setHeld] = useState<{ output: string; value: number } | null>(null);
  const dragOutput = useRef<string | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef<number | null>(null);
  const invalidatedDrag = useRef(false);
  const activeRef = useRef(active);

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    dragOutput.current = null;
    lastSent.current = null;
  }

  // A drag from an unplugged headset or previous remote renderer must never
  // continue onto the newly selected output. In-flight OS writes read back
  // their applied values, but no queued drag is replayed after a handoff.
  useLayoutEffect(() => {
    activeRef.current = active;
    if (dragOutput.current) invalidatedDrag.current = true;
    cancelPending();
    // A system route is an external source; cancelling here also prevents an
    // old held value from reviving when the same output is selected again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeld(null);
    return () => {
      if (dragOutput.current) invalidatedDrag.current = true;
      cancelPending();
    };
  }, [outputKey, active]);

  function rejectDrag() {
    invalidatedDrag.current = true;
    cancelPending();
    setHeld(null);
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (dragOutput.current) invalidatedDrag.current = true;
        cancelPending();
        setHeld(null);
      }
    });
    return () => sub.remove();
  }, []);

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = pending.current;
    pending.current = null;
    if (value == null || !activeRef.current || AppState.currentState !== 'active' || !dragOutput.current ||
      !canApplyMediaVolumeDrag(dragOutput.current, currentOutputKey())) return;
    const currentUpnp = useUpnp.getState().connected;
    const currentJukebox = useJukebox.getState().active;
    const current = getMediaControlsState();
    const normalized = currentUpnp || currentJukebox
      ? Math.max(0, Math.min(1, Math.round(value * 100) / 100))
      : mediaVolumeLevel(value, current.minimum, current.maximum);
    if (lastSent.current === normalized) return;
    lastSent.current = normalized;
    if (currentUpnp || currentJukebox) usePlayerStore.getState().setVolume(normalized);
    else if (current.supported && !current.fixed) void setSystemMusicVolume(normalized);
  }

  function change(value: number) {
    if (invalidatedDrag.current || !activeRef.current || AppState.currentState !== 'active' || !dragOutput.current ||
      !canApplyMediaVolumeDrag(dragOutput.current, currentOutputKey())) {
      rejectDrag();
      return;
    }
    setHeld({ output: outputKey, value });
    pending.current = value;
    // The native slider animates independently; bound system/renderer calls to
    // 25 Hz and send only changed hardware steps. Always flush the final value.
    if (!timer.current) timer.current = setTimeout(flush, 40);
  }

  if (!systemMediaControlsAvailable && !remote) return null;
  const disabled = !active || (!remote && (!state.supported || state.fixed));
  const minimum = remote ? 0 : state.minimum;
  const maximum = remote ? 1 : Math.max(state.minimum + 1, state.maximum);
  const shown = active && held?.output === outputKey ? held.value : (remote ? remoteVolume : state.level);
  const label = remote ? t('Remote volume') : t('Media volume');
  const Slider = sliderComponent ?? GlassSlider;
  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: disabled ? 0.45 : 1 }}>
        <Icon name="volume-low" size={18} color={tint} />
        <Slider
          {...(sliderComponent ? { interactionKey: JSON.stringify([outputKey, active]) } : {})}
          style={{ flex: 1, height: 44, minHeight: 44 }}
          accessibilityLabel={label}
          accessibilityHint={remote ? t('Controls the connected playback device') : t('Synchronized with the phone volume buttons')}
          minimumValue={minimum}
          maximumValue={maximum}
          step={remote ? 0.01 : 1}
          value={shown}
          disabled={disabled}
          onSlidingStart={() => {
            // Native callbacks from the preceding render cannot adopt a newly
            // selected renderer with the old output's range/value.
            if (!activeRef.current || AppState.currentState !== 'active' || !canApplyMediaVolumeDrag(outputKey, currentOutputKey())) {
              rejectDrag();
              return;
            }
            cancelPending();
            invalidatedDrag.current = false;
            dragOutput.current = outputKey;
            setHeld({ output: outputKey, value: remote ? usePlayerStore.getState().volume : getMediaControlsState().level });
          }}
          onValueChange={change}
          onSlidingCancel={rejectDrag}
          onSlidingComplete={(value) => {
            if (invalidatedDrag.current || !activeRef.current || AppState.currentState !== 'active' || !dragOutput.current ||
              !canApplyMediaVolumeDrag(dragOutput.current, currentOutputKey())) {
              rejectDrag();
              return;
            }
            pending.current = value;
            flush();
            cancelPending();
            setHeld(null);
          }}
          activeTrackTintColor={trackTint}
          minimumTrackTintColor={trackTint}
          maximumTrackTintColor={mutedTrackTint ?? (tint.startsWith('#') && tint.length === 7 ? `${tint}35` : 'rgba(128,128,128,0.22)')}
          thumbTintColor={tint}
        />
        <Icon name="volume-high" size={20} color={tint} />
      </View>
      <Text style={{ color: tint, opacity: 0.62, fontSize: 10, fontWeight: '500', textAlign: 'center', marginTop: -4 }}>
        {disabled && state.fixed && !remote ? t('Volume is controlled by the output device') : label}
      </Text>
    </View>
  );
}
