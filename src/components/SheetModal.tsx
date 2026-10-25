/**
 * Self-contained bottom sheet: its visibility lives here and is opened
 * imperatively via `openRef`, so showing/hiding it does NOT re-render the
 * screen (with its list) that declares it — with state in the screen, opening
 * the menu had a noticeable delay. The content comes as a function receiving
 * `close` to close after choosing an action.
 *
 * The default presentation slides up and down and closes with a swipe. A
 * floating card keeps the same self-contained visibility and close callbacks.
 */
import { type MutableRefObject, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/glass';
import { MenuGlassCardFrame } from '@/components/MenuGlassCard';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { MenuRequestScope } from '@/lib/menuRequest';
import { colors, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';

export function SheetModal({
  openRef,
  onClosed,
  presentation = 'sheet',
  children,
}: {
  /** The screen holds a ref and calls `openRef.current()` to open. */
  openRef: MutableRefObject<() => void>;
  /** Runs once the sheet is off screen, however it was closed. For an action
   *  that unmounts the sheet along with whatever declares it. */
  onClosed?: () => void;
  presentation?: 'sheet' | 'card';
  children: (close: (after?: () => void) => void) => ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [lifecycle] = useState(() => new MenuRequestScope());
  useEffect(() => {
    openRef.current = () => {
      setSession(lifecycle.begin());
      setOpen(true);
    };
    return () => {
      lifecycle.invalidate();
      openRef.current = () => {};
    };
  }, [openRef, lifecycle]);
  const closeNow = useCallback((after?: () => void) => {
    if (!lifecycle.owns(session)) return;
    lifecycle.invalidate();
    setOpen(false);
    onClosed?.();
    after?.();
  }, [session, onClosed, lifecycle]);
  const { dismiss, pan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    open,
    closeNow,
    presentation,
    session,
  );
  // Unmount the Modal only after its exit animation, for either presentation.
  // A next modal opens only after this surface is offscreen, avoiding a
  // background switch underneath two independently visible native windows.
  const close = (after?: () => void) => dismiss(() => closeNow(after));

  if (presentation === 'card') {
    return (
      <Modal transparent animationType="none" visible={open} onRequestClose={() => close()}>
        <MenuGlassCardFrame onClose={() => close()} backdropStyle={backdropStyle}
          cardStyle={sheetStyle} onLayout={onSheetLayout}>
          {children(close)}
        </MenuGlassCardFrame>
      </Modal>
    );
  }

  return (
    <Modal transparent animationType="none" visible={open} onRequestClose={() => close()}>
      {/* Gestures inside an RN Modal need a root view of their own: the Modal
          renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />
        </Animated.View>
        {/* One drag around everything: what goes in here is a short list of
            actions that never scrolls, so nothing else competes for the
            gesture (the song menu needs two because its list does scroll). */}
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md, backgroundColor: 'transparent' }, sheetStyle]}
            onLayout={onSheetLayout}
          >
            <GlassBackdrop radius={0} radiusTopLeft={radius.xxl} radiusTopRight={radius.xxl} variant="prominent" tint={colors.surface} />
            {/* Spotify-style grabber: the visual cue that the sheet can be
                dragged down to dismiss. */}
            <View style={styles.grabber} />
            {children(close)}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    // Smaller than the old spacing.lg because the grabber below already brings
    // its own margin: together they add up to the same top gap as before.
    paddingTop: spacing.sm,
  },
  // Spotify's little handle. Its only job is to advertise the drag gesture, so
  // it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
}));
