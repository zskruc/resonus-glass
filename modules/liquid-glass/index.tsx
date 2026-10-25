import React from 'react';
import { Platform, processColor, View, type ColorValue, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeView, requireOptionalNativeModule } from 'expo';

export type LiquidGlassMaterialPreset = 'custom' | 'button' | 'tabs' | 'dialog' | 'amPlus';

export type LiquidGlassViewProps = Omit<ViewProps, 'children'> & {
  /** Official catalog material or the previous user-tuned rendering. Defaults to button. */
  materialPreset?: LiquidGlassMaterialPreset;
  /** Corner radius, in density-independent pixels. */
  radius?: number;
  /** Physical corner radii; omitted/null corners inherit radius. */
  radiusTopLeft?: number | null;
  radiusTopRight?: number | null;
  radiusBottomLeft?: number | null;
  radiusBottomRight?: number | null;
  /** Radius of the actual backdrop blur, in density-independent pixels. */
  blur?: number;
  /** Bottom scroll edge: true blur fading from transparent at the top. No lens or rim. */
  progressiveBlur?: boolean;
  /** Mini player: sample its raw ROI while the surrounding edge stays blurred. */
  preferUnblurredBackdrop?: boolean;
  /** Floating modal menu: its excluded foreground scrolling does not change the backdrop. */
  isolateModalForeground?: boolean;
  /** Edge lens refraction amount. Android 13+; Android 12 keeps blur. */
  refraction?: number;
  /** Edge lens height, in dp. Defaults to 12; custom null retains refraction * 0.65. */
  refractionHeight?: number | null;
  /** Custom highlight width in dp; official presets use Highlight.Default (0.5). */
  highlightWidth?: number;
  /** Custom highlight alpha; official presets use the library default (1). */
  highlightOpacity?: number | null;
  /** Enable depth shading in the lens shader. Defaults to false. */
  depthEffect?: boolean;
  /** Enable the library's real lens dispersion shader. Default false. */
  chromaticAberration?: boolean;
  tintColor?: ColorValue;
  /** Explicit uniform source for plain-page cards; null resumes live sampling. */
  staticBackdropColor?: ColorValue | null;
  tintOpacity?: number;
  dark?: boolean;
  enabled?: boolean;
  /** Initial native material height in dp; omitted/null/zero uses the fixed RN host. */
  dockExpandedHeight?: number;
  /** Final native material geometry inside a fixed RN host, in dp. */
  dockCompactWidth?: number;
  dockCompactHeight?: number;
  /** Final physical displacement from the fixed host's left edge, in dp. */
  dockCompactOffsetX?: number;
  /** AM++ uses different overshoot geometry for each capsule in the same row. */
  dockRole?: 'mini' | 'navigation' | 'search';
  dockRowWidth?: number;
  onMotionHostReady?: (event: NativeSyntheticEvent<{ hostId: number }>) => void;
};

type NativeProps = Omit<LiquidGlassViewProps, 'tintColor' | 'staticBackdropColor'> & {
  tintColor?: number;
  staticBackdropColor?: number | null;
};

/** Physical left-to-right tab position, independent of navigation order/RTL. */
export type LiquidGlassTabMotion = {
  tabPosition: number;
  tabPressProgress: number;
  tabScaleX: number;
  tabScaleY: number;
  tabVelocity: number;
  tabPanelOffset: number;
  tabSelectionOpacity: number;
};
type LiquidGlassTabsProps = LiquidGlassViewProps & {
  tabsCount: number;
  tabHorizontalInset: number;
  tabVerticalInset: number;
  onMotionHostReady: (event: NativeSyntheticEvent<{ hostId: number }>) => void;
};
type NativeTabsProps = NativeProps & Omit<LiquidGlassTabsProps, keyof LiquidGlassViewProps>;
type UpdateTabsMotion = (hostId: number, position: number, progress: number, scaleX: number,
  scaleY: number, velocity: number, panelOffset: number, opacity: number) => void;
type UpdateDockProgress = (hostId: number, progress: number) => void;
type UpdateButtonMotion = (hostId: number, progress: number, x: number, y: number) => void;

export type LiquidGlassDiagnostics = {
  activeWindows: number;
  activeSurfaces: number;
  registeredMotionHosts?: number;
  directMotionCalls?: number;
  directDockCalls?: number;
  windows: {
    captureCount: number;
    visibleSurfaces: number;
    sampleWidth: number;
    sampleHeight: number;
    hasFrame: boolean;
    failed: boolean;
    failureClass: string | null;
    isModal: boolean;
  }[];
};

const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<{ isSupported: boolean; getDiagnostics(): Promise<LiquidGlassDiagnostics>;
    updateTabsMotion: UpdateTabsMotion; updateDockProgress: UpdateDockProgress;
    updateButtonMotion: UpdateButtonMotion }>('ResonusLiquidGlass')
  : null;

export const isLiquidGlassAvailable = Boolean(nativeModule?.isSupported);
// Preserve the raw JSI HostFunction. Worklets shares it directly into its UI
// runtime; wrapping/binding it would create an RN-thread remote JS function.
export const updateNativeTabsMotion = nativeModule?.updateTabsMotion ?? null;
export const updateNativeDockProgress = nativeModule?.updateDockProgress ?? null;
export const updateNativeButtonMotion = nativeModule?.updateButtonMotion ?? null;

