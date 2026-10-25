/** Material only: original controls own layout, colors and interactions. */
import Slider, { type SliderProps } from '@react-native-community/slider';
import { forwardRef } from 'react';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import {
  Pressable, StyleSheet, Switch, TextInput, View,
  type PressableProps, type StyleProp, type SwitchProps, type TextInputProps,
  type ViewProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';

import { LiquidGlassView, isLiquidGlassAvailable, updateNativeDockProgress } from '../../../modules/liquid-glass';
import { resolveGlassProfile, useGlassTuning, type GlassTarget } from '@/store/glassTuning';
import { useTheme, useThemeMode } from '@/theme';

export type GlassVariant = 'regular' | 'prominent' | 'subtle';
export interface GlassMaterial {
  radius?: number;
  radiusTopLeft?: number;
  radiusTopRight?: number;
  radiusBottomLeft?: number;
  radiusBottomRight?: number;
  variant?: GlassVariant;
  tint?: string;
  enabled?: boolean;
  blurred?: boolean;
}

function materialFromStyle(style: StyleProp<ViewStyle>): GlassMaterial {
  const flat = StyleSheet.flatten(style) ?? {};
  return {
    radius: typeof flat.borderRadius === 'number' ? flat.borderRadius : 0,
    radiusTopLeft: typeof flat.borderTopLeftRadius === 'number' ? flat.borderTopLeftRadius : undefined,
    radiusTopRight: typeof flat.borderTopRightRadius === 'number' ? flat.borderTopRightRadius : undefined,
    radiusBottomLeft: typeof flat.borderBottomLeftRadius === 'number' ? flat.borderBottomLeftRadius : undefined,
    radiusBottomRight: typeof flat.borderBottomRightRadius === 'number' ? flat.borderBottomRightRadius : undefined,
    tint: typeof flat.backgroundColor === 'string' && flat.backgroundColor !== 'transparent' ? flat.backgroundColor : undefined,
  };
}

function clearFill(style: StyleProp<ViewStyle>): ViewStyle {
  return { ...StyleSheet.flatten(style), backgroundColor: 'transparent' };
}

/** Decorative material inside an existing, non-collapsible native container. */
export function GlassBackdrop({
  radius = 0, radiusTopLeft, radiusTopRight, radiusBottomLeft, radiusBottomRight,
  tint, enabled = true, blurred = true,
}: GlassMaterial) {
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const overrides = useGlassTuning((s) => s.overrides.controls);
  const mode = useGlassTuning((s) => s.mode);
  if (!enabled) return null;
  const profile = resolveGlassProfile('controls', dark, overrides, mode);
  const shape = { borderRadius: radius, borderTopLeftRadius: radiusTopLeft, borderTopRightRadius: radiusTopRight,
    borderBottomLeftRadius: radiusBottomLeft, borderBottomRightRadius: radiusBottomRight };
  return isLiquidGlassAvailable ? (
    <LiquidGlassView pointerEvents="none" style={StyleSheet.absoluteFill}
      radius={radius} radiusTopLeft={radiusTopLeft} radiusTopRight={radiusTopRight}
      radiusBottomLeft={radiusBottomLeft} radiusBottomRight={radiusBottomRight}
      blur={blurred ? profile.blur : 0}
      refraction={profile.refraction} refractionHeight={profile.refractionHeight}
      highlightWidth={profile.highlightWidth} highlightOpacity={profile.highlightOpacity}
      depthEffect={profile.depthEffect} chromaticAberration={profile.chromaticAberration}
      tintColor={profile.tintColor ?? tint ?? colors.surface} tintOpacity={profile.tintOpacity} dark={dark} enabled />
  ) : (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { backgroundColor: tint ?? colors.surface }]} />
  );
}

/** Clear bottom chrome; contrast is supported by the scroll edge behind it. */
type FloatingGlassProps = Pick<GlassMaterial, 'radius' | 'tint' | 'blurred'> & {
  appearance?: 'bar' | 'selection';
  target?: Exclude<GlassTarget, 'controls'>;
  dockProgress?: SharedValue<number>;
  dockExpandedWidth?: number;
  dockCompactWidth?: number;
  dockCompactHeight?: number;
  dockCompactOffsetX?: number;
};

