import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type ForegroundEffect = () => void | (() => void);

/**
 * Run only while the containing route is focused and the app is active.
 * Focus cleanup stops work directly, even when an unfocused screen is frozen
 * before it can render a changed visibility prop. Memoize effect with useCallback.
 */
export function useForegroundEffect(effect: ForegroundEffect): void {
  useFocusEffect(useCallback(() => {
    let running = false;
    let cleanup: (() => void) | undefined;
    const stop = () => {
      if (!running) return;
      running = false;
      const release = cleanup;
      cleanup = undefined;
      release?.();
    };
    const sync = (state: AppStateStatus) => {
      if (state !== 'active') {
        stop();
        return;
      }
      if (running) return;
      running = true;
      cleanup = effect() || undefined;
    };
    const subscription = AppState.addEventListener('change', sync);
    sync(AppState.currentState);
    return () => {
      subscription.remove();
      stop();
    };
  }, [effect]));
}
