import { requireOptionalNativeModule } from 'expo';
import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';

export type BackgroundJobOwner = 'music' | 'media-cache';
export interface BackgroundProgress {
  /** Processed units, including failed units. */
  completed: number;
  total: number;
  /** Failed units are a subset of completed. */
  failed: number;
  bytesDone?: number;
  bytesTotal?: number;
  locale: 'zh' | 'en';
}
export interface BackgroundJobReference { owner: BackgroundJobOwner; runId: string; token: string }
export interface BackgroundInterruption {
  id: string;
  reason: 'pause' | 'cancel' | 'timeout' | 'service-destroyed' | 'start-failed' | 'runtime-stopped' | 'runtime-unavailable'
    | 'network-mismatch' | 'network-unavailable';
  leases: BackgroundJobReference[];
}
export type BackgroundStartResult = { ok: true; token: string; sessionId: string; headlessActive: boolean }
  | { ok: false; reason: string };
export interface BackgroundStatus {
  supported: boolean;
  running: boolean;
  starting: boolean;
  sessionId: string | null;
  headlessActive: boolean;
  wakeLockHeld: boolean;
  runnerType?: 'uidt' | 'foreground-service' | null;
  notificationPermissionGranted: boolean;
  jobs: (BackgroundJobReference & { progress: BackgroundProgress })[];
}
type Subscription = { remove(): void };
interface NativeBackgroundDownloads {
  startJob(owner: BackgroundJobOwner, runId: string, progress: BackgroundProgress): Promise<BackgroundStartResult>;
  updateJob(token: string, progress: BackgroundProgress): Promise<boolean>;
  stopJob(token: string): Promise<boolean>;
  stopPendingJob(owner: BackgroundJobOwner, runId: string): Promise<boolean>;
  getStatus(): Promise<BackgroundStatus>;
  drainInterruptions(): Promise<BackgroundInterruption[]>;
  waitForSession(sessionId: string): Promise<void>;
  wait(delayMs: number): Promise<void>;
  addListener(event: 'onInterrupted', listener: (event: BackgroundInterruption) => void): Subscription;
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<NativeBackgroundDownloads>('ResonusBackgroundDownloads') : null;
export const isSupported = native !== null;
export const supported = isSupported;

if (native) {
  // Android's RN Timing module stops background timers unless a Headless task
  // is active. This task uses the existing runtime and completes at the native
  // transfer session boundary, including a stop before task dispatch.
  AppRegistry.registerHeadlessTask('ResonusBackgroundDownloadsSession', () => async (data: { sessionId: string }) => {
    await native.waitForSession(data.sessionId);
  });
}

export function startJob(owner: BackgroundJobOwner, runId: string, progress: BackgroundProgress): Promise<BackgroundStartResult> {
  return native?.startJob(owner, runId, progress) ?? Promise.resolve({ ok: false, reason: 'unsupported' });
}
export function updateJob(token: string, progress: BackgroundProgress): Promise<boolean> {
  return native?.updateJob(token, progress) ?? Promise.resolve(false);
}
export function stopJob(token: string): Promise<boolean> { return native?.stopJob(token) ?? Promise.resolve(false); }
export function stopPendingJob(owner: BackgroundJobOwner, runId: string): Promise<boolean> {
  return native?.stopPendingJob(owner, runId) ?? Promise.resolve(false);
}
export function getStatus(): Promise<BackgroundStatus> {
  return native?.getStatus() ?? Promise.resolve({ supported: false, running: false, starting: false,
    sessionId: null, headlessActive: false, wakeLockHeld: false, notificationPermissionGranted: false, jobs: [] });
}
export function drainInterruptions(): Promise<BackgroundInterruption[]> { return native?.drainInterruptions() ?? Promise.resolve([]); }
export function addInterruptionListener(listener: (event: BackgroundInterruption) => void): Subscription {
  return native?.addListener('onInterrupted', listener) ?? { remove() {} };
}
/** Native Handler timers continue while React Native's ordinary JS timers are paused. */
export function delay(ms: number): Promise<void> {
  return native?.wait(ms) ?? new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(300_000, ms))));
}
/** Explicit user-flow helper; service protection itself is valid without notification permission. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!native || Number(Platform.Version) < 33) return !!native;
  return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
    === PermissionsAndroid.RESULTS.GRANTED;
}
