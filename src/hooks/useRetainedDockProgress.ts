import { useLayoutEffect } from 'react';
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

/** Keep the painted dock until the provider has restored this route on the UI thread. */
export function useRetainedDockProgress(shown: boolean, {
  progress, uiEnabled, scope, uiScope,
}: { progress: SharedValue<number>; uiEnabled: SharedValue<boolean>; scope: string; uiScope: SharedValue<string> }) {
  const visible = useSharedValue(shown);
  const retained = useSharedValue(0);
  useLayoutEffect(() => { visible.set(shown); }, [shown, visible]);
  const ready = useDerivedValue(() => visible.get() && uiScope.get() === scope);
  useAnimatedReaction(() => ready.get() ? uiEnabled.get() ? progress.get() : 0 : null,
    (value) => { if (value !== null) retained.set(value); });
  return useDerivedValue(() => ready.get() ? uiEnabled.get() ? progress.get() : 0 : retained.get());
}
