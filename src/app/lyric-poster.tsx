/** Static lyric cards: select a few lines, render an actual PNG, open system sharing. */
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, type LayoutRectangle } from 'react-native';
import Animated from 'react-native-reanimated';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { CACHED_COVER, COVER, songCoverUrl } from '@/api/data';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { SelectList, SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { toneOf, useCoverTint } from '@/hooks/useDominantColor';
import { useLyricToolSong } from '@/hooks/useLyricToolSong';
import { useLyrics } from '@/hooks/useLyrics';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { MAX_POSTER_CHARS, MAX_POSTER_LINES, posterLines, selectedPosterLines, shareCapturedPoster, type PosterStyle } from '@/lib/lyricPoster';
import { materializeLyricPoster } from '@/lib/lyricPosterExport';
import { profileScopeId } from '@/store/auth';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

/** Cached-only artwork never causes the sharing page to open a network socket. */
async function localPosterCover(uri: string | undefined): Promise<string | undefined> {
  if (!uri?.startsWith(CACHED_COVER)) return uri;
  const original = uri.slice(CACHED_COVER.length);
  const candidates = [...new Set([original, ...[COVER.full, COVER.card, COVER.thumb, 500, 300, 100]
    .map((size) => original.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, `$1${size}`))])];
  const paths = await Promise.all(candidates.map((candidate) => Image.getCachePathAsync(candidate).catch(() => null)));
  const path = paths.find(Boolean);
  return path ? path.startsWith('file://') ? path : `file://${path}` : undefined;
}

interface PosterSnapshot {
  title: string; artist: string; lines: string[]; cover?: string;
  background: string; ink: string; secondary: string;
}

const AnimatedLines = Animated.createAnimatedComponent(FlatList<string>);
const lineKey = (_line: string, index: number) => String(index);

