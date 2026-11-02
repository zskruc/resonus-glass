import { forwardRef, useContext } from 'react';
import { ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { SettingsScrollPaddingContext } from './SettingsScrollPaddingContext';

/** Main vertical screen scrolls; sheets and horizontal lists keep their own handlers. */
export const DockScrollView = forwardRef<ScrollView, Omit<ScrollViewProps, 'onScroll'>>(
  function DockScrollView(props, ref) {
    const dockScroll = useLiquidDockScrollHandler();
    const bottom = useContext(SettingsScrollPaddingContext);
    const content = StyleSheet.flatten(props.contentContainerStyle);
    const existing = content?.paddingBottom ?? content?.paddingVertical ?? content?.padding;
    const contentContainerStyle = bottom !== undefined && !props.horizontal
      ? [props.contentContainerStyle, { paddingBottom: Math.max(bottom, typeof existing === 'number' ? existing : 0) }]
      : props.contentContainerStyle;
    return (
      <Animated.ScrollView
        ref={ref}
        onScroll={dockScroll}
        scrollEventThrottle={16}
        // Keep JS drag callbacks after the worklet so Reanimated's event placeholders
        // do not replace an existing screen action such as refreshing diagnostics.
        {...props}
        contentContainerStyle={contentContainerStyle}
      />
    );
  },
);
