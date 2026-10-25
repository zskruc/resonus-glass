/**
 * LiquidButton layer motion adapted from Kyant0/AndroidLiquidGlass,
 * catalog/components/LiquidButton.kt (Apache-2.0).
 * See modules/liquid-glass/ANDROID_LIQUID_GLASS_LICENSE.
 */
export function getGlassButtonMotion(width: number, height: number, progress: number, x: number, y: number) {
  'worklet';
  if (width <= 0 || height <= 0) return { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const minDimension = Math.min(width, height);
  const maxDimension = Math.max(width, height);
  const scale = 1 + (4 / height) * progress;
  const angle = Math.atan2(y, x);
  const dragScale = 4 / height;
  return {
    x: minDimension * Math.tanh(0.05 * x / minDimension),
    y: minDimension * Math.tanh(0.05 * y / minDimension),
    scaleX: scale + dragScale * Math.abs(Math.cos(angle) * x / maxDimension) * Math.min(width / height, 1),
    scaleY: scale + dragScale * Math.abs(Math.sin(angle) * y / maxDimension) * Math.min(height / width, 1),
  };
}
