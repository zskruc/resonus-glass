import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { GlassSurface } from '@/components/glass';
import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { themed, useTheme } from '@/theme';

interface Props {
  era: string;
  year?: number;
  count: number;
  fraction: number;
  covers: readonly { id: string; uri: string | undefined }[];
  downloaded: boolean;
  cacheStaticDecoration?: boolean;
}

/** The browse frame beneath these cards is a single solid theme colour. */
export const AlbumEraCard = memo(function AlbumEraCard({ era, year, count, fraction, covers, downloaded, cacheStaticDecoration = false }: Props) {
  const colors = useTheme(), t = useT();
  return <Pressable accessibilityRole="button" onPress={() => router.push({
    pathname: `/album-years/${era}`, params: downloaded ? { downloaded: '1' } : undefined,
  })}>
    <GlassSurface radius={22} staticBackdropColor={colors.background} cacheStaticDecoration={cacheStaticDecoration} style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.decade}>{year === undefined ? t('Unknown year') : t('{year}s', { year })}</Text>
        <Text style={styles.note}>{t('{n} albums', { n: count })}</Text>
        <Icon name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
      <View style={styles.barTrack}><View style={[styles.bar, { width: `${fraction * 100}%`, backgroundColor: colors.accent }]} /></View>
      <View style={styles.covers}>
        {covers.map((cover) => <Cover key={cover.id} uri={cover.uri} size={52} />)}
        <View style={{ flex: 1 }} />
        {year !== undefined ? <Text style={styles.note}>{year}–{year + 9}</Text> : null}
      </View>
    </GlassSurface>
  </Pressable>;
}, (before, after) => before.era === after.era && before.year === after.year && before.count === after.count
  && before.fraction === after.fraction && before.downloaded === after.downloaded
  && before.cacheStaticDecoration === after.cacheStaticDecoration
  && before.covers.length === after.covers.length
  && before.covers.every((cover, i) => cover.id === after.covers[i].id && cover.uri === after.covers[i].uri));

const styles = themed((colors) => ({
  card: { padding: 16, gap: 12 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  decade: { flex: 1, color: colors.text, fontSize: 24, fontWeight: '700' },
  note: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  barTrack: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceHighlight },
  bar: { height: 5, borderRadius: 3 }, covers: { flexDirection: 'row', alignItems: 'center', gap: 8 },
}));
