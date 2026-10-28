/** Material only: original controls own layout, colors and interactions. */
import Slider, { type SliderProps } from '@react-native-community/slider';
import { forwardRef } from 'react';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import {
  Pressable, StyleSheet, Switch, TextInput, View,
  type ColorValue, type PressableProps, type StyleProp, type SwitchProps, type TextInputProps,
  type ViewProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';

import { LiquidGlassView, LiquidGlassToggle, LiquidGlassSlider, isLiquidGlassAvailable, isGlassThemeTraceEnabled, updateNativeDockProgress, updateNativeButtonMotion } from '../../../modules/liquid-glass';
import { resolveGlassProfile, sanitizeGlassOverrides, useGlassTuning, type GlassTarget } from '@/store/glassTuning';
import { useTheme, useThemeMode } from '@/theme';
import { getKyantGlassProfile } from '@/theme/glassDefaults';
import { glassMaterialTuningMask } from '@/lib/glassMaterialTuning';
import { traceResolvedGlassTheme } from '@/lib/glassThemeTrace';
import { GLASS_SWITCH_SIZE } from '@/lib/glassSwitchSize';
import { DynamicGlassBackdrop } from './StaticGlassBackdropContext';

export type GlassVariant = 'regular' | 'prominent' | 'subtle' | 'button';
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
  /** Explicit source for ordinary cards on a known flat page; never inferred globally. */
  staticBackdropColor?: ColorValue | null;
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
  variant = 'regular', tint, enabled = true, blurred = true, staticBackdropColor = null,
}: GlassMaterial) {
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const overrides = useGlassTuning((s) => s.mode === 'amPlus' ? s.amPlusOverrides.controls : s.overrides.controls);
  const mode = useGlassTuning((s) => s.mode);
  if (!enabled) return null;
  const kyantDefaults = mode === 'kyantDefault' || mode === 'amPlus';
  const materialPreset = kyantDefaults ? (variant === 'prominent' ? 'dialog' : 'button') : 'custom';
  const baseProfile = getKyantGlassProfile(variant === 'prominent' ? 'dialog' : 'button', dark);
  const amPlusOverrides = mode === 'amPlus' ? sanitizeGlassOverrides(overrides) : {};
  const tuningMask = mode === 'amPlus' ? glassMaterialTuningMask(amPlusOverrides) : 0;
  const profile = mode === 'amPlus'
    ? { ...baseProfile, ...amPlusOverrides, tintColor: amPlusOverrides.tintColor ?? baseProfile.tintColor }
    : kyantDefaults ? baseProfile : resolveGlassProfile('controls', dark, overrides, mode);
  const buttonTint = kyantDefaults && variant === 'button' && !('tintColor' in amPlusOverrides) ? tint : undefined;
  // An untinted stock surface has a transparent default. Once its opacity is
  // explicitly raised, Automatic tint uses the existing control/page color.
  const automaticTunedTint = mode === 'amPlus' && 'tintOpacity' in amPlusOverrides
    && (profile.tintColor == null || profile.tintColor === 'transparent')
    ? tint ?? colors.surface : profile.tintColor;
  const shape = { borderRadius: radius, borderTopLeftRadius: radiusTopLeft, borderTopRightRadius: radiusTopRight,
    borderBottomLeftRadius: radiusBottomLeft, borderBottomRightRadius: radiusBottomRight };
  return isLiquidGlassAvailable ? (
    <LiquidGlassView pointerEvents="none" style={StyleSheet.absoluteFill}
      materialPreset={materialPreset} materialTuningMask={tuningMask}
      staticBackdropColor={variant === 'regular' ? staticBackdropColor : null}
      radius={radius} radiusTopLeft={radiusTopLeft} radiusTopRight={radiusTopRight}
      radiusBottomLeft={radiusBottomLeft} radiusBottomRight={radiusBottomRight}
      blur={blurred ? profile.blur : 0}
      refraction={profile.refraction} refractionHeight={profile.refractionHeight}
      highlightWidth={profile.highlightWidth} highlightOpacity={profile.highlightOpacity}
      depthEffect={profile.depthEffect} chromaticAberration={profile.chromaticAberration}
      tintColor={buttonTint ?? (kyantDefaults ? automaticTunedTint ?? 'transparent' : profile.tintColor ?? tint ?? colors.surface)}
      tintOpacity={buttonTint && !(tuningMask & 32) ? 0.75 : profile.tintOpacity} dark={dark} enabled />
  ) : (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { backgroundColor: tint ?? colors.surface }]} />
  );
}

