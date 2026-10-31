/**
 * Settings › Player › Bottom row: the buttons under the player's controls, and
 * in what order. The same draggable list as the Home buttons, with no
 * exemption: every one of them has another way in.
 */
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { GlassSurface, GlassSwitch } from '@/components/glass';
import Icon from '@/components/Icon';
import { Pressable, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { SETTINGS_ROW_LAYOUT, ScreenHeader, SelectList, SettingsSafeArea } from '@/components/SettingsUI';
import { useAccent } from '@/hooks/useAccent';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useSettings, type PlayerButton, type PlayerButtonKey } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';

/** The icon each one wears in the player, so the list reads like the row. */
const BUTTONS: Record<PlayerButtonKey, { label: string; icon: keyof typeof Icon.glyphMap }> = {
  devices: { label: 'Devices', icon: 'laptop-outline' },
  lyrics: { label: 'Lyrics', icon: 'mic-outline' },
  speed: { label: 'Playback speed', icon: 'speedometer-outline' },
  sleep: { label: 'Sleep timer', icon: 'moon-outline' },
  queue: { label: 'Queue', icon: 'layers-outline' },
};

function ButtonRow({ button }: { button: PlayerButton }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setPlayerButton = useSettings((s) => s.setPlayerButton);
  const accent = useAccent();
  const { label, icon } = BUTTONS[button.key];
  return (
    <GlassSurface radius={radius.md} style={styles.row}>
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
      <Icon name={icon} size={22} color={colors.textSecondary} />
      <View style={styles.text}>
        <Text style={styles.label}>{t(label)}</Text>
      </View>
      <GlassSwitch
        value={button.enabled}
        onValueChange={(v) => setPlayerButton(button.key, v)}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </GlassSurface>
  );
}

export default function PlayerButtonsSettings() {
  const dockScroll = useLiquidDockScrollHandler();
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const playerButtons = useSettings((s) => s.playerButtons);
  const setPlayerButtons = useSettings((s) => s.setPlayerButtons);
  const layout = useSettings((s) => s.playerButtonsLayout);
  const setLayout = useSettings((s) => s.setPlayerButtonsLayout);
  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Bottom row')} />
      <View style={[styles.layout, { paddingHorizontal: centredPadding(width, spacing.lg) }]}>
        <SelectList
          label={t('Arrangement')}
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'centered', label: t('Grouped in the middle') },
            { value: 'spread', label: t('Spread across the width') },
          ]}
        />
      </View>
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        onScroll={dockScroll}
        data={playerButtons}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <ButtonRow button={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = playerButtons.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setPlayerButtons(next);
        }}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPad, paddingHorizontal: centredPadding(width, spacing.lg) },
        ]}
      />
    </SettingsSafeArea>
  );
}

const styles = themed((colors) => ({
  layout: { marginBottom: spacing.md },
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
  text: { flex: 1 },
  label: { color: colors.text, fontSize: fontSize.md },
}));
