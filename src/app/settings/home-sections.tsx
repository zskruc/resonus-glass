/**
 * Settings › Home sections: draggable list (same engine as the queue and
 * playlists) to show/hide and reorder the album rows on Home. Changes are
 * applied and saved immediately.
 */
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { GlassSurface, GlassSwitch, GlassPressable } from '@/components/glass';
import { useDiscoveryPreferences } from '@/store/discoveryPreferences';
import { homeShelfPreset, type ShelfLayout, type ShelfPreference } from '@/lib/discoveryPreferences';
import Icon from '@/components/Icon';
import { Pressable, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';

import { SETTINGS_ROW_LAYOUT, ScreenHeader, SettingsSafeArea } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useSettings, type HomeSection, type HomeSectionKey } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

/** Label (i18n key) of each section. */
const LABEL: Record<HomeSectionKey, string> = {
  dailyRecommendations: 'Made for you',
  recentlyAdded: 'Recently added',
  newReleases: 'New releases',
  recentlyPlayed: 'Recently played',
  mostPlayed: 'Most played albums',
  mostPlayedSongs: 'Most played songs',
  randomSongs: 'Random songs',
  discover: 'Discover',
  playlists: 'Playlists',
  podcasts: 'Recent episodes',
  randomAlbums: 'Random albums',
  randomArtists: 'Random artists',
};

function SectionRow({ section }: { section: HomeSection }) {
  const t = useT();
  const drag = useReorderableDrag();
  const prefs = useDiscoveryPreferences();
  const preference: ShelfPreference = prefs.data.shelves[section.key] ?? { layout: 'default' as ShelfLayout, size: 'default' as const, limit: 20 };
  const change = (patch: Partial<typeof preference>) => void prefs.change((data) => ({ ...data, shelves: { ...data.shelves, [section.key]: { ...preference, ...patch } } }));
  const setHomeSection = useSettings((s) => s.setHomeSection);
  // From the store, not `colors.accent`: without subscription the switch would
  // keep the previous accent while the screen stays mounted.
  const { accent } = useTheme();
  return (
    <GlassSurface radius={radius.md} style={{ marginBottom: spacing.sm, overflow: 'hidden' }}>
    <View style={styles.row}>
      <Pressable
        hitSlop={10}
        onPressIn={() => {
          haptic('medium');
          drag();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('Reorder')}
      >
        <Icon name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
      <Text style={styles.label}>{t(LABEL[section.key])}</Text>
      <GlassSwitch
        value={section.enabled}
        onValueChange={(v) => setHomeSection(section.key, v)}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
    {section.key !== 'dailyRecommendations' ? <View style={{ paddingHorizontal: spacing.lg, paddingBottom: 12, gap: 10 }}>
      {!['mostPlayedSongs', 'randomSongs'].includes(section.key) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['default', 'cards', 'rows', 'grid'] as const).map((layout) => <GlassPressable key={layout} onPress={() => change({ layout })} style={{ padding: 8, borderRadius: 10, backgroundColor: preference.layout === layout ? colors.surfaceHighlight : 'transparent' }}><Text style={{ color: preference.layout === layout ? colors.accent : colors.textSecondary }}>{t(layout === 'default' ? 'Default layout' : layout === 'cards' ? 'Cards' : layout === 'grid' ? 'Grid' : 'Rows')}</Text></GlassPressable>)}</View> : null}
      {!['mostPlayedSongs', 'randomSongs'].includes(section.key) && !['rows', 'compact'].includes(preference.layout) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['small', 'default', 'large'] as const).map((size) => <GlassPressable key={size} onPress={() => change({ size })} style={{ padding: 8, borderRadius: 10, backgroundColor: preference.size === size ? colors.surfaceHighlight : 'transparent' }}><Text style={{ color: preference.size === size ? colors.accent : colors.textSecondary }}>{t(size === 'small' ? 'Small covers' : size === 'large' ? 'Large covers' : 'Default size')}</Text></GlassPressable>)}</View> : null}
      {preference.layout === 'grid' || ['mostPlayedSongs', 'randomSongs'].includes(section.key) ? <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><Text style={{ color: colors.textSecondary }}>{t('Rows per column')}</Text>{([1, 2, 3] as const).map((rows) => <GlassPressable key={rows} accessibilityLabel={t('{n} rows', { n: rows })} accessibilityState={{ selected: (preference.rows ?? (['mostPlayedSongs', 'randomSongs'].includes(section.key) ? 3 : 2)) === rows }} onPress={() => change({ rows })} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: (preference.rows ?? (['mostPlayedSongs', 'randomSongs'].includes(section.key) ? 3 : 2)) === rows ? colors.surfaceHighlight : 'transparent' }}><Text style={{ color: colors.text }}>{rows}</Text></GlassPressable>)}</View> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}><Text style={{ color: colors.textSecondary }}>{t('Items per section')}: {preference.limit}</Text><GlassPressable accessibilityLabel={t('Decrease')} onPress={() => change({ limit: Math.max(3, preference.limit - 5) })}><Text style={{ color: colors.accent, fontSize: 24 }}>−</Text></GlassPressable><GlassPressable accessibilityLabel={t('Increase')} onPress={() => change({ limit: Math.min(50, preference.limit + 5) })}><Text style={{ color: colors.accent, fontSize: 24 }}>+</Text></GlassPressable></View>
    </View> : null}
    </GlassSurface>
  );
}

/** Sections that don't exist locally: their row here would promise something
 *  Home never renders (same criteria as folder browsing in Appearance). */
const SERVER_ONLY: HomeSectionKey[] = ['discover'];

export default function HomeSectionsSettings() {
  const dockScroll = useLiquidDockScrollHandler();
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const homeSections = useSettings((s) => s.homeSections);
  const setHomeSections = useSettings((s) => s.setHomeSections);
  const prefs = useDiscoveryPreferences();
  const visible = offline
    ? homeSections.filter((s) => !SERVER_ONLY.includes(s.key))
    : homeSections;

  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Home sections')} />
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, gap: 8, marginBottom: spacing.sm }}>{(['default', 'compact', 'covers'] as const).map((preset) => <GlassPressable key={preset} onPress={() => void prefs.change((data) => homeShelfPreset(data, homeSections.map((row) => row.key), preset))} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: colors.surfaceHighlight }}><Text style={{ color: colors.text }}>{t(preset === 'default' ? 'Default layout' : preset === 'compact' ? 'Compact shelves' : 'Cover focus')}</Text></GlassPressable>)}</View>
      <ReorderableList
        onScroll={dockScroll}
        data={visible}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <SectionRow section={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const nextVisible = visible.slice();
          const [moved] = nextVisible.splice(from, 1);
          nextVisible.splice(to, 0, moved);
          // Hidden ones go back to their absolute position: reordering locally
          // must not lose or reposition the config of server-only rows.
          let vi = 0;
          const next = homeSections.map((s) =>
            offline && SERVER_ONLY.includes(s.key) ? s : nextVisible[vi++],
          );
          setHomeSections(next);
        }}
        contentContainerStyle={[
          styles.list,
          // Centred once the screen is wider than a list wants to be, like
          // every other settings screen (#131).
          { paddingBottom: bottomPad, paddingHorizontal: centredPadding(width, spacing.lg) },
        ]}
      />
    </SettingsSafeArea>
  );
}

const styles = themed((colors) => ({
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...SETTINGS_ROW_LAYOUT,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  label: { flex: 1, color: colors.text, fontSize: fontSize.md },
}));
