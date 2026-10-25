/**
 * Global font defaults and Android system text weight. An explicit, adjusted
 * weight lets RN measure and draw the same typeface; leaving this to TextView
 * alone clips text because RN's separate measuring paint misses the setting.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { createElement, forwardRef, useSyncExternalStore, type ComponentRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';

import { adjustedFontWeight, preservesFontWeight } from '@/lib/fontWeight';
import { getSystemFontWeightAdjustment, initSystemTypography, subscribeSystemFontWeightAdjustment } from '@/lib/systemTypography';

let currentFamily: string | undefined;
let publishedFamily: string | undefined;
const familyListeners = new Set<() => void>();
let injected: TextStyle | null = null;
let installed = false;

function rebuildInjected(): void {
  const base: TextStyle = {};
  if (currentFamily) base.fontFamily = currentFamily;
  // Imported single-face fonts and icons retain the previous explicit weight.
  if (Platform.OS === 'android') base.fontWeight = 'normal';
  injected = Object.keys(base).length > 0 ? base : null;
}

rebuildInjected();

/** Called by the root render; this setter does not publish React updates. */
export function setAppFont(family: string | undefined): void {
  const next = family || undefined;
  if (next === currentFamily) return;
  currentFamily = next;
  rebuildInjected();
}

/** Publish only after the root commits, so render never updates other text. */
export function publishAppFont(): void {
  if (publishedFamily === currentFamily) return;
  publishedFamily = currentFamily;
  for (const listener of [...familyListeners]) listener();
}

function typographySnapshot(): string {
  // A primitive snapshot stays equal between reads and also tracks family
  // changes in labels whose parents are memoized or kept behind a route.
  return `${currentFamily ?? ''}:${getSystemFontWeightAdjustment()}`;
}

function subscribeTypography(listener: () => void): () => void {
  familyListeners.add(listener);
  const stopWeight = subscribeSystemFontWeightAdjustment(listener);
  return () => {
    familyListeners.delete(listener);
    stopWeight();
  };
}

function textStyle(style: TextProps['style'], adjustment: number): TextProps['style'] {
  const own = StyleSheet.flatten(style);
  const family = own?.fontFamily ?? currentFamily;
  if (preservesFontWeight(family)) return [injected, style];
  return [injected, style, {
    fontWeight: adjustedFontWeight(own?.fontWeight, adjustment) as TextStyle['fontWeight'],
  }];
}

// Subscribe at the actual native Text boundary. Memoized labels refresh when
// system bold text changes, while Animated.Text does not apply the weight twice.
// createElement bypasses our JSX wrapper; forwarded refs still point at RN views.
const SystemText = forwardRef<ComponentRef<typeof Text>, TextProps>(function SystemText(props, ref) {
  useSyncExternalStore(subscribeTypography, typographySnapshot, typographySnapshot);
  const adjustment = getSystemFontWeightAdjustment();
  return createElement(Text, { ...props, ref, style: textStyle(props.style, adjustment) });
});

const SystemTextInput = forwardRef<ComponentRef<typeof TextInput>, TextInputProps>(function SystemTextInput(props, ref) {
  useSyncExternalStore(subscribeTypography, typographySnapshot, typographySnapshot);
  const adjustment = getSystemFontWeightAdjustment();
  return createElement(TextInput, { ...props, ref, style: textStyle(props.style, adjustment) });
});

function wrapJsx(orig: (...args: any[]) => any) {
  return function wrapped(type: unknown, props: any, ...rest: any[]) {
    if ((type === Text || type === TextInput) && props) {
      if (Platform.OS === 'android') type = type === Text ? SystemText : SystemTextInput;
      else if (injected) props = { ...props, style: [injected, props.style] };
    }
    return orig(type, props, ...rest);
  };
}

function patchRuntime(rt: any): void {
  if (!rt) return;
  if (typeof rt.jsx === 'function') rt.jsx = wrapJsx(rt.jsx);
  if (typeof rt.jsxs === 'function') rt.jsxs = wrapJsx(rt.jsxs);
  if (typeof rt.jsxDEV === 'function') rt.jsxDEV = wrapJsx(rt.jsxDEV);
}

/** Literal requires are needed by Metro; install once before root rendering. */
export function installAppFont(): void {
  if (installed) return;
  installed = true;
  initSystemTypography();
  try {
    patchRuntime(require('react/jsx-runtime'));
  } catch {
    // This runtime may be absent in a test environment.
  }
  try {
    patchRuntime(require('react/jsx-dev-runtime'));
  } catch {
    // Production does not require the development runtime.
  }
}
