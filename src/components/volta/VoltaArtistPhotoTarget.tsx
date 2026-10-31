/** The backdrop is tappable without receiving Android's full-photo focus tint. */
import { useCallback, useId, useRef, type ReactNode } from 'react';
import { findNodeHandle, Platform, Pressable, StyleSheet, type View } from 'react-native';

import { useT } from '@/i18n';
import { disableNativeViewFocusHighlight, isArtistFocusTraceEnabled } from '../../../modules/liquid-glass';

export function VoltaArtistPhotoTarget({ onOpen, children }: { onOpen: () => void; children?: ReactNode }) {
  const t = useT();
  const nativeId = `artist-photo-${useId()}`;
  const view = useRef<View | null>(null);
  const requested = useRef<View | null>(null);
  const revision = useRef(0);
  const configure = useCallback((force = false) => {
    const target = view.current;
    if (Platform.OS !== 'android' || !disableNativeViewFocusHighlight || !target || !force && requested.current === target) return;
    const tag = findNodeHandle(target);
    if (!tag) return;
    requested.current = target;
    const request = ++revision.current;
    if (isArtistFocusTraceEnabled) console.info(`[ResonusArtistFocus] call tag=${tag} force=${force}`);
    void disableNativeViewFocusHighlight(tag, nativeId).then((applied) => {
      if (isArtistFocusTraceEnabled) console.info(`[ResonusArtistFocus] result tag=${tag} applied=${applied}`);
      if (!applied && view.current === target && revision.current === request) requested.current = null;
    }).catch((error: unknown) => {
      if (isArtistFocusTraceEnabled) console.info(`[ResonusArtistFocus] failed tag=${tag} type=${error instanceof Error ? error.name : 'unknown'}`);
      if (view.current === target && revision.current === request) requested.current = null;
    });
  }, [nativeId]);
  return <Pressable style={StyleSheet.absoluteFill} onPress={onOpen}
    ref={view} onLayout={() => configure()} onFocus={() => configure(true)} nativeID={nativeId} collapsable={false}
    focusable accessible importantForAccessibility="yes"
    accessibilityRole="imagebutton" accessibilityLabel={t('View image')}
    accessibilityActions={[{ name: 'activate', label: t('View image') }]}
    onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'activate') onOpen(); }}>
    {children}
  </Pressable>;
}
