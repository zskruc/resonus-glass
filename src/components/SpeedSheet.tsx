/**
 * The menu for choosing how fast what is playing runs (#151).
 *
 * Compact buttons keep the whole range close together for repeated changes.
 * The grid adapts to the available card width and font scale, and can scroll
 * on a short screen without reducing the user's chosen text size.
 *
 * Unlike every other sheet in the app, choosing does NOT close it: the change
 * is heard on the spot, so closing after each pick would mean reopening to
 * correct it. The close button, backdrop, and system Back are the way out.
 *
 * In its own component, and memoized, because it holds its own visibility:
 * opening it re-renders the modal instead of the player behind it.
 */
import { memo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { MenuGlassCardHeader } from '@/components/MenuGlassCard';
import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import { PLAYBACK_SPEEDS, usePlayerStore } from '@/store/player';
import { fontSize, radius, spacing, themed, useTheme } from '@/theme';

export const SpeedSheet = memo(function SpeedSheet({
  openRef,
}: {
  openRef: React.MutableRefObject<() => void>;
}) {
  const t = useT();
  // Memoized, so the player repainting is not enough to bring this one along.
  const colors = useTheme();
  const { fontScale } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  // The longest label is 1.75×. Leave room for it at the chosen font scale
  // instead of truncating or shrinking it when three columns no longer fit.
  const minimumButtonWidth = Math.max(76, 52 * fontScale + 24);
  const columns = gridWidth > 0
    ? Math.max(1, Math.min(3, Math.floor((gridWidth + spacing.sm) / (minimumButtonWidth + spacing.sm))))
    : 3;
  const buttonWidth = gridWidth > 0 ? (gridWidth - (columns - 1) * spacing.sm) / columns : undefined;
  const speed = usePlayerStore((s) => s.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  return (
    <SheetModal openRef={openRef} presentation="card">
      {(close) => (
        <>
          <MenuGlassCardHeader title={t('Playback speed')} onClose={close} />
          <ScrollView style={styles.options} contentContainerStyle={styles.optionsContent}
            showsVerticalScrollIndicator={false}>
            <View style={styles.row} onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              setGridWidth((old) => old === width ? old : width);
            }}>
              {PLAYBACK_SPEEDS.map((v) => {
                const active = v === speed;
                return (
                  <Pressable
                    key={v}
                    style={({ pressed }) => [
                      styles.chip,
                      buttonWidth != null ? { width: buttonWidth } : styles.initialChip,
                      active && { backgroundColor: colors.accent },
                      pressed && { opacity: 0.6 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setSpeed(v)}
                  >
                    <Text style={[styles.chipText, active && { color: colors.onAccent }]}>
                      {`${v}×`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </>
      )}
    </SheetModal>
  );
});

const styles = themed((colors) => ({
  options: { flexGrow: 0, flexShrink: 1 },
  optionsContent: { paddingBottom: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  initialChip: { width: '30%' },
  chip: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceHighlight,
  },
  chipText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
}));
