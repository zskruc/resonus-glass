/** Keep catalog coordinates/material intact while giving every row 10dp back. */
const nativeWidth = 64;
const width = 54;
const touchHeight = 44;
const scale = width / nativeWidth;

export const GLASS_SWITCH_SIZE = {
  width,
  touchHeight,
  nativeWidth,
  // Scaling the original 48dp host directly would shrink touch height below
  // 44dp. Expand its invisible vertical bounds before the common transform.
  nativeHeight: touchHeight / scale,
  scale,
} as const;