/** Floating control material; layout and foreground stay with the RN control. */
type FloatingGlassProps = Pick<GlassMaterial, 'radius' | 'tint' | 'blurred'> & {
  appearance?: 'bar' | 'selection';
  target?: Exclude<GlassTarget, 'controls'>;
  dockProgress?: SharedValue<number>;
  dockExpandedWidth?: number;
  dockCompactWidth?: number;
  dockCompactHeight?: number;
  dockCompactOffsetX?: number;
  dockRole?: 'mini' | 'navigation' | 'search';
  dockRowWidth?: number;
  buttonPressProgress?: SharedValue<number>;
  buttonPressX?: SharedValue<number>;
  buttonPressY?: SharedValue<number>;
};

export function FloatingGlassBackdrop({ radius, tint, blurred = true, appearance = 'bar', target = 'navigation',
  dockProgress, dockExpandedWidth, dockCompactWidth, dockCompactHeight, dockCompactOffsetX, dockRole, dockRowWidth,
  buttonPressProgress, buttonPressX, buttonPressY }: FloatingGlassProps) {
  const mode = useGlassTuning((s) => s.mode);
  const amPlus = mode === 'amPlus';
  const host = useSharedValue(0);
  const previous = useSharedValue<number[]>([]);
  const previousPress = useSharedValue<number[]>([]);
  // The native material and its RN foreground consume this mapper's progress.
  useAnimatedReaction(() => dockProgress ? [host.get(), Math.max(amPlus ? -0.09 : 0, Math.min(amPlus ? 1.09 : 1, dockProgress.get()))] : null, (state) => {
    if (!state || !updateNativeDockProgress || state[0] <= 0) return;
    const last = previous.get();
    if (last[0] === state[0] && last[1] === state[1]) return;
    updateNativeDockProgress(state[0], state[1]);
    previous.set(state);
  }, [dockProgress, amPlus]);
  useAnimatedReaction(() => amPlus && buttonPressProgress ? [host.get(), buttonPressProgress.get(),
    buttonPressX?.get() ?? 0, buttonPressY?.get() ?? 0] : null, (state) => {
    if (!state || !updateNativeButtonMotion || state[0] <= 0) return;
    const last = previousPress.get();
    if (last.length === state.length && state.every((value, index) => last[index] === value)) return;
    updateNativeButtonMotion(state[0], state[1], state[2], state[3]);
    previousPress.set(state);
  }, [amPlus, buttonPressProgress, buttonPressX, buttonPressY]);
  const fallbackDockStyle = useAnimatedStyle(() => {
    if (!dockProgress || dockExpandedWidth === undefined || dockCompactWidth === undefined) return {};
    const p = Math.max(0, Math.min(1, dockProgress.get()));
    return { width: dockExpandedWidth + (dockCompactWidth - dockExpandedWidth) * p,
      left: (dockCompactOffsetX ?? 0) * p, right: undefined };
  }, [dockProgress, dockExpandedWidth, dockCompactWidth, dockCompactOffsetX]);
  const colors = useTheme();
  const dark = useThemeMode() === 'dark';
  const overrides = useGlassTuning((s) => s.mode === 'amPlus' ? s.amPlusOverrides[target] : s.overrides[target]);
  const kyantDefaults = mode === 'kyantDefault' || amPlus;
  const profile = resolveGlassProfile(target, dark, overrides, mode);
  // The mini's transparent RGBA also prevents the native no-frame fallback
  // from adding a fill before its first backdrop image arrives.
  // A translucent selector floats within one glass surface, avoiding stacked glass.
  if (appearance === 'selection' && target !== 'miniPlayer') {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
      borderRadius: radius, backgroundColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
    }]} />;
  }
  const materialTint = kyantDefaults ? profile.tintColor ?? 'transparent'
    : target === 'miniPlayer' ? 'transparent' : profile.tintColor ?? tint ?? colors.surface;
  const materialOpacity = kyantDefaults ? (blurred ? profile.tintOpacity : 1)
    : target === 'miniPlayer' ? 0 : blurred ? profile.tintOpacity : 1;
  if (isGlassThemeTraceEnabled) {
    traceResolvedGlassTheme(target, dockRole ?? (target === 'miniPlayer' ? 'mini' : 'navigation'),
      mode, dark, materialTint, materialOpacity);
  }
  return (
    isLiquidGlassAvailable ? (
        <LiquidGlassView pointerEvents="none" style={StyleSheet.absoluteFill}
          materialPreset={amPlus ? 'amPlus' : kyantDefaults ? (target === 'miniPlayer' ? 'button' : 'tabs') : 'custom'}
          materialTuningMask={amPlus ? glassMaterialTuningMask(overrides) : 0}
          preferUnblurredBackdrop={!kyantDefaults && target === 'miniPlayer' && blurred}
          dockCompactWidth={dockCompactWidth} dockCompactHeight={dockCompactHeight} dockCompactOffsetX={dockCompactOffsetX}
          dockRole={dockRole ?? (target === 'miniPlayer' ? 'mini' : 'navigation')} dockRowWidth={dockRowWidth}
          onMotionHostReady={dockProgress || buttonPressProgress ? (event) => host.set(event.nativeEvent.hostId) : undefined}
          radius={radius} blur={blurred ? profile.blur : 0} refraction={blurred ? profile.refraction : 0}
          refractionHeight={blurred ? profile.refractionHeight : 0}
          highlightWidth={profile.highlightWidth} highlightOpacity={profile.highlightOpacity}
          depthEffect={profile.depthEffect} chromaticAberration={profile.chromaticAberration}
          tintColor={materialTint} tintOpacity={materialOpacity}
          dark={dark} enabled />
      ) : (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fallbackDockStyle, {
          borderRadius: radius, backgroundColor: amPlus ? profile.tintColor ?? colors.surface
            : target === 'miniPlayer' ? 'transparent' : tint ?? colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: dark ? 'rgba(255,255,255,0.23)' : 'rgba(255,255,255,0.90)',
        }]} />
      )
  );
}

