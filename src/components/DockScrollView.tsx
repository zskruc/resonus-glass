import { forwardRef } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';

/** Main vertical screen scrolls; sheets and horizontal lists keep their own handlers. */
export const DockScrollView = forwardRef<ScrollView, Omit<ScrollViewProps, 'onScroll'>>(
  function DockScrollView(props, ref) {
    const dockScroll = useLiquidDockScrollHandler();
    return (
      <Animated.ScrollView
        ref={ref}
        onScroll={dockScroll}
        scrollEventThrottle={16}
        // Keep JS drag callbacks after the worklet so Reanimated's event placeholders
        // do not replace an existing screen action such as refreshing diagnostics.
        {...props}
      />
    );
  },
);
