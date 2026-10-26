/**
 * Self-contained bottom sheet: its visibility lives here and is opened
 * imperatively via `openRef`, so showing/hiding it does NOT re-render the
 * screen (with its list) that declares it — with state in the screen, opening
 * the menu had a noticeable delay. The content comes as a function receiving
 * `close` to close after choosing an action.
 *
 * Every window uses the artist picker’s floating glass card. Existing detail
 * cards retain their own scrolling; legacy action sheets get a bounded body.
 */
import { type MutableRefObject, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView } from 'react-native';

import { MenuGlassCardFrame } from '@/components/MenuGlassCard';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { MenuRequestScope } from '@/lib/menuRequest';

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
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    open,
    closeNow,
    'card',
    session,
  );
  // Unmount the Modal only after its exit animation, for either presentation.
  // A next modal opens only after this surface is offscreen, avoiding a
  // background switch underneath two independently visible native windows.
  const close = (after?: () => void) => dismiss(() => closeNow(after));

  return (
    <Modal transparent animationType="none" visible={open} onRequestClose={() => close()}>
      <MenuGlassCardFrame onClose={() => close()} backdropStyle={backdropStyle}
        cardStyle={sheetStyle} onLayout={onSheetLayout}>
        {/* Detail cards already own their scroll view. Legacy short action
            sheets share the same shell and gain a bounded scrolling body. */}
        {presentation === 'card' ? children(close) : (
          <ScrollView style={{ flexShrink: 1, minHeight: 0 }} showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {children(close)}
          </ScrollView>
        )}
      </MenuGlassCardFrame>
    </Modal>
  );
}
