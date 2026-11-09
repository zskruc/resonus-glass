import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Text } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Font from 'expo-font';
import { captureCustomizationOwner, customizationRevision, customizationScope, readLocalCustomization, subscribeCustomizations } from '@/lib/localCustomizations';
import { validCustomizationValue, type LocalLyricFonts } from '@/lib/localCustomizationModels';
import { lyricFontFamily, lyricFontRuns } from '@/lib/lyricFonts';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { useMetadataHydration } from '@/hooks/useLocalMetadata';

const Context = createContext<{ preferences?: LocalLyricFonts; custom?: string | null }>({});
export function LyricsTypographyProvider({ children }: { children: ReactNode }) {
  useMetadataHydration();
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offlineSource); useAuthStore((state) => state.offline);
  const scope = customizationScope(), client = useQueryClient();
  const key = useMemo(() => ['localLyricFonts', scope.profile, scope.source], [scope.profile, scope.source]);
  const revision = useSyncExternalStore(subscribeCustomizations, customizationRevision), previous = useRef(revision);
  const custom = useSettings((state) => state.customFontFamily);
  const result = useQuery({ queryKey: key, enabled: scope.profile !== 'default', staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const value = await readLocalCustomization<LocalLyricFonts>(scope, 'lyric-fonts', 'fonts', captureCustomizationOwner(scope, () => !signal.aborted));
      return value && validCustomizationValue('lyric-fonts', value) ? value : null;
    } });
  useEffect(() => { if (revision !== previous.current) { previous.current = revision; void client.invalidateQueries({ queryKey: key, exact: true }); } }, [revision, key, client]);
  const value = useMemo(() => ({ preferences: result.data ?? undefined, custom: custom && Font.isLoaded(custom) ? custom : null }), [result.data, custom]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
/** Nested native Text keeps the parent's size, weight, color and sweep geometry. */
export function LyricFontText({ text, context }: { text: string; context?: string }) {
  const { preferences, custom } = useContext(Context);
  const runs = useMemo(() => lyricFontRuns(text, context), [text, context]);
  if (!preferences || !Object.keys(preferences.fonts).length) return <>{text}</>;
  return <>{runs.map((run, index) => <Text key={index} style={{ fontFamily: lyricFontFamily(run.script, preferences, custom) }}>{run.text}</Text>)}</>;
}
