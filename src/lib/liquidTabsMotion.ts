/**
 * Kyant AndroidLiquidGlass DampedDragAnimation.release, kmp 65ab177e:
 * wait for a frame and for the selector to approach its destination before
 * releasing the enlarged lens. AM++ supplies its own pressed shape scales.
 */
export function liquidTabsPressedScales(count: number, amPlus: boolean): readonly [number, number] {
  'worklet';
  return [count <= 1 ? 1 : count === 2 ? 1.1 : amPlus ? 1.5 : 78 / 56, amPlus ? 1.45 : 78 / 56];
}

export function shouldReleaseLiquidTabsPress(
  pending: boolean, frameReady: number, dragging: boolean,
  position: number, destination: number, count: number,
): boolean {
  'worklet';
  if (!pending || frameReady < 1 || dragging || !Number.isFinite(position) || !Number.isFinite(destination)) return false;
  // A one-tab bar has no travel; upstream skips its distance wait as well.
  return Math.abs(position - destination) < Math.max(.001, Math.max(0, count - 1) * .025);
}
