/** Foreground admission only. The storage service owns the durable daily claim. */
export function createPodcastMaintenanceScheduler(options: {
  foreground(): boolean;
  run(signal: AbortSignal): Promise<unknown>;
  now?: () => number;
  delayMs?: number;
  schedule?: (work: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const now = options.now ?? Date.now, delay = options.delayMs ?? 5000;
  const schedule = options.schedule ?? ((work: () => void, wait: number) => setTimeout(work, wait) as ReturnType<typeof setTimeout>);
  const cancel = options.cancel ?? clearTimeout;
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined, lastAttempt: number | undefined;
  const stopPending = () => { if (timer !== undefined) { cancel(timer); timer = undefined; } };
  const foreground = () => {
    if (disposed || !options.foreground() || controller || timer !== undefined) return;
    if (lastAttempt !== undefined && now() - lastAttempt < 24 * 60 * 60_000) return;
    timer = schedule(() => {
      timer = undefined;
      if (disposed || !options.foreground() || controller) return;
      const request = new AbortController(); controller = request; lastAttempt = now();
      void Promise.resolve().then(() => {
        if (!disposed && !request.signal.aborted && options.foreground()) return options.run(request.signal);
      }).catch(() => {}).finally(() => { if (controller === request) controller = undefined; });
    }, delay);
  };
  return {
    foreground,
    background() { stopPending(); controller?.abort(); },
    dispose() { disposed = true; stopPending(); controller?.abort(); },
  };
}
