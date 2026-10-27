/**
 * A native, independently implemented player inspired by AMLL's two layouts.
 * The playback, lyrics, queue and output actions remain Resonus's own.
 */
import { useIsFocused } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation, interpolate, measure, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector } from 'react-native-gesture-handler';

import { CACHED_COVER, COVER, songCoverUrl } from '@/api/data';
import { AmllPlayerBackground } from '@/components/AmllPlayerBackground';
import { AmllSlider } from '@/components/AmllSlider';
import { AudioQualityBadge } from '@/components/AudioQualityBadge';
import { Cover } from '@/components/Cover';
import { AmllPlayerControls, AmllPlayerBottomActions, AmllPlayerFavoriteButton, AmllPlayerMoreButton } from '@/components/AmllPlayerControls';
import { SyncedLyricsView } from '@/components/LyricsCard';
import { MarqueeText } from '@/components/MarqueeText';
import { OutputSheet } from '@/components/OutputSheet';
import { PlayerAudioQualitySheet } from '@/components/PlayerAudioQualitySheet';
import { PlayerSystemVolume } from '@/components/PlayerSystemVolume';
import { SeekBar } from '@/components/SeekBar';
import { SpeedSheet } from '@/components/SpeedSheet';
import { useAmllPlayerTransition } from '@/hooks/useAmllPlayerTransition';
import { useCoverTint } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { AMLL_TOP_PADDING, amllPlayerHeaderArea, amllPlayerLayout } from '@/lib/amllPlayerLayout';
import { seekAndPlayAmllLyricLine } from '@/lib/amllLyricPlayback';
import { artistTargets } from '@/lib/artistNav';
import { formatGroupedDeviceLabel } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { buildPlayerPalette } from '@/lib/playerPalette';
import { pushOnce } from '@/lib/pushOnce';
import { useJukebox } from '@/store/jukebox';
import { useArtistPicker } from '@/store/artistPicker';
import { currentSong, useLiveInfo, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
import { useUpnp } from '@/store/upnp';
import { PlayerSurfaceClipView, isNativePlayerSurfaceClipAvailable } from '../../modules/liquid-glass';

const INK = '#FFFFFF';
const SECONDARY = 'rgba(255,255,255,0.78)';
const TRACK = 'rgba(255,255,255,0.20)';
const COVER_SPRING = { stiffness: 200, damping: 30, overshootClamping: true };

export function AmllPlayerScreen() {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const t = useT();
  const song = usePlayerStore(currentSong);
  const live = useLiveInfo(song);
  const playing = usePlayerStore((state) => state.isPlaying);
  const buffering = usePlayerStore((state) => state.isBuffering);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const toggle = usePlayerStore((state) => state.toggle);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const openMenu = useSongMenu((state) => state.open);
  const showQuality = useSettings((state) => state.showAudioQuality);
  const showVolume = useSettings((state) => state.showSystemVolume);
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
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsMounted, setLyricsMounted] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const openQuality = useRef<() => void>(() => {});
  const openSpeed = useRef<() => void>(() => {});
  const columnScroll = useRef<ScrollView>(null);
  // Fixed layout anchor for the shared artwork transition. The decoded image
  // inside it keeps one native lifetime while playback/lyrics alter its scale.
  const artworkFrameRef = useAnimatedRef<View>();
  const active = focused && foreground;
  const layout = useMemo(() => amllPlayerLayout({
    width: Math.max(1, window.width - insets.left - insets.right),
    viewportWidth: window.width,
    viewportHeight: window.height, topInset: insets.top,
    height: Math.max(1, window.height - insets.top - insets.bottom - AMLL_TOP_PADDING),
    fontScale: window.fontScale, showVolume, showQuality,
  }), [window.width, window.height, window.fontScale, insets.left, insets.right, insets.top, insets.bottom, showVolume, showQuality]);
  const headerArea = useMemo(() => amllPlayerHeaderArea(layout, showLyrics, insets.top, insets.left),
    [layout, showLyrics, insets.top, insets.left]);
  const columnOffset = useSharedValue(0);
  const lyricProgress = useSharedValue(0);
  const playbackCoverScale = useSharedValue(playing ? 1 : .85);
  const horizontal = layout.horizontal;
  const readArtwork = useCallback(() => {
    'worklet';
    if (!artworkFrameRef()) return null;
    const anchor = measure(artworkFrameRef);
    if (!anchor) return null;
    const p = lyricProgress.get();
    const expanded = layout.coverFrame.size * (horizontal ? 1 : playbackCoverScale.get());
    const size = interpolate(p, [0, 1], [expanded, layout.smallCover.size]);
    return {
      x: anchor.pageX - layout.coverFrame.x + interpolate(p, [0, 1],
        [layout.largeCover.x + (layout.coverFrame.size - expanded) / 2, layout.smallCover.x]),
      y: anchor.pageY - layout.coverFrame.y + interpolate(p, [0, 1],
        [layout.largeCover.y + (layout.coverFrame.size - expanded) / 2, layout.smallCover.y]),
      width: size, height: size, cornerRadius: interpolate(p, [0, 1], [8, horizontal ? 8 : 6]),
    };
  }, [artworkFrameRef, lyricProgress, playbackCoverScale, layout, horizontal]);
  const onColumnScroll = useAnimatedScrollHandler({
    onScroll: (event) => { columnOffset.set(event.contentOffset.y); },
  });
  const transition = useAmllPlayerTransition({ width: window.width, height: window.height, focused, enabled: active,
    headerArea, headerScrollOffset: columnOffset, readArtwork, controlsHeight: layout.fullControlsHeight,
    artworkIdentity: song?.id });
  const interactive = active && !transition.closing && transition.entryReady;
  const cover = song ? songCoverUrl(song, COVER.card) : undefined;
  const coverTint = useCoverTint(cover);
  // Read the current artwork directly: a background crossfade must never hold
  // the progress or volume color one song behind.
  const controlPalette = useMemo(() => cover && !cover.startsWith(CACHED_COVER) && coverTint.known
    ? buildPlayerPalette(coverTint.color, true) : null, [cover, coverTint.color, coverTint.known]);
  const trackTint = controlPalette?.accent ?? INK;
  const lyrics = useLyrics(song ?? undefined);
  const title = live?.title || song?.title || t('Now playing');
  const artist = live?.artist || song?.artist || t('Unknown artist');
  const liveStream = !!song?.url && !song.vod;
  const artists = useMemo(() => song && !liveStream ? artistTargets(song) : [], [song, liveStream]);
  const openArtistPicker = useArtistPicker((state) => state.open);
  const metadataBinding = useMemo(() => ({ song, interactive }), [song, interactive]);
  const currentMetadata = useRef<typeof metadataBinding | null>(metadataBinding);
  useLayoutEffect(() => {
    currentMetadata.current = metadataBinding;
    return () => { currentMetadata.current = null; };
  }, [metadataBinding]);
  const goArtist = useCallback(() => {
    if (currentMetadata.current !== metadataBinding || !interactive || !artists.length) return;
    if (artists.length > 1) openArtistPicker(artists);
    else pushOnce(`/artist/${artists[0].id}`);
  }, [metadataBinding, interactive, artists, openArtistPicker]);
  const goAlbum = useCallback(() => {
    if (currentMetadata.current !== metadataBinding || !interactive || liveStream || !song?.albumId) return;
    pushOnce(`/album/${song.albumId}`);
  }, [metadataBinding, interactive, liveStream, song]);
  const controlsActive = interactive && (!showLyrics || horizontal);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (active && !transition.closing) lyricProgress.set(withSpring(showLyrics ? 1 : 0, COVER_SPRING));
    else cancelAnimation(lyricProgress);
  }, [showLyrics, active, transition.closing, lyricProgress]);
  useEffect(() => () => cancelAnimation(lyricProgress), [lyricProgress]);
  useEffect(() => {
    if (active && !transition.closing && transition.entryReady) playbackCoverScale.set(withSpring(playing ? 1 : .85, COVER_SPRING));
    else cancelAnimation(playbackCoverScale);
  }, [playing, active, transition.closing, transition.entryReady, playbackCoverScale]);
  useEffect(() => () => cancelAnimation(playbackCoverScale), [playbackCoverScale]);
  useEffect(() => {
    columnOffset.set(0);
    columnScroll.current?.scrollTo({ y: 0, animated: false });
  }, [showLyrics, horizontal, columnOffset]);

  const coverStyle = useAnimatedStyle(() => {
    const progress = lyricProgress.value;
    const expandedSize = layout.coverFrame.size * (horizontal ? 1 : playbackCoverScale.value);
    const size = interpolate(progress, [0, 1], [expandedSize, layout.smallCover.size]);
    const scale = size / layout.largeCover.size;
    return {
      width: layout.largeCover.size,
      height: layout.largeCover.size,
      // One decoded cover changes through a compositor transform instead of
      // resizing/reloading an image or handing it between two separate views.
      transform: [
        { translateX: interpolate(progress, [0, 1], [layout.largeCover.x + (layout.coverFrame.size - expandedSize) / 2, layout.smallCover.x]) },
        { translateY: interpolate(progress, [0, 1], [layout.largeCover.y + (layout.coverFrame.size - expandedSize) / 2, layout.smallCover.y]) },
        { scale },
      ],
      borderRadius: interpolate(progress, [0, 1], [8, horizontal ? 8 : 6]) / scale,
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
  const canSpeed = (!song?.url || song?.vod) && !upnpConnected && !jukebox;
  const showMenu = useCallback(() => {
    if (!song || !interactive) return;
    openMenu(song, undefined, {
      lyrics: () => { setLyricsMounted(true); setShowLyrics(true); },
      playbackModes: true, presentation: 'card', showLyrics: !song.url, queue: true,
      devices: () => setOutputOpen(true), speed: canSpeed ? () => openSpeed.current() : undefined,
    });
  }, [song, interactive, openMenu, canSpeed]);
  const stop = useCallback(() => {
    haptic('medium');
    void usePlayerStore.getState().stopAndClear().then((undo) => {
      if (undo) useToast.getState().show(t('Playback stopped'), { label: t('Undo'), run: undo });
    });
    transition.close();
  }, [transition, t]);
  const switchLyrics = () => {
    if (!interactive) return;
    setLyricsMounted(true);
    haptic('light');
    setShowLyrics((shown) => !shown);
  };
  const closeAccessiblePlayer = () => {
    if (interactive) transition.close();
  };

  const playFromLyric = useCallback((seconds: number) => {
    seekAndPlayAmllLyricLine(song?.id, seconds, {
      read: () => {
        const state = usePlayerStore.getState();
        return { songId: currentSong(state)?.id, isPlaying: state.isPlaying,
          active: interactive, foreground: AppState.currentState === 'active' };
      },
      seekTo: (position) => usePlayerStore.getState().seekTo(position),
      resume: () => usePlayerStore.getState().toggle(),
    });
  }, [song?.id, interactive]);

  const metadata = (compact: boolean) => (
    <View style={[styles.metadataRow, !compact && !horizontal && { marginRight: -8, gap: 0 }]}>
      <View style={styles.metadataText}>
        {!liveStream && song?.albumId ? (
          <Pressable accessibilityRole="link" accessibilityLabel={title} disabled={!interactive}
            onPress={goAlbum} style={styles.metadataLink}>
            <MarqueeText text={title} enabled={marquee && active && (compact ? showLyrics : !showLyrics || horizontal)}
              style={compact ? styles.compactTitle : styles.title} />
          </Pressable>
        ) : <MarqueeText text={title} enabled={marquee && active && (compact ? showLyrics : !showLyrics || horizontal)}
          style={compact ? styles.compactTitle : styles.title} />}
        {artists.length ? (
          <Pressable accessibilityRole="link" accessibilityLabel={artist} disabled={!interactive}
            onPress={goArtist} style={styles.metadataLink}>
            <Text numberOfLines={1} style={compact ? styles.compactArtist : styles.artist}>{artist}</Text>
          </Pressable>
        ) : <Text numberOfLines={1} style={compact ? styles.compactArtist : styles.artist}>{artist}</Text>}
      </View>
      {!compact && song && !song.url ? <AmllPlayerFavoriteButton id={song.id} starred={!!song.starred} active={interactive} /> : null}
      <AmllPlayerMoreButton label={t('More options')} onPress={showMenu} active={interactive}
        viewportWidth={window.width} viewportHeight={window.height} />
    </View>
  );

  // Retain the last painted lyrics throughout dismissal and covered routes.
  // Visibility pauses their clocks; removing the mask here exposes a blank patch.
  const lyricContent = lyricsMounted ? (
    lyrics.data?.lines.length ? (lyrics.data.synced ? (
      <SyncedLyricsView key={song?.id} lines={lyrics.data.lines} large
        nested={!horizontal && layout.scrollable} appearance="amll" active={interactive && showLyrics} onLinePress={playFromLyric} focusAnchor={horizontal ? 0.42 : 0.1} />
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
    <Animated.View style={[styles.screen, transition.rootStyle]}>
      {focused ? <><StatusBar style="light" /><NavigationBar style="light" /></> : null}
      {isNativePlayerSurfaceClipAvailable ? <PlayerSurfaceClipView style={StyleSheet.absoluteFill}
        onClipHostReady={transition.onClipHostReady}>
        <AmllPlayerBackground uri={cover} active={interactive && playing} />
      </PlayerSurfaceClipView> : <AmllPlayerBackground uri={cover} active={interactive && playing} />}
      <GestureDetector gesture={transition.handleGesture}>
      <Animated.View style={[styles.safe, { paddingTop: insets.top + AMLL_TOP_PADDING, paddingBottom: insets.bottom,
        paddingLeft: insets.left + layout.padding, paddingRight: insets.right + layout.padding }, transition.contentStyle]}>
        <View pointerEvents="none" accessible={false} style={{ height: layout.headerHeight }} />
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
            <Animated.ScrollView ref={columnScroll} scrollEnabled={layout.scrollable} showsVerticalScrollIndicator={false}
              onScroll={onColumnScroll} scrollEventThrottle={16}
              bounces={false} overScrollMode="never"
              nestedScrollEnabled contentContainerStyle={{ height: layout.contentHeight }}>
              <View style={{ width: layout.leftWidth, height: layout.contentHeight }}>
                <Animated.View ref={artworkFrameRef} collapsable={false} pointerEvents="box-none" onLayout={transition.onArtworkLayout}
                  style={{ position: 'absolute', left: layout.coverFrame.x, top: layout.coverFrame.y,
                    width: layout.coverFrame.size, height: layout.coverFrame.size }} />
                <Animated.View style={[styles.cover, coverStyle, transition.artworkStyle]}>
                  <Pressable accessibilityRole="button" accessibilityLabel={showLyrics ? t('Show cover') : t('Lyrics')}
                    accessibilityActions={[{ name: 'dismiss', label: t('Close') }]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'dismiss') closeAccessiblePlayer();
                    }}
                    onAccessibilityEscape={closeAccessiblePlayer}
                    onPress={switchLyrics} onLongPress={showMenu} style={styles.coverPressable}>
                    <Cover uri={cover} size={layout.largeCover.size} transition={0}
                      contentFit={fitCover ? 'contain' : 'cover'} autoplay={interactive && playing} preferStatic={false}
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
                      style={[styles.lyrics, { left: layout.metadataInset, right: layout.metadataInset,
                        top: layout.lyricsTop, height: layout.lyricsHeight }, lyricsStyle]}>
                      {lyricContent}
                    </Animated.View>
                  </>
                ) : null}
                <Animated.View pointerEvents={horizontal || !showLyrics ? 'auto' : 'none'}
                  accessibilityElementsHidden={!horizontal && showLyrics}
                  importantForAccessibility={horizontal || !showLyrics ? 'auto' : 'no-hide-descendants'}
                  style={[styles.metadata, { left: layout.metadataInset, right: layout.metadataInset,
                    top: layout.metadataTop, height: layout.metadataHeight }, bigMetaStyle]}>
                  {metadata(false)}
                </Animated.View>
                <Animated.View pointerEvents={horizontal || !showLyrics ? 'auto' : 'none'}
                  accessibilityElementsHidden={!horizontal && showLyrics}
                  importantForAccessibility={horizontal || !showLyrics ? 'auto' : 'no-hide-descendants'}
                  style={[styles.controls, controlsStyle, transition.controlsMotionStyle]}>
                  <AmllPlayerControls width={layout.leftWidth} viewportWidth={window.width} viewportHeight={layout.referenceHeight}
                    horizontal={horizontal} fontScale={window.fontScale} playing={playing} buffering={buffering}
                    onPrevious={previous} onToggle={toggle} onNext={next} onLongPressPlay={stop}
                    showLyrics={showLyrics} onLyrics={switchLyrics} onOutput={() => setOutputOpen(true)}
                    onQueue={() => pushOnce('/queue')} outputLabel={remoteName ? `${t('Devices')}: ${remoteName}` : t('Devices')}
                    active={controlsActive}
                    progress={<SeekBar duration={durationSec || song?.duration || 0} active={controlsActive} tint={trackTint}
                      textTint={SECONDARY} mutedTrackTint={TRACK} sliderComponent={AmllSlider}
                      centerAccessory={showQuality && song
                        ? <AudioQualityBadge song={song} compact onPress={() => openQuality.current()} color={SECONDARY} /> : undefined}
                      style={{ height: layout.seekHeight }} />}
                    volume={showVolume ? <PlayerSystemVolume tint={INK} trackTint={trackTint} active={controlsActive}
                      mutedTrackTint={TRACK} sliderComponent={AmllSlider} showLabel={false}
                      style={{ height: layout.volumeHeight }} /> : undefined} />
                </Animated.View>
              </View>
            </Animated.ScrollView>
          </Animated.View>
        </View>
        {horizontal ? <AmllPlayerBottomActions horizontal width={layout.innerWidth} viewportWidth={window.width}
          viewportHeight={layout.referenceHeight} showLyrics={showLyrics}
          onLyrics={switchLyrics} onOutput={() => setOutputOpen(true)} onQueue={() => pushOnce('/queue')}
          outputLabel={remoteName ? `${t('Devices')}: ${remoteName}` : t('Devices')} active={interactive} /> : null}
      </Animated.View>
      </GestureDetector>
      <OutputSheet visible={outputOpen && focused} onClose={() => setOutputOpen(false)} />
      <SpeedSheet openRef={openSpeed} />
      <PlayerAudioQualitySheet openRef={openQuality} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1 },
  column: { position: 'absolute', top: 0 },
  cover: { position: 'absolute', top: 0, left: 0, transformOrigin: 'top left', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)',
    boxShadow: '0px 12px 24px rgba(0,0,0,0.22)' },
  coverPressable: { flex: 1 },
  metadata: { position: 'absolute', justifyContent: 'center' },
  metadataRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metadataText: { flex: 1, minWidth: 0 },
  metadataLink: { alignSelf: 'flex-start', maxWidth: '100%' },
  title: { color: INK, fontSize: 20, fontWeight: '600', lineHeight: 29.0666667, includeFontPadding: false },
  artist: { color: SECONDARY, fontSize: 20, lineHeight: 29.0666667, includeFontPadding: false },
  compactTitle: { color: INK, fontSize: 18, fontWeight: '600', lineHeight: 23 },
  compactArtist: { color: SECONDARY, fontSize: 14, lineHeight: 19 },
  lyrics: { position: 'absolute' },
  lyricsEmpty: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 4 },
  emptyText: { color: SECONDARY, fontSize: 25, fontWeight: '600', lineHeight: 34 },
  plainLyricsContent: { paddingTop: 24, paddingBottom: 48, paddingHorizontal: 4 },
  plainLyrics: { color: INK, fontSize: 34, fontWeight: '600', lineHeight: 46 },
  controls: { position: 'absolute', left: 0, right: 0 },
});
