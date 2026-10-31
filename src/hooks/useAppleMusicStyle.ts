import { useSettings } from '@/store/settings';

/** Layout selection is independent of the saved theme and glass recipes. */
export function useAppleMusicStyle(): boolean {
  return useSettings((state) => state.uiStyle === 'appleMusic');
}
