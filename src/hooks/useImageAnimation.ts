import type { Image } from 'expo-image';
import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AppState } from 'react-native';

/**
 * expo-image's autoplay flag applies when a resource loads. Changing it on an
 * already loaded image does not stop its decoder on Android, so visible
 * artwork also needs the imperative start/stop calls. Static list covers never
 * subscribe to AppState/navigation or issue these calls.
 */
export function useImageAnimation(
  ref: RefObject<Image | null>,
  enabled: boolean,
  source: string | undefined,
  revision = 0,
  settleMs = 0,
): { autoplay: boolean; onDisplay: () => void } {
  const navigation = useNavigation();
  const readFocused = useCallback(() => {
    // Global artwork lives beside the root Stack and uses the container ref.
    // Before that ref is ready, its focus query has no current navigator.
    const root = navigation as typeof navigation & { isReady?: () => boolean };
    if (root.isReady && !root.isReady()) return true;
    return navigation.isFocused();
  }, [navigation]);
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  const [focused, setFocused] = useState(readFocused);
  const navigationFocus = useRef(focused);
  const latest = useRef({ enabled, source, revision, settleMs });
  const controlled = useRef(false);
  const image = useRef<Image | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    latest.current = { enabled, source, revision, settleMs };
  }, [enabled, source, revision, settleMs]);

  const cancelSettle = useCallback(() => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);

  const sync = useCallback(() => {
    const current = latest.current;
    if (current.enabled) controlled.current = true;
    if (!controlled.current) return;
    const view = ref.current;
    if (!view) return;
    image.current = view;
    const play = current.enabled && !!current.source && AppState.currentState === 'active'
      && navigationFocus.current && readFocused();
    void (play ? view.startAnimating() : view.stopAnimating()).catch(() => {});
  }, [ref, readFocused]);

  const syncAndSettle = useCallback(() => {
    sync();
    cancelSettle();
    const requested = latest.current;
    if (!controlled.current || !requested.source || requested.settleMs <= 0) return;
    // During an expo-image crossfade, the imperative API can address the old
    // drawable. Correct the active one once the fade is over, including a
    // second stop when the page was hidden or the app went into the background.
    // Two 60 Hz frames leave the native fade's end action time to recycle it.
    const timer = setTimeout(() => {
      if (settleTimer.current !== timer) return;
      settleTimer.current = null;
      const current = latest.current;
      if (
        current.source !== requested.source ||
        current.revision !== requested.revision ||
        current.enabled !== requested.enabled ||
        current.settleMs !== requested.settleMs
      ) {
        return;
      }
      sync();
    }, requested.settleMs + 32);
    settleTimer.current = timer;
  }, [sync, cancelSettle]);

  useLayoutEffect(() => {
    // Suspense hides a frozen screen by detaching its refs and layout effects.
    // The foreground event can arrive before those refs are attached again,
    // so it cannot by itself restart an already-loaded, unchanged image.
    syncAndSettle();
    return () => {
      cancelSettle();
      const view = image.current;
      image.current = null;
      void view?.stopAnimating().catch(() => {});
    };
  }, [syncAndSettle, cancelSettle]);

  useEffect(() => {
    if (!enabled && !controlled.current) return;
    controlled.current = true;
    setActive(AppState.currentState === 'active');
    navigationFocus.current = readFocused();
    setFocused(navigationFocus.current);
    syncAndSettle();
    // A blurred native-stack screen can be frozen before React commits its
    // isFocused prop. Native decoders must stop from the event itself.
    const removeFocus = navigation.addListener('focus', () => {
      navigationFocus.current = true;
      setFocused(true);
      syncAndSettle();
    });
    const removeBlur = navigation.addListener('blur', () => {
      navigationFocus.current = false;
      setFocused(false);
      syncAndSettle();
    });
    const sub = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      syncAndSettle();
    });
    return () => {
      sub.remove();
      removeFocus();
      removeBlur();
      cancelSettle();
      // Retain the actual image: a recycling/return rebuild can already have
      // replaced ref.current when the old effect is cleaned up.
      const view = image.current;
      image.current = null;
      void view?.stopAnimating().catch(() => {});
    };
  }, [ref, enabled, source, revision, settleMs, navigation, readFocused, syncAndSettle, cancelSettle]);

  const onDisplay = useCallback(() => {
    // A late event for the previous source or rebuilt native view must not
    // restart it. sync also reads the latest visibility and AppState, rather
    // than the enabled value captured by this event handler.
    if (latest.current.source !== source || latest.current.revision !== revision) return;
    syncAndSettle();
  }, [source, revision, syncAndSettle]);

  return { autoplay: enabled && !!source && active && focused, onDisplay };
}