export function FloatingGlassBackdrop({ radius, tint, blurred = true, appearance = 'bar', target = 'navigation',
  dockProgress, dockExpandedWidth, dockCompactWidth, dockCompactHeight, dockCompactOffsetX }: FloatingGlassProps) {
  const host = useSharedValue(0);
  const previous = useSharedValue<number[]>([]);
  // The native material and its RN foreground consume this mapper's progress.
  useAnimatedReaction(() => dockProgress ? [host.get(), Math.max(0, Math.min(1, dockProgress.get()))] : null, (state) => {
    if (!state || !updateNativeDockProgress || state[0] <= 0) return;
    const last = previous.get();
    if (last[0] === state[0] && last[1] === state[1]) return;
    updateNativeDockProgress(state[0], state[1]);
    previous.set(state);
  }, [dockProgress]);
  const fallbackDockStyle = useAnimatedStyle(() => {
    if (!dockProgress || dockExpandedWidth === undefined || dockCompactWidth === undefined) return {};
    const p = Math.max(0, Math.min(1, dockProgress.get()));
    return { width: dockExpandedWidth + (dockCompactWidth - dockExpandedWidth) * p,
      left: (dockCompactOffsetX ?? 0) * p, right: undefined };
  }, [dockProgress, dockExpandedWidth, dockCompactWidth, dockCompactOffsetX]);
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const overrides = useGlassTuning((s) => s.overrides[target]);
  const mode = useGlassTuning((s) => s.mode);
  const profile = resolveGlassProfile(target, dark, overrides, mode);
  // The mini's transparent RGBA also prevents the native no-frame fallback
  // from adding a fill before its first backdrop image arrives.
  // A translucent selector floats within one glass surface, avoiding stacked glass.
  if (appearance === 'selection' && target !== 'miniPlayer') {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
      borderRadius: radius, backgroundColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
    }]} />;
  }
  return (
    isLiquidGlassAvailable ? (
        <LiquidGlassView pointerEvents="none" style={StyleSheet.absoluteFill}
          preferUnblurredBackdrop={target === 'miniPlayer' && blurred}
          dockCompactWidth={dockCompactWidth} dockCompactHeight={dockCompactHeight} dockCompactOffsetX={dockCompactOffsetX}
          onMotionHostReady={dockProgress ? (event) => host.set(event.nativeEvent.hostId) : undefined}
          radius={radius} blur={blurred ? profile.blur : 0} refraction={blurred ? profile.refraction : 0}
          refractionHeight={blurred ? profile.refractionHeight : 0}
          highlightWidth={profile.highlightWidth} highlightOpacity={profile.highlightOpacity}
          depthEffect={profile.depthEffect} chromaticAberration={profile.chromaticAberration}
          tintColor={target === 'miniPlayer' ? 'transparent' : profile.tintColor ?? tint ?? colors.surface}
          tintOpacity={target === 'miniPlayer' ? 0 : blurred ? profile.tintOpacity : 1}
          dark={dark} enabled />
      ) : (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fallbackDockStyle, {
          borderRadius: radius, backgroundColor: target === 'miniPlayer' ? 'transparent' : tint ?? colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: dark ? 'rgba(255,255,255,0.23)' : 'rgba(255,255,255,0.90)',
        }]} />
      )
  );
}

export const GlassSurface = forwardRef<View, ViewProps & GlassMaterial>(function GlassSurface({
  radius, radiusTopLeft, radiusTopRight, radiusBottomLeft, radiusBottomRight, variant, tint,
  enabled = true, blurred, style, children, ...props
}, ref) {
  const material = materialFromStyle(style);
  return (
    <View {...props} ref={ref} collapsable={false} style={enabled ? clearFill(style) : style}>
      <GlassBackdrop {...material} radius={radius ?? material.radius}
        radiusTopLeft={radiusTopLeft ?? material.radiusTopLeft} radiusTopRight={radiusTopRight ?? material.radiusTopRight}
        radiusBottomLeft={radiusBottomLeft ?? material.radiusBottomLeft} radiusBottomRight={radiusBottomRight ?? material.radiusBottomRight}
        variant={variant} tint={tint ?? material.tint} enabled={enabled} blurred={blurred} />
      {children}
    </View>
  );
});

const MATERIAL_PROPS: (keyof GlassMaterial)[] = [
  'radius', 'radiusTopLeft', 'radiusTopRight', 'radiusBottomLeft', 'radiusBottomRight',
  'variant', 'tint', 'enabled', 'blurred',
];

/** Preserve caller compatibility while rendering buttons with their original native styles. */
export const GlassPressable = forwardRef<View, PressableProps & GlassMaterial>(function GlassPressable(props, ref) {
  const nativeProps = { ...props };
  for (const key of MATERIAL_PROPS) delete nativeProps[key];
  return <Pressable {...nativeProps} ref={ref} />;
});

export const GlassTextInput = forwardRef<TextInput, TextInputProps>(function GlassTextInput({ style, ...props }, ref) {
  const flat = StyleSheet.flatten(style) ?? {};
  // Embedded text fields use the material on their original container.
  if ((!flat.backgroundColor || flat.backgroundColor === 'transparent') && flat.borderRadius === undefined) {
    return <TextInput {...props} ref={ref} style={style} />;
  }
  const { margin, marginTop, marginRight, marginBottom, marginLeft, marginHorizontal, marginVertical,
    flex, flexGrow, flexShrink, flexBasis, alignSelf, width, maxWidth, minWidth, ...inputStyle } = flat;
  const material = materialFromStyle(flat);
  return (
    <GlassSurface {...material} variant="subtle" style={{ margin, marginTop, marginRight, marginBottom, marginLeft,
      marginHorizontal, marginVertical, flex, flexGrow, flexShrink, flexBasis, alignSelf, width, maxWidth, minWidth }}>
      <TextInput {...props} ref={ref} style={[inputStyle, { backgroundColor: 'transparent' }]} />
    </GlassSurface>
  );
});

export function GlassSwitch(props: SwitchProps) {
  return <Switch {...props} />;
}

export function GlassSlider(props: SliderProps) {
  return <Slider {...props} />;
}

/** Original safe-area layout without an added scene or background. */
export const GlassScreen = forwardRef<View, SafeAreaViewProps>(function GlassScreen(props, ref) {
  return <SafeAreaView {...props} ref={ref} />;
});
