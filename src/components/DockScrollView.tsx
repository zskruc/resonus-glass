import { forwardRef, useCallback, useContext, useRef } from 'react';
import { ScrollView, StyleSheet, type ScrollViewProps, type View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { SettingsAnchorContext } from './SettingsAnchorContext';
import { SettingsScrollPaddingContext } from './SettingsScrollPaddingContext';

/** Main vertical screen scrolls; sheets and horizontal lists keep their own handlers. */
export const DockScrollView = forwardRef<ScrollView, Omit<ScrollViewProps, 'onScroll'>>(
  function DockScrollView(props, ref) {
    const dockScroll = useLiquidDockScrollHandler();
    const anchor = useContext(SettingsAnchorContext);
    const inner = useRef<View>(null!);
    const scroll = useRef<ScrollView | null>(null);
    const attach = useCallback((node: ScrollView | null) => {
      scroll.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
      anchor?.registerScroll(node, (props.innerViewRef ?? inner).current);
    }, [anchor, props.innerViewRef, ref]);
    const anchorProps: Partial<ScrollViewProps> = anchor ? {
      innerViewRef: props.innerViewRef ?? inner,
      onLayout: (event) => { props.onLayout?.(event); anchor.registerScroll(scroll.current, (props.innerViewRef ?? inner).current); },
      onContentSizeChange: (width, height) => { props.onContentSizeChange?.(width, height); anchor.registerScroll(scroll.current, (props.innerViewRef ?? inner).current); },
    } : {};
    const bottom = useContext(SettingsScrollPaddingContext);
    const content = StyleSheet.flatten(props.contentContainerStyle);
    const existing = content?.paddingBottom ?? content?.paddingVertical ?? content?.padding;
    const contentContainerStyle = bottom !== undefined && !props.horizontal
      ? [props.contentContainerStyle, { paddingBottom: Math.max(bottom, typeof existing === 'number' ? existing : 0) }]
      : props.contentContainerStyle;
    return (
      <Animated.ScrollView
        ref={anchor ? attach : ref}
        onScroll={dockScroll}
        scrollEventThrottle={16}
        // Keep JS drag callbacks after the worklet so Reanimated's event placeholders
        // do not replace an existing screen action such as refreshing diagnostics.
        {...props}
        {...anchorProps}
        contentContainerStyle={contentContainerStyle}
      />
    );
  },
);