export default function LyricPosterScreen() {
  useTheme();
  const t = useT();
  const onScroll = useLiquidDockScrollHandler();
  const bottomPadding = useScreenBottomPadding();
  const { width } = useScreenSize();
  const { song, profile } = useLyricToolSong();
  const lyrics = useLyrics(song ?? undefined);
  const rawCover = song ? songCoverUrl(song, COVER.card) : undefined;
  const [image, setImage] = useState<{ binding?: string; uri?: string; ready: boolean }>({ ready: false });
  const cover = image.binding === rawCover ? image.uri : undefined;
  const imageReady = !rawCover || image.binding === rawCover && image.ready;
  const palette = useCoverTint(cover);
  const [style, setStyle] = useState<PosterStyle>('artwork');
  const [selection, setSelection] = useState<{ source: unknown; indices: number[] }>({ source: undefined, indices: [] });
  const lines = useMemo(() => posterLines(lyrics.data), [lyrics.data]);
  const defaults = useMemo(() => {
    const chosen: number[] = [];
    for (let i = 0; i < lines.length && chosen.length < 3; i++) {
      if (selectedPosterLines(lines, [...chosen, i]).length) chosen.push(i);
    }
    return chosen;
  }, [lines]);
  const indices = selection.source === lines ? selection.indices : defaults;
  const chosen = selectedPosterLines(lines, indices);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [frozen, setFrozen] = useState<PosterSnapshot | null>(null);
  const posterRef = useRef<View>(null);
  const layout = useRef<LayoutRectangle | null>(null);
  const [laidOut, setLaidOut] = useState(false);
  const previewWidth = Math.min(380, width - spacing.lg * 2);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    void localPosterCover(rawCover).then((uri) => {
      if (current && profileScopeId() === profile) setImage({ binding: rawCover, uri, ready: !uri });
    }, () => {
      if (current && profileScopeId() === profile) setImage({ binding: rawCover, ready: true });
    });
    return () => { current = false; };
  }, [rawCover, profile]);
  const background = style === 'light' ? '#F7F7FA' : style === 'dark' ? '#17171B'
    : toneOf(palette.known ? palette.color : colors.accent, 0.16, 0.5);
  const snapshot: PosterSnapshot = frozen ?? {
    title: song?.title ?? '', artist: song?.artist ?? '', lines: chosen, cover,
    background, ink: style === 'light' ? '#17171B' : '#FFFFFF',
    secondary: style === 'light' ? '#51515A' : '#D9D9E2',
  };
  const toggle = (index: number) => {
    if (busyRef.current) return;
    const next = indices.includes(index) ? indices.filter((value) => value !== index) : [...indices, index];
    if (next.length && !selectedPosterLines(lines, next).length) {
      useToast.getState().show(t('Choose up to {lines} lines and {chars} characters.', { lines: MAX_POSTER_LINES, chars: MAX_POSTER_CHARS }));
      return;
    }
    setSelection({ source: lines, indices: next });
  };
  const share = async () => {
    if (!song || !imageReady || !laidOut || !chosen.length || busyRef.current || profileScopeId() !== profile) return;
    busyRef.current = true; setBusy(true); setFrozen(snapshot);
    const current = () => mounted.current && profileScopeId() === profile;
    try {
      // Give the immutable export snapshot a committed native layout before
      // capture. This is explicit export work, never a recurring capture loop.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const result = await shareCapturedPoster({
        current, available: Sharing.isAvailableAsync,
        capture: () => {
          const measured = layout.current;
          if (!current() || !measured?.width || !measured.height) throw new Error('Poster layout unavailable');
          return captureRef(posterRef, { format: 'png', result: 'tmpfile', width: 1080,
            height: Math.round(measured.height / measured.width * 1080), quality: 1 });
        },
        materialize: materializeLyricPoster,
        share: (uri) => Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('Lyric poster') }),
        release: releaseCapture,
      });
      if (current() && result === 'unavailable') useToast.getState().show(t('Sharing is not available on this device.'));
    } catch {
      if (current()) useToast.getState().show(t('Could not create the lyric poster. Please try again.'));
    } finally {
      busyRef.current = false;
      if (mounted.current) { setBusy(false); setFrozen(null); }
    }
  };
  return <SettingsPage title={t('Lyric poster')}>
    <AnimatedLines data={song ? lines : []} keyExtractor={lineKey}
      initialNumToRender={10} maxToRenderPerBatch={8} windowSize={5} removeClippedSubviews={false}
      onScroll={onScroll} scrollEventThrottle={16}
      contentContainerStyle={[settingsStyles.content, { paddingBottom: bottomPadding }]}
      extraData={[indices, busy]}
      ListHeaderComponent={!song ? <Text style={styles.note}>{t('Choose a song first to use lyrics tools.')}</Text> : <>
        <SelectList<PosterStyle> label={t('Poster style')} value={style} disabled={busy} onChange={setStyle}
          options={[{ value: 'artwork', label: t('Album artwork') }, { value: 'light', label: t('Light') }, { value: 'dark', label: t('Dark') }]} />
        <View style={styles.previewBox}>
          <View ref={posterRef} collapsable={false} onLayout={(event) => {
            layout.current = event.nativeEvent.layout; setLaidOut(event.nativeEvent.layout.height > 0);
          }} style={[styles.poster, { width: previewWidth, backgroundColor: snapshot.background }]}>
            {snapshot.cover ? <Image source={{ uri: snapshot.cover }} style={styles.posterCover}
              contentFit="cover" cachePolicy="memory-disk" autoplay={false} preferStatic transition={0}
              onDisplay={() => setImage((previous) => previous.binding === rawCover ? { ...previous, ready: true } : previous)}
              onError={() => setImage((previous) => previous.binding === rawCover ? { binding: rawCover, ready: true } : previous)} />
              : <View style={[styles.posterCover, styles.coverPlaceholder]}><Icon name="musical-notes" size={48} color={snapshot.secondary} /></View>}
            <View style={styles.posterLyrics}>
              {snapshot.lines.map((line, index) => <Text key={index} style={[styles.posterLine, { color: snapshot.ink }]}>{line}</Text>)}
            </View>
            <Text style={[styles.posterTitle, { color: snapshot.ink }]}>{snapshot.title}</Text>
            {snapshot.artist ? <Text style={[styles.posterArtist, { color: snapshot.secondary }]}>{snapshot.artist}</Text> : null}
            <Text style={[styles.posterBrand, { color: snapshot.secondary }]}>Resonus Glass</Text>
          </View>
        </View>
        <GlassPressable buttonMaterial={false} onPress={() => { void share(); }} accessibilityRole="button"
          disabled={busy || !imageReady || !laidOut || !chosen.length}
          style={[styles.shareButton, { backgroundColor: colors.accent }, (busy || !imageReady || !chosen.length) && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Icon name="share-outline" size={20} color={colors.onAccent} />}
          <Text style={[styles.shareText, { color: colors.onAccent }]}>{t('Create PNG and share')}</Text>
        </GlassPressable>
        <Text style={styles.note}>{t('Choose up to {lines} lines and {chars} characters.', { lines: MAX_POSTER_LINES, chars: MAX_POSTER_CHARS })}</Text>
      </>}
      ListEmptyComponent={song ? lyrics.isLoading ? <ActivityIndicator color={colors.accent} />
          : lyrics.error ? <SettingRow label={t('Retry')} onPress={() => { void lyrics.refetch(); }} />
            : <Text style={styles.note}>{t('No lyrics available for this song.')}</Text> : null}
      renderItem={({ item: line, index }) => <Pressable accessibilityRole="checkbox"
            accessibilityState={{ checked: indices.includes(index), disabled: busy }} disabled={busy} onPress={() => toggle(index)}
            style={[styles.lineChoice, indices.includes(index) && { backgroundColor: colors.surfaceHighlight }]}>
            <Icon name={indices.includes(index) ? 'checkbox' : 'square-outline'} size={22} color={indices.includes(index) ? colors.accent : colors.textMuted} />
            <Text style={styles.lineChoiceText}>{line}</Text>
          </Pressable>}
    />
  </SettingsPage>;
}

const styles = themed((palette) => ({
  note: { color: palette.textSecondary, fontSize: fontSize.sm, lineHeight: 21, marginVertical: spacing.md },
  previewBox: { alignItems: 'center', marginVertical: spacing.lg },
  poster: { padding: 24, borderRadius: 0 },
  posterCover: { width: 112, height: 112, borderRadius: 14 },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF14' },
  posterLyrics: { gap: 16, marginTop: 28, marginBottom: 30 },
  posterLine: { fontSize: 22, lineHeight: 31, fontWeight: '600' },
  posterTitle: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  posterArtist: { fontSize: 14, lineHeight: 21, marginTop: 3 },
  posterBrand: { fontSize: 10, letterSpacing: 1, marginTop: 28 },
  shareButton: { minHeight: 48, borderRadius: radius.pill, paddingHorizontal: spacing.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  shareText: { fontSize: fontSize.md, fontWeight: '600' },
  lineChoice: { minHeight: 52, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md },
  lineChoiceText: { flex: 1, color: palette.text, fontSize: fontSize.md, lineHeight: 24 },
}));
