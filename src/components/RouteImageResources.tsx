import { useNavigationContainerRef } from 'expo-router';
import { Activity, createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

import { canFreezeRouteImages, rootImageNavigation, RouteImageLeaseController } from '@/lib/routeImageLease';

export type RouteImageLease = Readonly<{ active: boolean }>;
const ALWAYS_ACTIVE: RouteImageLease = Object.freeze({ active: true });
const ImageLeaseContext = createContext<RouteImageLease>(ALWAYS_ACTIVE);
const ControllerContext = createContext<RouteImageLeaseController | null>(null);

export function useRouteImageLease() { return useContext(ImageLeaseContext); }

/** Default-on outside a page: global Mini Player, menus and shared artwork keep their ownership. */
export function RouteImageResource({ children }: { children: ReactNode }) {
  return useRouteImageLease().active ? children : null;
}

type Event = { target?: string; data?: { closing?: boolean } };
type TransitionListeners = { transitionStart: (event: Event) => void; transitionEnd: (event: Event) => void;
  gestureCancel: (event: Event) => void };

export function RootImageResourceProvider({ children }: { children: (listeners: TransitionListeners) => ReactNode }) {
  const navigation = useNavigationContainerRef();
  const [controller] = useState(() => new RouteImageLeaseController());
  useLayoutEffect(() => {
    const read = () => {
      if (navigation.isReady()) controller.observe(rootImageNavigation(navigation.getRootState()));
    };
    // SDK 57's useRootNavigationState reads a snapshot, not a subscription.
    // Subscribe to this same Expo container, never a second NavigationContext.
    const removeState = navigation.addListener('state', read);
    const removeReady = navigation.addListener('ready', read);
    read();
    return () => { removeState(); removeReady(); };
  }, [controller, navigation]);
  useEffect(() => () => controller.dispose(), [controller]);
  const listeners = useMemo<TransitionListeners>(() => ({
    transitionStart: (event) => controller.transitionStart(event.target, event.data?.closing),
    transitionEnd: (event) => controller.transitionEnd(event.target, event.data?.closing),
    gestureCancel: (event) => controller.transitionCancel(event.target),
  }), [controller]);
  return <ControllerContext.Provider value={controller}>{children(listeners)}</ControllerContext.Provider>;
}

export function RootScreenImageResources({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('RootScreenImageResources requires RootImageResourceProvider');
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const active = !snapshot.ready || snapshot.retainedKeys.has(routeKey);
  // A fresh token on reacquisition prevents ImageRef owners from displaying a
  // previously released native handle before their asynchronous reload finishes.
  const lease = useMemo<RouteImageLease>(() => Object.freeze({ active }), [active]);
  const [committedLease, setCommittedLease] = useState(lease);
  useLayoutEffect(() => {
    // Deliberate bounded second commit: native image targets must disappear
    // before Activity disconnects the old page's effects/layout.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (committedLease !== lease) setCommittedLease(lease);
  }, [committedLease, lease]);
  // This boundary sits outside Activity. A lease change first allows one host
  // commit (Image/MaskedView removal), then parks the retained page state.
  // Native React 19 Activity avoids react-freeze's shared never-ending thenable
  // retrying against useSyncExternalStore updates across multiple parked pages.
  const hidden = canFreezeRouteImages(snapshot, routeKey, committedLease === lease);
  return <ImageLeaseContext.Provider value={lease}>
    <Activity mode={hidden ? 'hidden' : 'visible'}>{children}</Activity>
  </ImageLeaseContext.Provider>;
}
