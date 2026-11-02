import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackChevron } from '@/components/BackChevron';
import { useRouteImageLease } from '@/components/RouteImageResources';
import { useT } from '@/i18n';
import { colors, spacing } from '@/theme';

type Reporter = (ready: boolean) => void;
const DetailHeroContext = createContext<Reporter | undefined>(undefined);

/** Only the main photograph/blur composite reports; a navigation copy is independent. */
export function useDetailHeroReporter(): Reporter | undefined { return useContext(DetailHeroContext); }

interface Props {
  children: ReactNode;
  enabled?: boolean;
  /** Logical photograph/prepared-field identity, never the scroll offset. */
  identity?: string;
  style?: StyleProp<ViewStyle>;
  loadingColor?: string;
  /** Stable final page background, kept visible while the composite prepares. */
  background?: ReactNode;
  loadingTint?: string;
  onCancel?: () => void;
}

/** Keep page state and layout mounted, revealing one complete scene without per-layer fades. */
export function DetailHeroScene({ children, enabled = true, identity, style, loadingColor, background,
  loadingTint, onCancel }: Props) {
  const imageLease = useRouteImageLease();
  const insets = useSafeAreaInsets();
  const t = useT();
  const request = useMemo(() => ({ identity, enabled, lease: imageLease }), [identity, enabled, imageLease]);
  const [state, setState] = useState(() => ({ request, ready: false }));
  if (state.request !== request) setState({ request, ready: false });
  const report = useCallback<Reporter>((ready) => {
    // A painted scene stays visible for this identity/lease. Revalidating a
    // local file must not blank the complete page during normal parent renders.
    setState((current) => current.request === request && ready && !current.ready ? { request, ready: true } : current);
  }, [request]);
  const visible = !enabled || imageLease.active && state.request === request && state.ready;
  const pending = enabled && imageLease.active && !visible;
  const [loadingRequest, setLoadingRequest] = useState<typeof request>();
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = setTimeout(() => { if (active) setLoadingRequest(request); }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [pending, request]);
  const backgroundColor = loadingColor ?? colors.background;
  const tint = loadingTint ?? colors.text;

  return <View style={[styles.root, { backgroundColor }, style]}>
    {background}
    <DetailHeroContext.Provider value={enabled ? report : undefined}>
      <Animated.View testID="detail-hero-scene-content" style={[styles.content, { opacity: visible ? 1 : 0 }]}
        pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
        {children}
      </Animated.View>
    </DetailHeroContext.Provider>
    {pending && loadingRequest === request ? <View testID="detail-hero-loading"
      style={[StyleSheet.absoluteFill, { backgroundColor: background ? 'transparent' : backgroundColor }]}>
      <BackChevron size={28} color={tint} onPress={onCancel}
        style={[styles.back, { top: insets.top + spacing.sm }]} />
      <View pointerEvents="none" style={styles.loading}>
        <ActivityIndicator color={tint} accessibilityLabel={t('Loading…')} />
      </View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  back: { position: 'absolute', left: spacing.lg, zIndex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
