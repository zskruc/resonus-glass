import Icon from '@/components/Icon';
import { FloatingGlassBackdrop, GlassBackdrop } from '@/components/glass';
import { useForegroundEffect } from '@/hooks/useForegroundEffect';
import { useT } from '@/i18n';
import { useGlassTuning, type GlassTarget } from '@/store/glassTuning';
import { useSettings } from '@/store/settings';
import { useTheme, useThemeMode } from '@/theme';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const ALBUM_COLORS = ['#EE6456', '#648AE8', '#EDBE52', '#7FCBA4', '#BA86D9', '#DB85AD'];
const PREVIEW_RANGE = 450;

/** The same native backdrop as the app, with moving content behind its lens. */
export function GlassTuningPreview({ target }: { target: GlassTarget }) {
  const t = useT();
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const mode = useGlassTuning((state) => state.mode);
  const blurMiniPlayer = useSettings((state) => state.blurMiniPlayer);
  const blurBars = useSettings((state) => state.blurBars);
  const scroll = useRef<ScrollView>(null);
  const position = useRef(0);
  const direction = useRef(1);
  const dragging = useRef(false);
  const [moving, setMoving] = useState(false);
  useForegroundEffect(useCallback(() => {
    if (!moving) return;
    let frame = 0;
    let previous = 0;
    const tick = (time: number) => {
      if (previous && !dragging.current) {
        // A slow 32 dp/s sweep reveals edge refraction without distracting motion.
        position.current += Math.min(time - previous, 50) * 0.032 * direction.current;
        if (position.current >= PREVIEW_RANGE || position.current <= 0) {
          position.current = Math.max(0, Math.min(PREVIEW_RANGE, position.current));
          direction.current *= -1;
        }
        scroll.current?.scrollTo({ y: position.current, animated: false });
      }
      previous = time;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving]));

  const ink = dark ? '#FFFFFF' : '#111318';
  const miniInk = dark ? '#FFFFFF' : '#111113';
  const secondary = dark ? '#E3E5ED' : '#323845';
  const tabs = [
    { icon: 'home-outline' as const, label: t('Home') },
    { icon: 'compass-outline' as const, label: t('Explore') },
    { icon: 'library-outline' as const, label: t('Your library') },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.captionRow}>
        <Text style={[styles.caption, { color: colors.textSecondary }]}>{t('Live glass preview · sample content')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: moving }}
          onPress={() => setMoving((value) => !value)}
          style={[styles.motionButton, { backgroundColor: colors.surfaceHighlight }]}
        >
          <Icon name={moving ? 'pause' : 'play'} size={12} color={colors.text} />
          <Text style={[styles.motionLabel, { color: colors.text }]}>{t(moving ? 'Pause motion' : 'Move background')}</Text>
        </Pressable>
      </View>
      <View style={[styles.stage, { backgroundColor: dark ? '#171C2A' : '#EFF2F8' }]}>
        <ScrollView
          ref={scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.backgroundContent}
          scrollEventThrottle={16}
          onScroll={(event) => { position.current = event.nativeEvent.contentOffset.y; }}
          onScrollBeginDrag={() => { dragging.current = true; }}
          onScrollEndDrag={() => { dragging.current = false; }}
          onMomentumScrollBegin={() => { dragging.current = true; }}
          onMomentumScrollEnd={() => { dragging.current = false; }}
          accessibilityLabel={t('Drag the sample background to inspect the glass')}
        >
          {Array.from({ length: 5 }, (_, row) => (
            <View key={row} style={styles.albumRow}>
              {ALBUM_COLORS.slice((row % 2) * 3, (row % 2) * 3 + 3).map((color, column) => (
                <View key={color} style={styles.albumColumn}>
                  <View style={[styles.album, { backgroundColor: color }]}>
                    <View style={styles.disc}><View style={styles.discCenter} /></View>
                    <Text style={styles.albumLetter}>{String.fromCharCode(65 + row * 3 + column)}</Text>
                    <View style={styles.fineLines}>
                      {Array.from({ length: 7 }, (_, line) => <View key={line} style={styles.fineLine} />)}
                    </View>
                  </View>
                  <Text style={[styles.albumLabel, { color: dark ? '#F5F7FC' : '#273149' }]}>{t('Sample album')} {row * 3 + column + 1}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
        <View pointerEvents="none" style={styles.overlay}>
          {target === 'controls' ? (
            <View collapsable={false} style={styles.panel}>
              <GlassBackdrop radius={16} tint={colors.surfaceHighlight} />
              <Text style={[styles.panelLabel, { color: ink }]}>{t('Sample panel')}</Text>
              <Text style={[styles.panelHint, { color: secondary }]}>{t('Other surfaces')}</Text>
            </View>
          ) : (
            <>
              <View collapsable={false} style={styles.mini}>
                <FloatingGlassBackdrop target="miniPlayer" radius={24}
                  blurred={blurMiniPlayer} />
                <View style={[styles.cover, { backgroundColor: ALBUM_COLORS[0] }]}><View style={styles.coverDisc} /></View>
                <View style={styles.trackText}>
                  <Text numberOfLines={1} style={[styles.trackTitle, { color: miniInk }]}>{t('Glass in motion')}</Text>
                </View>
                <View style={styles.transport}>
                  <View style={styles.transportButton}><Icon name="play" size={24} color={ink} /></View>
                  <View style={styles.transportButton}><Icon name="play-forward" size={28} color={ink} /></View>
                </View>
              </View>
              <View style={styles.navigationRow}>
                <View collapsable={false} style={styles.navigation}>
                  <FloatingGlassBackdrop target="navigation" radius={31} tint={colors.surface} blurred={blurBars} />
                  {tabs.map((tab, index) => (
                    <View key={tab.icon} collapsable={false} style={styles.tab}>
                      {index === 0 ? <FloatingGlassBackdrop target="navigation" appearance="selection" radius={27} blurred={blurBars} /> : null}
                      <Icon name={tab.icon} size={30} color={index === 0 ? colors.accent : ink} />
                      <Text numberOfLines={1} style={[styles.tabLabel, { color: index === 0 ? colors.accent : secondary }]}>{tab.label}</Text>
                    </View>
                  ))}
                </View>
                <View collapsable={false} style={styles.search}>
                  <FloatingGlassBackdrop target="navigation" radius={31} tint={colors.surface} blurred={blurBars} />
                  <Icon name="search-outline" size={30} color={ink} />
                  <Text numberOfLines={1} style={[styles.tabLabel, { color: secondary }]}>{t('Search')}</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
      <Text style={[styles.hint, { color: colors.textMuted }]}>{t(mode === 'kyantDefault' ? 'Kyant defaults'
        : mode === 'iphoneReference' ? 'iPhone reference' : 'Custom parameters')} · {t('Drag the background, or let it move slowly.')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 240, paddingTop: 8, paddingBottom: 4 },
  captionRow: { height: 32, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  caption: { flex: 1, fontSize: 11 },
  motionButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
  motionLabel: { fontSize: 11, fontWeight: '500' },
  stage: { flex: 1, overflow: 'hidden' },
  backgroundContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 180 },
  albumRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  albumColumn: { flex: 1 },
  album: { height: 94, borderRadius: 6, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  disc: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(16,20,34,0.84)', alignItems: 'center', justifyContent: 'center' },
  discCenter: { width: 15, height: 15, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.7)' },
  albumLetter: { position: 'absolute', left: 6, top: 3, color: '#FFFFFF', fontWeight: '700', fontSize: 26 },
  fineLines: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 3 },
  fineLine: { height: 1, backgroundColor: 'rgba(255,255,255,0.65)' },
  albumLabel: { fontSize: 11, marginTop: 4 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', paddingHorizontal: 20, gap: 8 },
  mini: { height: 48, borderRadius: 24, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cover: { width: 30, height: 30, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  coverDisc: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#232734' },
  trackText: { flex: 1 },
  trackTitle: { fontSize: 14, lineHeight: 20, includeFontPadding: false, fontWeight: '400' },
  transport: { flexDirection: 'row', gap: 8 },
  transportButton: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  navigationRow: { height: 62, flexDirection: 'row', gap: 8 },
  navigation: { flex: 1, minWidth: 0, height: 62, borderRadius: 31, flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 4 },
  search: { width: 62, height: 62, borderRadius: 31, justifyContent: 'center', alignItems: 'center', gap: 2 },
  tab: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 2, borderRadius: 27 },
  tabLabel: { fontSize: 12, lineHeight: 15, includeFontPadding: false, maxWidth: '95%' },
  panel: { alignSelf: 'stretch', height: 88, borderRadius: 16, paddingHorizontal: 20, justifyContent: 'center', gap: 8 },
  panelLabel: { fontSize: 16, fontWeight: '600' },
  panelHint: { fontSize: 12 },
  hint: { fontSize: 11, paddingHorizontal: 20, paddingTop: 5 },
});