export const GlassSurface = forwardRef<View, ViewProps & GlassMaterial>(function GlassSurface({
  radius, radiusTopLeft, radiusTopRight, radiusBottomLeft, radiusBottomRight, variant, tint,
  enabled = true, blurred, staticBackdropColor, style, children, ...props
}, ref) {
  const material = materialFromStyle(style);
  return (
    <View {...props} ref={ref} collapsable={false} style={enabled ? clearFill(style) : style}>
      <GlassBackdrop {...material} radius={radius ?? material.radius}
        radiusTopLeft={radiusTopLeft ?? material.radiusTopLeft} radiusTopRight={radiusTopRight ?? material.radiusTopRight}
        radiusBottomLeft={radiusBottomLeft ?? material.radiusBottomLeft} radiusBottomRight={radiusBottomRight ?? material.radiusBottomRight}
        variant={variant} tint={tint ?? material.tint} enabled={enabled} blurred={blurred}
        staticBackdropColor={staticBackdropColor} />
      {/* A card's contents are foreground, rather than the page's plain backdrop. */}
      <DynamicGlassBackdrop>{children}</DynamicGlassBackdrop>
    </View>
  );
});

const MATERIAL_PROPS: (keyof GlassMaterial)[] = [
  'radius', 'radiusTopLeft', 'radiusTopRight', 'radiusBottomLeft', 'radiusBottomRight',
  'variant', 'tint', 'enabled', 'blurred', 'staticBackdropColor',
];

type GlassPressableProps = PressableProps & GlassMaterial & {
  /** Retained for caller compatibility; all buttons now keep their original presentation. */
  buttonMaterial?: boolean;
};

