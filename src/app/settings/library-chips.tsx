/** Show/hide and reorder the library's filters, without changing its page style. */
import Icon from '@/components/Icon';
import { GlassSurface, GlassSwitch } from '@/components/glass';
import { SETTINGS_ROW_LAYOUT, ScreenHeader, SettingsSafeArea } from '@/components/SettingsUI';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useSettings, type LibraryChip, type LibraryChipKey } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { Pressable, Text } from 'react-native';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';

const LABEL: Record<LibraryChipKey, string> = {
  playlists: 'Playlists', albums: 'Albums', artists: 'Artists', podcasts: 'Podcasts',
};

function ChipRow({ chip }: { chip: LibraryChip }) {
  const t = useT(), drag = useReorderableDrag(), { accent } = useTheme();
  const setChip = useSettings((state) => state.setLibraryChip);
  return <GlassSurface radius={radius.md} style={styles.row}>
    <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Reorder')}
      onPressIn={() => { haptic('medium'); drag(); }}>
      <Icon name="reorder-two" size={24} color={colors.textSecondary} />
    </Pressable>
    <Text style={styles.label}>{t(LABEL[chip.key])}</Text>
    <GlassSwitch value={chip.enabled} onValueChange={(value) => setChip(chip.key, value)}
      trackColor={{ false: colors.control, true: accent }} thumbColor={colors.knob} />
  </GlassSurface>;
}

export default function LibraryChipsSettings() {
  useTheme();
  const t = useT(), { width } = useScreenSize();
  const bottomPad = useScreenBottomPadding(), dockScroll = useLiquidDockScrollHandler();
  const chips = useSettings((state) => state.libraryChips);
  const setChips = useSettings((state) => state.setLibraryChips);
  return <SettingsSafeArea>
    <ScreenHeader title={t('Your library chips')} />
    <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
    <ReorderableList data={chips} onScroll={dockScroll}
      keyExtractor={(item) => item.key} renderItem={({ item }) => <ChipRow chip={item} />}
      contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: centredPadding(width, spacing.lg) }}
      onReorder={({ from, to }: ReorderableListReorderEvent) => {
        if (from === to || from < 0 || to < 0 || from >= chips.length || to >= chips.length) return;
        const next = chips.slice(), [moved] = next.splice(from, 1);
        next.splice(to, 0, moved); setChips(next);
      }} />
  </SettingsSafeArea>;
}

const styles = themed((palette) => ({
  hint: { color: palette.textMuted, fontSize: fontSize.xs, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, ...SETTINGS_ROW_LAYOUT,
    paddingHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.md },
  label: { flex: 1, color: palette.text, fontSize: fontSize.md },
}));
