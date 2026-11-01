import { AppState, Platform } from 'react-native';

import * as Native from '../../modules/background-downloads';
import { useSettings } from '@/store/settings';
import { createBackgroundWorkCoordinator, type BackgroundWorkInterruption,
  type BackgroundWorkOwner, type BackgroundWorkProgress } from './backgroundWorkControl';

export type { BackgroundWorkLease, BackgroundWorkProgress, BackgroundWorkInterruption } from './backgroundWorkControl';

const coordinator = createBackgroundWorkCoordinator({
  required: Platform.OS === 'android',
  driver: Native.isSupported ? Native : undefined,
  foreground: () => AppState.currentState === 'active',
  locale: () => useSettings.getState().language,
});
let askedNotifications = false;

/** Only an explicit cache/download action acquires this; ordinary browsing never does. */
export async function acquireBackgroundWork(owner: BackgroundWorkOwner, progress: BackgroundWorkProgress,
  onInterrupted: (reason: BackgroundWorkInterruption) => void, current: () => boolean = () => true,
  signal?: AbortSignal) {
  const lease = await coordinator.acquire(owner, progress, onInterrupted, current, signal);
  // Permission affects notification visibility, not native task protection.
  // Ask after protection is live, so its dialog cannot suspend the new task.
  if (Native.isSupported && !askedNotifications && current() && AppState.currentState === 'active') {
    askedNotifications = true;
    void Native.requestNotificationPermission().catch(() => false);
  }
  return lease;
}
