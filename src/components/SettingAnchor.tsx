import { useLocalSearchParams } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ScrollView } from 'react-native';
import { useT } from '@/i18n';
import { settingScrollOffset } from '@/lib/settingsSearch';
import { useAccent } from '@/hooks/useAccent';
import { SettingsAnchorContext, type SettingsAnchorScroll } from './SettingsAnchorContext';

/** Only an explicit search deep link enables measurement; normal scrolling stays entirely on the UI thread. */
export function SettingsAnchorProvider({ children }: { children: ReactNode }) {
  const { setting, settingVisit } = useLocalSearchParams<{ setting?: string; settingVisit?: string }>();
  const t = useT();
  const target = typeof setting === 'string' && setting.length <= 200 ? setting : '';
  const nodes = useRef<{ scroll: ScrollView | null; content: View | null; row: View | null }>({ scroll: null, content: null, row: null });
  const handled = useRef('');
  const visit = `${target}|${settingVisit ?? ''}`;
  const locate = useCallback(() => {
    const { scroll, content, row } = nodes.current;
    if (!target || !scroll || !content || !row || handled.current === visit) return;
    row.measureLayout(content, (_x, y) => {
      if (nodes.current.row !== row || nodes.current.scroll !== scroll) return;
      handled.current = visit;
      scroll.scrollTo({ y: settingScrollOffset(y), animated: true });
    }, () => {});
  }, [target, visit]);
  const context = useMemo<SettingsAnchorScroll>(() => ({ target, visit, translatedTarget: t(target), locate,
    registerScroll: (scroll, content) => { nodes.current.scroll = scroll; nodes.current.content = content; locate(); },
    registerTarget: (row) => { nodes.current.row = row; locate(); },
  }), [target, visit, t, locate]);
  return <SettingsAnchorContext.Provider value={target ? context : undefined}>{children}</SettingsAnchorContext.Provider>;
}

/** A label is compared after translation, so the stable English deep link works in any language. */
export function SettingAnchor({ label, children }: { label?: string; children: ReactNode }) {
  const context = useContext(SettingsAnchorContext);
  const matched = !!label && (label === context?.translatedTarget || label === context?.target);
  const ref = useRef<View>(null);
  const [finished, setFinished] = useState('');
  const accent = useAccent();
  useEffect(() => {
    if (!matched || !context) return;
    context.registerTarget(ref.current);
    const timer = setTimeout(() => setFinished(context.visit), 2600);
    return () => { clearTimeout(timer); context.registerTarget(null); };
  }, [matched, context]);
  if (!matched) return <>{children}</>;
  return <View ref={ref} collapsable={false} onLayout={() => context?.locate()}>
    {children}
    {finished !== context?.visit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 14, borderWidth: 2, borderColor: accent, backgroundColor: `${accent.slice(0, 7)}15` }]} /> : null}
  </View>;
}
