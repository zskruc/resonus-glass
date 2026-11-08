/** Podcast content in the same prepared cover/colour scene as Primuse albums. */
import { useMemo, useState, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useComposedEventHandler, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { LinearGradient } from 'expo-linear-gradient';

import { COVER, coverArtUrl } from '@/api/data';
import { podcastCover, type PodcastChannel, type PodcastEpisode } from '@/api/podcasts';
import { BackChevron } from '@/components/BackChevron';
import { DetailHeroScene } from '@/components/DetailHeroScene';
import { PrimuseAlbumHeader } from '@/components/primuse/PrimuseAlbumHeader';
import { PrimuseAlbumBackdrop } from '@/components/primuse/PrimuseAlbumBackdrop';
import { PrimuseAlbumScene } from '@/components/primuse/PrimuseAlbumScene';
import { ArtistPagePaletteProvider } from '@/components/volta/ArtistPagePalette';
import { usePrimuseAlbumPalette } from '@/hooks/usePrimuseAlbumPalette';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { episodesLabel } from '@/i18n';
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
}
export function PodcastDetailView({ channel, episodes, offline, refreshing, onRefresh, actions, toolbar, filters, renderEpisode, empty }: Props) {
  const insets = useSafeAreaInsets(), { width, height } = useScreenSize(), { fontScale } = useWindowDimensions();
  const language = useSettings((state) => state.language), focused = useIsFocused();
  const bottom = useScreenBottomPadding(), side = centredPadding(width, spacing.lg);
  const layout = useMemo(() => primuseAlbumLayout(width, height, insets.top, side, fontScale), [width, height, insets.top, side, fontScale]);
  const uri = coverArtUrl(podcastCover(channel), COVER.card);
  const artwork = usePrimuseAlbumPalette(uri, offline, layout.blurRatio), palette = artwork.palette;
  const [measured, setMeasured] = useState({ height: 0, coverCenterY: layout.coverCenterY });
  const scroll = useSharedValue(0), name = useSharedValue({ y: 0, height: 0 });
  const transition = useDerivedValue(() => artistHeaderFromLayout(scroll.get(), insets.top + 52, name.get(), width, 0, 0));
  const largeName = useAnimatedStyle(() => ({ opacity: transition.get().largeOpacity }));
  const compactName = useAnimatedStyle(() => ({ opacity: transition.get().compactOpacity }));
  const barBackground = useAnimatedStyle(() => ({ opacity: transition.get().backgroundOpacity }));
  const headerScroll = useAnimatedScrollHandler({ onScroll: (event) => { scroll.set(event.contentOffset.y); } });
  const dock = useLiquidDockScrollHandler(), onScroll = useComposedEventHandler([headerScroll, dock]);
  return <ArtistPagePaletteProvider value={palette}>
    {focused ? <><StatusBar style="light" /><NavigationBar style="light" /></> : null}
    <DetailHeroScene identity={`podcast:${channel.id}:${uri ?? ''}`} loadingColor={palette.backgroundTop} loadingTint={palette.text}
      background={<LinearGradient pointerEvents="none" style={StyleSheet.absoluteFill}
        colors={[palette.backgroundTop, palette.backgroundTop, palette.background]} locations={[0, .42, 1]} />}>
      <PrimuseAlbumScene enabled uri={uri} textureUri={artwork.textureUri} prepared={artwork.ready && measured.height > 0}>
        <PrimuseAlbumBackdrop textureUri={artwork.textureUri} textureScale={artwork.textureScale} textureRevision={artwork.textureRevision}
          onTextureError={artwork.onTextureError} width={width} height={measured.height}
          layout={{ ...layout, coverCenterY: measured.coverCenterY }} scrollY={scroll} />
        <Animated.FlatList {...listPerf} data={episodes} keyExtractor={(episode) => episode.id}
          onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: side, paddingBottom: bottom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.text} progressViewOffset={insets.top + 52} />}
          ListHeaderComponent={<>
            <PrimuseAlbumHeader title={channel.title} subtitle={channel.author} meta={episodesLabel(channel.episodeCount ?? episodes.length, language)}
              coverUri={uri} description={channel.description} layout={layout} palette={palette} disabled={false}
              showPause={false} shuffleActive={false} onPlay={() => {}} onShuffle={() => {}} actions={actions(palette)}
              onArtworkLoad={artwork.onArtworkLoad} onArtworkError={artwork.onArtworkError} nameStyle={largeName}
              onTitleLayout={(value) => { name.set(value); }}
              onCoverCenterY={(coverCenterY) => setMeasured((before) => Math.abs(before.coverCenterY - coverCenterY) < .5 ? before : { ...before, coverCenterY })}
              onLayout={(event) => { const h = event.nativeEvent.layout.height; if (h > 0) setMeasured((before) => Math.abs(before.height - h) < .5 ? before : { ...before, height: h }); }} />
            {filters(palette)}
          </>}
          renderItem={({ item, index }) => <>{renderEpisode(item, index, palette)}</>}
          ListEmptyComponent={<>{empty}</>} />
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
