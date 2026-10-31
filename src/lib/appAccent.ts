/** App accent follows the existing small-artwork color cache, never a second decoder. */
export type AccentSource = 'manual' | 'artwork';
export function normalizeAccentSource(value: unknown): AccentSource {
  return value === 'artwork' ? 'artwork' : 'manual';
}

type Appearance = 'light' | 'dark';
interface AccentRequest {
  /** Includes profile and song ownership; URLs alone are not an account boundary. */
  identity: string;
  uri?: string;
  mode: Appearance;
  enabled: boolean;
}

/** No timer: a warmed cover applies in the same update that selects the track. */
export function createAppAccentFollower(deps: {
  cached: (uri: string, mode: Appearance) => string | undefined;
  read: (uri: string, mode: Appearance) => Promise<string | null>;
  publish: (color: string | null) => void;
}) {
  let generation = 0;
  let signature = '';
  let published: string | null | undefined;
  const publish = (color: string | null) => {
    const valid = color && /^#[\da-f]{6}$/i.test(color) ? color : null;
    if (valid === published) return;
    published = valid;
    deps.publish(valid);
  };
  const suspend = () => { generation++; signature = ''; };
  return {
    update(request: AccentRequest) {
      if (!request.enabled || !request.uri) {
        suspend(); publish(null); return;
      }
      const key = JSON.stringify([request.identity, request.uri, request.mode]);
      if (signature === key) return;
      signature = key;
      const token = ++generation;
      const cached = deps.cached(request.uri, request.mode);
      if (cached) { publish(cached); return; }
      // Keep the current applied color while the next cover's shared read is pending.
      void deps.read(request.uri, request.mode).then((color) => {
        if (generation !== token) return;
        publish(color);
        if (!color) signature = ''; // Failed artwork remains retryable on a later update.
      }, () => {
        if (generation !== token) return;
        publish(null); signature = '';
      });
    },
    /** Backgrounding stops late publication without flashing back to a manual color. */
    suspend,
    /** Account/source changes must not inherit another profile's sampled color. */
    clear() { suspend(); publish(null); },
  };
}
