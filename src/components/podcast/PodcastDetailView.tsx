/** Podcast content in the same prepared cover/colour scene as Primuse albums. */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useComposedEventHandler, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { LinearGradient } from 'expo-linear-gradient';

import type { PodcastChannel, PodcastEpisode } from '@/api/podcasts';
import { BackChevron } from '@/components/BackChevron';
import { DetailHeroScene } from '@/components/DetailHeroScene';
import { PrimuseAlbumHeader } from '@/components/primuse/PrimuseAlbumHeader';
import { PrimuseAlbumBackdrop } from '@/components/primuse/PrimuseAlbumBackdrop';
import { PrimuseAlbumScene } from '@/components/primuse/PrimuseAlbumScene';
import { ArtistPagePaletteProvider } from '@/components/volta/ArtistPagePalette';
import { usePrimuseAlbumPalette } from '@/hooks/usePrimuseAlbumPalette';
import { usePodcastArtwork } from '@/hooks/usePodcastArtwork';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { episodesLabel, useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { artistHeaderFromLayout } from '@/lib/artistHeaderTransition';
import { listPerf } from '@/lib/listPerf';
import { primuseAlbumLayout } from '@/lib/primuseAlbumLayout';
import type { PrimuseAlbumPalette } from '@/lib/primuseAlbumPalette';
import { spacing } from '@/theme';

interface Props {
  channel: PodcastChannel; episodes: PodcastEpisode[]; offline: boolean; refreshing: boolean; onRefresh(): void;
  actions(palette: PrimuseAlbumPalette): ReactNode;
  toolbar(palette: PrimuseAlbumPalette): ReactNode;
  filters(palette: PrimuseAlbumPalette): ReactNode;
  renderEpisode(episode: PodcastEpisode, index: number, palette: PrimuseAlbumPalette): ReactNode;
  empty: ReactNode;
  onEndReached?: () => void;
  footer?: ReactNode;
  /** Metadata may still be refreshing while the usable show shell is visible. */
  loadingMeta?: boolean;
  /** Reset user-driven paging when a show, account, order or filter changes. */
  pagingIdentity?: string;
  /** A directory handoff keeps this identity when its real feed ID arrives. */
  presentationIdentity?: string;
  /** The catalogue photograph the user opened, independent of episode refresh. */
  initialArtworkUri?: string;
}
export function PodcastDetailView({ channel, episodes, offline, refreshing, onRefresh, actions, toolbar, filters,
  renderEpisode, empty, onEndReached, footer, loadingMeta = false, pagingIdentity, presentationIdentity, initialArtworkUri }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets(), { width, height } = useScreenSize(), { fontScale } = useWindowDimensions();
  const language = useSettings((state) => state.language), focused = useIsFocused();
  const bottom = useScreenBottomPadding(), side = centredPadding(width, spacing.lg);
  const layout = useMemo(() => primuseAlbumLayout(width, height, insets.top, side, fontScale), [width, height, insets.top, side, fontScale]);
  const visualScope = presentationIdentity ?? channel.id;
  const selectedArtwork = usePodcastArtwork(channel, visualScope, offline, initialArtworkUri);
  // These are already validated image URIs/cache-only keys. Sending a cache
  // marker through the music-server cover-ID resolver would rewrite its key.
  const uri = selectedArtwork.uri;
  const identity = `podcast:${visualScope}:${uri ?? ''}`;
  const artwork = usePrimuseAlbumPalette(uri, offline, layout.blurRatio), palette = artwork.palette;
  const artworkError = artwork.onArtworkError, failSelection = selectedArtwork.onError;
  const onArtworkError = useCallback((failedUri?: string) => {
    if (failedUri !== undefined && failedUri !== uri) return;
    artworkError(failedUri); failSelection();
  }, [uri, artworkError, failSelection]);
  const artworkRequest = useMemo(() => ({ identity }), [identity]);
  const [shownArtwork, setShownArtwork] = useState(() => ({ request: artworkRequest, ready: false }));
  if (shownArtwork.request !== artworkRequest) setShownArtwork({ request: artworkRequest, ready: false });
  const onArtworkReady = useCallback((ready: boolean) => {
    setShownArtwork((before) => before.request === artworkRequest && before.ready !== ready ? { request: artworkRequest, ready } : before);
  }, [artworkRequest]);
  const artworkStyle = { opacity: shownArtwork.request === artworkRequest && shownArtwork.ready ? 1 : 0 };
  const [measured, setMeasured] = useState({ height: 0, coverCenterY: layout.coverCenterY });
  const scroll = useSharedValue(0), name = useSharedValue({ y: 0, height: 0 });
  const transition = useDerivedValue(() => artistHeaderFromLayout(scroll.get(), insets.top + 52, name.get(), width, 0, 0));
  const largeName = useAnimatedStyle(() => ({ opacity: transition.get().largeOpacity }));
  const compactName = useAnimatedStyle(() => ({ opacity: transition.get().compactOpacity }));
  const barBackground = useAnimatedStyle(() => ({ opacity: transition.get().backgroundOpacity }));
  const pagingScope = pagingIdentity ?? channel.id;
  const pagingRequest = useMemo(() => ({ scope: pagingScope }), [pagingScope]);
  const paging = useRef({ request: pagingRequest, dragged: false, pending: false }), endReached = useRef(onEndReached);
  useLayoutEffect(() => {
    if (paging.current.request !== pagingRequest) paging.current = { request: pagingRequest, dragged: false, pending: false };
    endReached.current = onEndReached;
  }, [pagingRequest, onEndReached]);
  const nextPage = useCallback(() => {
    const current = paging.current;
    if (current.request !== pagingRequest || !endReached.current) return;
    if (!current.dragged) { current.pending = true; return; }
    endReached.current();
  }, [pagingRequest]);
  const markDragged = useCallback(() => {
    const current = paging.current;
    if (current.request !== pagingRequest || current.dragged) return;
    current.dragged = true;
    if (current.pending) { current.pending = false; endReached.current?.(); }
  }, [pagingRequest]);
  // Keep every native scroll event in the same composed header/dock handler.
  // FlatList can report "end" on initial layout; it must not consume every
  // page before a real drag has happened.
  const headerScroll = useAnimatedScrollHandler({
    onBeginDrag: () => { scheduleOnRN(markDragged); },
    onScroll: (event) => { scroll.set(event.contentOffset.y); },
  });
  const dock = useLiquidDockScrollHandler(), onScroll = useComposedEventHandler([headerScroll, dock]);
  return <ArtistPagePaletteProvider value={palette}>
    {focused ? <><StatusBar style="light" /><NavigationBar style="light" /></> : null}
    <DetailHeroScene enabled={false} identity={identity} loadingColor={palette.backgroundTop} loadingTint={palette.text}
      background={<LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill}
        colors={[palette.backgroundTop, palette.backgroundTop, palette.background]} locations={[0, .42, 1]} />}>
      <PrimuseAlbumScene enabled uri={uri} textureUri={artwork.textureUri} prepared={artwork.ready && measured.height > 0}
        onReadyChange={onArtworkReady}>
        <View testID="podcast-detail-artwork-field" pointerEvents="none" style={[StyleSheet.absoluteFill, artworkStyle]}>
          <PrimuseAlbumBackdrop textureUri={artwork.textureUri} textureScale={artwork.textureScale} textureRevision={artwork.textureRevision}
            onTextureError={artwork.onTextureError} width={width} height={measured.height}
            layout={{ ...layout, coverCenterY: measured.coverCenterY }} scrollY={scroll} />
        </View>
        <Animated.FlatList {...listPerf} initialNumToRender={7} data={episodes} keyExtractor={(episode) => episode.id}
          onEndReached={nextPage} onEndReachedThreshold={.5}
          onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: side, paddingBottom: bottom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.text} progressViewOffset={insets.top + 52} />}
          ListHeaderComponent={<>
            <PrimuseAlbumHeader title={channel.title} subtitle={channel.author} meta={loadingMeta ? t('Loading…') : episodesLabel(channel.episodeCount ?? episodes.length, language)}
              coverUri={uri} description={channel.description} layout={layout} palette={palette} disabled={false}
              showPause={false} shuffleActive={false} onPlay={() => {}} onShuffle={() => {}} actions={actions(palette)}
              onArtworkLoad={artwork.onArtworkLoad} onArtworkError={onArtworkError} nameStyle={largeName} artworkStyle={artworkStyle}
              onTitleLayout={(value) => { name.set(value); }}
              onCoverCenterY={(coverCenterY) => setMeasured((before) => Math.abs(before.coverCenterY - coverCenterY) < .5 ? before : { ...before, coverCenterY })}
              onLayout={(event) => { const h = event.nativeEvent.layout.height; if (h > 0) setMeasured((before) => Math.abs(before.height - h) < .5 ? before : { ...before, height: h }); }} />
            {filters(palette)}
          </>}
          renderItem={({ item, index }) => <>{renderEpisode(item, index, palette)}</>}
          ListEmptyComponent={<>{empty}</>} ListFooterComponent={footer == null ? undefined : <>{footer}</>} />
        <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top, height: insets.top + 52, paddingHorizontal: side }]}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.backgroundTop }, barBackground]} />
          <BackChevron size={28} color={palette.text} style={[styles.back, { backgroundColor: palette.controlFill }]} />
          <Animated.Text numberOfLines={1} style={[styles.compactTitle, { color: palette.text }, compactName]}>{channel.title}</Animated.Text>
          <View style={[styles.toolbar, { backgroundColor: palette.controlFill }]}>{toolbar(palette)}</View>
        </View>
      </PrimuseAlbumScene>
    </DetailHeroScene>
  </ArtistPagePaletteProvider>;
}
const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  compactTitle: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', borderRadius: 24 },
});