/** Restore the original button styles; switches, sliders and surfaces stay glass. */
export const GlassPressable = forwardRef<View, GlassPressableProps>(function GlassPressable(props, ref) {
  const nativeProps = { ...props };
  for (const key of MATERIAL_PROPS) delete nativeProps[key];
  delete nativeProps.buttonMaterial;
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

export function GlassSwitch({
  value = false, disabled, onValueChange, onChange, style,
  trackColor, thumbColor, ios_backgroundColor, ...viewProps
}: SwitchProps) {
  const dark = useThemeMode() === 'dark';
  if (!isLiquidGlassAvailable) {
    return (
      <View collapsable={false} style={[switchStyles.frame, style]}>
        <Switch {...viewProps} style={switchStyles.control} value={value} disabled={disabled}
          onValueChange={onValueChange} onChange={onChange}
          trackColor={trackColor} thumbColor={thumbColor} ios_backgroundColor={ios_backgroundColor} />
      </View>
    );
  }
  return (
    <View {...viewProps} collapsable={false} style={[switchStyles.frame, style]}>
      <LiquidGlassToggle style={switchStyles.control} value={value} disabled={disabled} dark={dark}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        accessible={viewProps.accessible}
        accessibilityLabel={viewProps.accessibilityLabel}
        accessibilityElementsHidden={viewProps.accessibilityElementsHidden}
        importantForAccessibility={viewProps.importantForAccessibility}
        onValueChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.nativeEvent.value);
        }} />
    </View>
  );
}

const switchStyles = StyleSheet.create({
  frame: {
    width: GLASS_SWITCH_SIZE.width,
    height: GLASS_SWITCH_SIZE.touchHeight,
    minHeight: GLASS_SWITCH_SIZE.touchHeight,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  control: {
    position: 'absolute',
    width: GLASS_SWITCH_SIZE.nativeWidth,
    height: GLASS_SWITCH_SIZE.nativeHeight,
    // Native hit testing applies the inverse matrix, so its 20dp drag travel,
    // cancellation and optical recipe continue using catalog coordinates.
    transform: [{ scale: GLASS_SWITCH_SIZE.scale }],
  },
});

export function GlassSlider({
  style, value, minimumValue, maximumValue, step, disabled, activeTrackTintColor,
  onValueChange, onSlidingStart, onSlidingComplete, onSlidingCancel,
  accessibilityLabel, accessibilityHint, accessibilityElementsHidden,
  importantForAccessibility, testID, ...fallbackProps
}: SliderProps & { onSlidingCancel?: () => void; activeTrackTintColor?: ColorValue | null }) {
  const dark = useThemeMode() === 'dark';
  if (!isLiquidGlassAvailable) {
    return <Slider {...fallbackProps} minimumTrackTintColor={typeof activeTrackTintColor === 'string' ? activeTrackTintColor : fallbackProps.minimumTrackTintColor} style={style} value={value} minimumValue={minimumValue}
      maximumValue={maximumValue} step={step} disabled={disabled} testID={testID}
      accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility={importantForAccessibility}
      onValueChange={onValueChange} onSlidingStart={onSlidingStart} onSlidingComplete={onSlidingComplete} />;
  }
  return (
    <View collapsable={false} style={[{ height: 48, minHeight: 48, alignSelf: 'stretch' }, style]} testID={testID}>
      <LiquidGlassSlider style={StyleSheet.absoluteFill} value={value} minimumValue={minimumValue}
        maximumValue={maximumValue} step={step} disabled={disabled} dark={dark}
        activeTrackTintColor={activeTrackTintColor}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => true}
        accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}
        accessibilityElementsHidden={accessibilityElementsHidden}
        importantForAccessibility={importantForAccessibility}
        onValueChange={(event) => onValueChange?.(event.nativeEvent.value)}
        onSlidingStart={(event) => onSlidingStart?.(event.nativeEvent.value)}
        onSlidingComplete={(event) => onSlidingComplete?.(event.nativeEvent.value)}
        onSlidingCancel={onSlidingCancel} />
    </View>
  );
}

/** Original safe-area layout without an added scene or background. */
export const GlassScreen = forwardRef<View, SafeAreaViewProps>(function GlassScreen(props, ref) {
  return <SafeAreaView {...props} ref={ref} />;
});
