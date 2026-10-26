/**
 * A native, independently implemented player inspired by AMLL's two layouts.
 * The playback, lyrics, queue and output actions remain Resonus's own.
 */
import { useIsFocused, useRouter } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CACHED_COVER, COVER, songCoverUrl } from '@/api/data';
import { AmllPlayerBackground } from '@/components/AmllPlayerBackground';
import { AmllSlider } from '@/components/AmllSlider';
import { AudioQualityBadge } from '@/components/AudioQualityBadge';
import { Cover } from '@/components/Cover';
import Icon from '@/components/Icon';
import { SyncedLyricsView } from '@/components/LyricsCard';
import { MarqueeText } from '@/components/MarqueeText';
import { OutputSheet } from '@/components/OutputSheet';
import { PlayerAudioQualitySheet } from '@/components/PlayerAudioQualitySheet';
import { PlayerOutputDevice } from '@/components/PlayerOutputDevice';
import { PlayerSystemVolume } from '@/components/PlayerSystemVolume';
import { SeekBar } from '@/components/SeekBar';
import { SpeedSheet } from '@/components/SpeedSheet';
import { useCoverTint } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { amllPlayerLayout } from '@/lib/amllPlayerLayout';
import { formatGroupedDeviceLabel } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { buildPlayerPalette } from '@/lib/playerPalette';
import { pushOnce } from '@/lib/pushOnce';
import { useJukebox } from '@/store/jukebox';
import { currentSong, useLiveInfo, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
import { useUpnp } from '@/store/upnp';

const INK = '#FFFFFF';
const SECONDARY = 'rgba(255,255,255,0.65)';
const TRACK = 'rgba(255,255,255,0.20)';
const COVER_SPRING = { stiffness: 200, damping: 30, overshootClamping: true };

function PlayerButton({ name, label, onPress, onLongPress, selected, size = 26, style, children }: {
  name: keyof typeof Icon.glyphMap;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={selected == null ? undefined : { selected }}
      onPress={onPress} onLongPress={onLongPress} hitSlop={4}
      style={({ pressed }) => [styles.button, selected && styles.selectedButton, style, pressed && styles.pressed]}>
      <Icon name={name} size={size} color={INK} />
      {children}
    </Pressable>
  );
}

export function AmllPlayerScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const t = useT();
  const song = usePlayerStore(currentSong);
  const live = useLiveInfo(song);
  const playing = usePlayerStore((state) => state.isPlaying);
  const buffering = usePlayerStore((state) => state.isBuffering);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const repeat = usePlayerStore((state) => state.repeat);
  const toggle = usePlayerStore((state) => state.toggle);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat);
  const openMenu = useSongMenu((state) => state.open);
  const showQuality = useSettings((state) => state.showAudioQuality);
  const showVolume = useSettings((state) => state.showSystemVolume);
  const showOutput = useSettings((state) => state.showOutputDevice);
  const paletteEnabled = useSettings((state) => state.playerArtworkPalette);
  const fitCover = useSettings((state) => state.fitCoverArt);
  const marquee = useSettings((state) => state.marqueeTitles);
  const upnpConnected = useUpnp((state) => state.connected);
  const upnpDevice = useUpnp((state) => state.connected
    ? state.devices.find((device) => device.id === state.deviceId) ?? null : null);
  const upnpDevices = useUpnp((state) => state.devices);
  const jukebox = useJukebox((state) => state.active);
  const remoteName = useMemo(() => {
    if (!upnpDevice) return jukebox ? t('Server speakers (Jukebox)') : null;
    if (!upnpDevice.isSonos) return upnpDevice.name;
    const group = upnpDevice.groupId ?? upnpDevice.id;
    return formatGroupedDeviceLabel(upnpDevices.filter((device) => device.isSonos
      && (device.groupId ?? device.id) === group).map((device) => device.name)) || upnpDevice.name;
  }, [upnpDevice, upnpDevices, jukebox, t]);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [showLyrics, setShowLyrics] = useState(true);
  const [outputOpen, setOutputOpen] = useState(false);
  const openQuality = useRef<() => void>(() => {});
  const openSpeed = useRef<() => void>(() => {});
  const columnScroll = useRef<ScrollView>(null);
  const active = focused && foreground;
  const cover = song ? songCoverUrl(song, COVER.card) : undefined;
  const coverTint = useCoverTint(cover);
  // Read the current artwork directly: a background crossfade must never hold
  // the progress, volume or play-button color one song behind.
  const controlPalette = useMemo(() => cover && !cover.startsWith(CACHED_COVER) && coverTint.known
    ? buildPlayerPalette(coverTint.color, true) : null, [cover, coverTint.color, coverTint.known]);
  const trackTint = controlPalette?.accent ?? INK;
  const buttonPalette = paletteEnabled ? controlPalette : null;
  const lyrics = useLyrics(song ?? undefined);
  const title = live?.title || song?.title || t('Now playing');
  const artist = live?.artist || song?.artist || t('Unknown artist');
  const layout = amllPlayerLayout({
    width: Math.max(1, window.width - insets.left - insets.right),
    height: Math.max(1, window.height - insets.top - insets.bottom - 8),
    fontScale: window.fontScale, showVolume, showQuality,
  });
  const lyricProgress = useSharedValue(1);
  const horizontal = layout.horizontal;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (active) lyricProgress.set(withSpring(showLyrics ? 1 : 0, COVER_SPRING));
    else {
      cancelAnimation(lyricProgress);
      lyricProgress.set(showLyrics ? 1 : 0);
    }
  }, [showLyrics, active, lyricProgress]);
  useEffect(() => () => cancelAnimation(lyricProgress), [lyricProgress]);
  useEffect(() => {
    columnScroll.current?.scrollTo({ y: 0, animated: false });
  }, [showLyrics, horizontal]);

  const coverStyle = useAnimatedStyle(() => {
    const progress = lyricProgress.value;
    const size = interpolate(progress, [0, 1], [layout.largeCover.size, layout.smallCover.size]);
    const scale = size / layout.largeCover.size;
    return {
      width: layout.largeCover.size,
      height: layout.largeCover.size,
      // One decoded cover changes through a compositor transform instead of
      // resizing/reloading an image or handing it between two separate views.
      transform: [
        { translateX: interpolate(progress, [0, 1], [layout.largeCover.x, layout.smallCover.x]) },
        { translateY: interpolate(progress, [0, 1], [layout.largeCover.y, layout.smallCover.y]) },
        { scale },
      ],
      borderRadius: interpolate(progress, [0, 1], [18, horizontal ? 18 : 12]) / scale,
    };
  });
  const leftStyle = useAnimatedStyle(() => ({
    left: horizontal ? interpolate(lyricProgress.value, [0, 1], [layout.centeredColumnLeft, 0]) : 0,
  }));
  const compactMetaStyle = useAnimatedStyle(() => ({ opacity: lyricProgress.value }));
  const bigMetaStyle = useAnimatedStyle(() => ({ opacity: horizontal ? 1 : 1 - lyricProgress.value }));
  const lyricsStyle = useAnimatedStyle(() => ({
    opacity: lyricProgress.value,
    transform: [{ translateY: (1 - lyricProgress.value) * 24 }],
  }));
  const controlsStyle = useAnimatedStyle(() => ({
    top: layout.controlsTop,
    opacity: horizontal ? 1 : 1 - lyricProgress.value,
  }));
  const transportStyle = useAnimatedStyle(() => ({
    height: horizontal ? 52 : interpolate(lyricProgress.value, [0, 1], [76, 52]),
  }));
  const canSpeed = (!song?.url || song?.vod) && !upnpConnected && !jukebox;
  const showMenu = useCallback(() => {
    if (!song) return;
    openMenu(song, undefined, {
      presentation: 'card', showLyrics: !song.url, queue: true,
      devices: () => setOutputOpen(true), speed: canSpeed ? () => openSpeed.current() : undefined,
    });
  }, [song, openMenu, canSpeed]);
  const stop = useCallback(() => {
    haptic('medium');
    void usePlayerStore.getState().stopAndClear().then((undo) => {
      if (undo) useToast.getState().show(t('Playback stopped'), { label: t('Undo'), run: undo });
    });
    router.back();
  }, [router, t]);
  const switchLyrics = () => {
    haptic('light');
    setShowLyrics((shown) => !shown);
  };

  const metadata = (compact: boolean) => (
    <View style={styles.metadataRow}>
      <View style={styles.metadataText}>
        <MarqueeText text={title} enabled={marquee && active && (compact ? showLyrics : !showLyrics || horizontal)}
          style={compact ? styles.compactTitle : styles.title} />
        <Text numberOfLines={1} style={compact ? styles.compactArtist : styles.artist}>{artist}</Text>
      </View>
      <PlayerButton name="ellipsis-horizontal" label={t('More options')} onPress={showMenu} size={24} />
    </View>
  );

  const lyricContent = active && showLyrics ? (
    lyrics.data?.lines.length ? (lyrics.data.synced ? (
      <SyncedLyricsView key={song?.id} lines={lyrics.data.lines} large
        nested={!horizontal && layout.scrollable} appearance="amll" focusAnchor={horizontal ? 0.42 : 0.1} />
    ) : (
      <ScrollView key={song?.id} nestedScrollEnabled showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.plainLyricsContent}>
        <Text style={styles.plainLyrics}>{lyrics.data.lines.map((line) => line.value).join('\n')}</Text>
      </ScrollView>
    )) : (
      <View style={styles.lyricsEmpty}>
        {song && !song.url && lyrics.isPending ? <ActivityIndicator color={SECONDARY} />
          : <Text style={styles.emptyText}>{t('No lyrics available for this song.')}</Text>}
      </View>
    )
  ) : null;

  return (
    <View style={styles.screen}>
      {focused ? <><StatusBar style="light" /><NavigationBar style="light" /></> : null}
      <AmllPlayerBackground uri={cover} active={active && playing} />
      <View style={[styles.safe, { paddingTop: insets.top + 8, paddingBottom: insets.bottom,
        paddingLeft: insets.left + layout.padding, paddingRight: insets.right + layout.padding }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => router.back()}
          style={[styles.handleButton, { height: layout.headerHeight }]} hitSlop={{ top: 8, bottom: 8 }}>
          <View style={styles.handle} />
        </Pressable>
        <View style={{ width: layout.innerWidth, height: layout.viewportHeight }}>
          {horizontal ? (
            <Animated.View pointerEvents={showLyrics ? 'auto' : 'none'}
              accessibilityElementsHidden={!showLyrics} importantForAccessibility={showLyrics ? 'auto' : 'no-hide-descendants'}
              style={[styles.lyrics, { left: layout.leftWidth + 18, top: 0,
                width: Math.max(1, layout.innerWidth - layout.leftWidth - 18), height: layout.lyricsHeight }, lyricsStyle]}>
              {lyricContent}
            </Animated.View>
          ) : null}
          <Animated.View style={[styles.column, { width: layout.leftWidth, height: layout.viewportHeight }, leftStyle]}>
            <ScrollView ref={columnScroll} scrollEnabled={layout.scrollable} showsVerticalScrollIndicator={false}
              bounces={false} overScrollMode="never"
              nestedScrollEnabled contentContainerStyle={{ height: layout.contentHeight }}>
              <View style={{ width: layout.leftWidth, height: layout.contentHeight }}>
                <Animated.View style={[styles.cover, coverStyle]}>
                  <Pressable accessibilityRole="button" accessibilityLabel={showLyrics ? t('Show cover') : t('Lyrics')}
                    onPress={switchLyrics} onLongPress={showMenu} style={styles.coverPressable}>
                    <Cover uri={cover} size={layout.largeCover.size} transition={0}
                      contentFit={fitCover ? 'contain' : 'cover'} autoplay={active && playing}
                      style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                  </Pressable>
                </Animated.View>
                {!horizontal ? (
                  <>
                    <Animated.View pointerEvents={showLyrics ? 'auto' : 'none'}
                      accessibilityElementsHidden={!showLyrics} importantForAccessibility={showLyrics ? 'auto' : 'no-hide-descendants'}
                      style={[styles.metadata, { left: layout.smallCover.x + layout.smallCover.size + 16,
                        right: 0, top: layout.smallCover.y, height: layout.compactMetadataHeight }, compactMetaStyle]}>
                      {metadata(true)}
                    </Animated.View>
                    <Animated.View pointerEvents={showLyrics ? 'auto' : 'none'}
                      accessibilityElementsHidden={!showLyrics} importantForAccessibility={showLyrics ? 'auto' : 'no-hide-descendants'}
                      style={[styles.lyrics, { left: 0, right: 0, top: layout.lyricsTop, height: layout.lyricsHeight }, lyricsStyle]}>
                      {lyricContent}
                    </Animated.View>
                  </>
                ) : null}
                <Animated.View pointerEvents={horizontal || !showLyrics ? 'auto' : 'none'}
                  accessibilityElementsHidden={!horizontal && showLyrics}
                  importantForAccessibility={horizontal || !showLyrics ? 'auto' : 'no-hide-descendants'}
                  style={[styles.metadata, { left: 0, right: 0, top: layout.metadataTop, height: layout.metadataHeight }, bigMetaStyle]}>
                  {metadata(false)}
                </Animated.View>
                <Animated.View pointerEvents={horizontal || !showLyrics ? 'auto' : 'none'}
                  accessibilityElementsHidden={!horizontal && showLyrics}
                  importantForAccessibility={horizontal || !showLyrics ? 'auto' : 'no-hide-descendants'}
                  style={[styles.controls, controlsStyle]}>
                  {showQuality && song ? (
                    <View style={{ height: layout.qualityHeight, alignItems: 'center', justifyContent: 'center' }}>
                      <AudioQualityBadge song={song} onPress={() => openQuality.current()} color={SECONDARY} />
                    </View>
                  ) : null}
                  <SeekBar duration={durationSec || song?.duration || 0} active={active} tint={trackTint} textTint={SECONDARY}
                    mutedTrackTint={TRACK} sliderComponent={AmllSlider} style={{ height: layout.seekHeight }} />
                  <Animated.View style={[styles.transport, transportStyle]}>
                    <PlayerButton name="shuffle" label={t('Shuffle')} onPress={toggleShuffle} selected={shuffle} size={22} />
                    <PlayerButton name="play-skip-back" label={t('Previous')} onPress={previous} size={28} />
                    <Pressable accessibilityRole="button" accessibilityLabel={playing ? t('Pause') : t('Play')}
                      onPress={toggle} onLongPress={stop} hitSlop={6}
                      style={({ pressed }) => [styles.playButton, buttonPalette && { backgroundColor: buttonPalette.accent }, pressed && styles.pressed]}>
                      {buffering ? <ActivityIndicator size="small" color={buttonPalette?.onAccent ?? INK} />
                        : <Icon name={playing ? 'pause' : 'play'} size={34} color={buttonPalette?.onAccent ?? INK}
                          style={!playing ? { marginLeft: 3 } : undefined} />}
                    </Pressable>
                    <PlayerButton name="play-skip-forward" label={t('Next')} onPress={next} size={28} />
                    <PlayerButton name="repeat" label={t('Repeat')} onPress={cycleRepeat} selected={repeat !== 'off'} size={23}>
                      {repeat === 'one' ? <Text style={styles.repeatOne}>1</Text> : null}
                    </PlayerButton>
                  </Animated.View>
                  {showVolume ? <PlayerSystemVolume tint={INK} trackTint={trackTint} active={active}
                    mutedTrackTint={TRACK} sliderComponent={AmllSlider} style={{ height: layout.volumeHeight }} /> : null}
                </Animated.View>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
        <View style={[styles.footer, { height: layout.footerHeight }]}>
          <PlayerButton name="chatbubble-outline" label={showLyrics ? t('Show cover') : t('Lyrics')}
            onPress={switchLyrics} selected={showLyrics} size={24} />
          {showOutput ? <PlayerOutputDevice tint={INK} activeTint={INK} remoteName={remoteName}
            active={active} onPress={() => setOutputOpen(true)} style={styles.output} />
            : <PlayerButton name="radio-outline" label={t('Devices')} onPress={() => setOutputOpen(true)} />}
          <PlayerButton name="list-outline" label={t('View queue')} onPress={() => pushOnce('/queue')} />
        </View>
      </View>
      <OutputSheet visible={outputOpen && focused} onClose={() => setOutputOpen(false)} />
      <SpeedSheet openRef={openSpeed} />
      <PlayerAudioQualitySheet openRef={openQuality} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#25252D' },
  safe: { flex: 1 },
  handleButton: { alignItems: 'center', justifyContent: 'flex-start' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.42)' },
  column: { position: 'absolute', top: 0 },
  cover: { position: 'absolute', top: 0, left: 0, transformOrigin: 'top left', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)',
    boxShadow: '0px 12px 24px rgba(0,0,0,0.22)' },
  coverPressable: { flex: 1 },
  metadata: { position: 'absolute', justifyContent: 'center' },
  metadataRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metadataText: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: INK, fontSize: 24, fontWeight: '600', lineHeight: 29 },
  artist: { color: SECONDARY, fontSize: 18, lineHeight: 23 },
  compactTitle: { color: INK, fontSize: 18, fontWeight: '600', lineHeight: 23 },
  compactArtist: { color: SECONDARY, fontSize: 14, lineHeight: 19 },
  lyrics: { position: 'absolute' },
  lyricsEmpty: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 4 },
  emptyText: { color: SECONDARY, fontSize: 25, fontWeight: '600', lineHeight: 34 },
  plainLyricsContent: { paddingTop: 24, paddingBottom: 48, paddingHorizontal: 4 },
  plainLyrics: { color: INK, fontSize: 34, fontWeight: '600', lineHeight: 46 },
  controls: { position: 'absolute', left: 0, right: 0, paddingBottom: 8 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  selectedButton: { backgroundColor: 'rgba(255,255,255,0.14)' },
  pressed: { opacity: 0.55 },
  playButton: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  repeatOne: { position: 'absolute', color: INK, fontSize: 9, fontWeight: '700', top: 17, left: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  output: { minWidth: 44, maxWidth: '55%', flexShrink: 1 },
});