/** Debug counters only; no screen content, device identity, or saved images. */
export async function getLiquidGlassDiagnostics(): Promise<LiquidGlassDiagnostics> {
  return nativeModule?.getDiagnostics() ?? { activeWindows: 0, activeSurfaces: 0, windows: [] };
}

const NativeGlass: React.ComponentType<NativeProps> | null = nativeModule
  ? requireNativeView<NativeProps>('ResonusLiquidGlass')
  : null;

const NativeTabs = NativeGlass as React.ComponentType<NativeTabsProps> | null;

/** Native material only; original RN tabs retain their touch/accessibility. */
export function LiquidGlassTabsView({ materialPreset = 'button', tintColor = 'transparent', ...props }: LiquidGlassTabsProps) {
  if (!NativeTabs || !isLiquidGlassAvailable) {
    return <View style={props.style} pointerEvents="none" accessible={false} />;
  }
  const color = processColor(tintColor);
  const staticColor = props.staticBackdropColor == null ? null : processColor(props.staticBackdropColor);
  return <NativeTabs {...props} materialPreset={materialPreset} pointerEvents="none" accessible={false}
    staticBackdropColor={typeof staticColor === 'number' ? staticColor : null}
    tintColor={typeof color === 'number' ? color : processColor('transparent') as number} />;
}

/**
 * Decorative native backdrop. Put this directly inside a non-collapsible RN
 * wrapper, behind that wrapper's interactive children, using absoluteFill.
 */
export function LiquidGlassView({
  materialPreset = 'button',
  radius = 0,
  radiusTopLeft = null,
  radiusTopRight = null,
  radiusBottomLeft = null,
  radiusBottomRight = null,
  blur = materialPreset === 'custom' ? 14 : 2,
  progressiveBlur = false,
  preferUnblurredBackdrop = false,
  isolateModalForeground = false,
  refraction = materialPreset === 'custom' ? 18 : 24,
  refractionHeight = materialPreset === 'custom' ? null : 12,
  highlightWidth = materialPreset === 'custom' ? 0.4 : 0.5,
  highlightOpacity = null,
  depthEffect = materialPreset === 'custom',
  chromaticAberration = false,
  tintColor = materialPreset === 'custom' ? '#FFFFFF' : 'transparent',
  staticBackdropColor = null,
  tintOpacity = materialPreset === 'custom' ? 0.18 : 0,
  dark = false,
  enabled = true,
  ...viewProps
}: LiquidGlassViewProps) {
  if (!NativeGlass || !isLiquidGlassAvailable) {
    return <View {...viewProps} pointerEvents="none" accessible={false} />;
  }
  const color = processColor(tintColor);
  const staticColor = staticBackdropColor == null ? null : processColor(staticBackdropColor);
  return (
    <NativeGlass
      {...viewProps}
      pointerEvents="none"
      accessible={false}
      materialPreset={materialPreset}
      radius={radius}
      radiusTopLeft={radiusTopLeft}
      radiusTopRight={radiusTopRight}
      radiusBottomLeft={radiusBottomLeft}
      radiusBottomRight={radiusBottomRight}
      blur={blur}
      progressiveBlur={progressiveBlur}
      preferUnblurredBackdrop={preferUnblurredBackdrop}
      isolateModalForeground={isolateModalForeground}
      refraction={refraction}
      refractionHeight={refractionHeight}
      highlightWidth={highlightWidth}
      highlightOpacity={highlightOpacity}
      depthEffect={depthEffect}
      chromaticAberration={chromaticAberration}
      tintColor={typeof color === 'number' ? color : processColor('transparent') as number}
      staticBackdropColor={typeof staticColor === 'number' ? staticColor : null}
      tintOpacity={tintOpacity}
      dark={dark}
      enabled={enabled}
    />
  );
}


export type LiquidGlassToggleProps = ViewProps & {
  value: boolean;
  disabled?: boolean;
  dark?: boolean;
  onValueChange?: (event: NativeSyntheticEvent<{ value: boolean; target: number }>) => void;
};

export type LiquidGlassSliderProps = ViewProps & {
  value?: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  disabled?: boolean;
  dark?: boolean;
  onValueChange?: (event: NativeSyntheticEvent<{ value: number }>) => void;
  onSlidingStart?: (event: NativeSyntheticEvent<{ value: number }>) => void;
  onSlidingComplete?: (event: NativeSyntheticEvent<{ value: number }>) => void;
  onSlidingCancel?: (event: NativeSyntheticEvent<{ value: number }>) => void;
};

const NativeToggle = nativeModule
  ? requireNativeView<LiquidGlassToggleProps>('ResonusLiquidGlass', 'LiquidGlassToggle')
  : null;
const NativeSlider = nativeModule
  ? requireNativeView<LiquidGlassSliderProps>('ResonusLiquidGlass', 'LiquidGlassSlider')
  : null;

/** Interactive catalog control. Use a dedicated noncollapsible RN parent. */
export function LiquidGlassToggle(props: LiquidGlassToggleProps) {
  return NativeToggle && isLiquidGlassAvailable ? <NativeToggle {...props} /> : <View {...props} />;
}

/** All drag animation stays on the native UI thread; JS receives only values. */
export function LiquidGlassSlider(props: LiquidGlassSliderProps) {
  return NativeSlider && isLiquidGlassAvailable ? <NativeSlider {...props} /> : <View {...props} />;
}
