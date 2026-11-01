/**
 * Whether a cover is animated (GIF, animated WebP, APNG). Nothing in the API
 * says so, and the file is not ours to sniff, so the answer comes from the
 * decoder itself: `expo-image` reports `isAnimated` once it has loaded the
 * picture, and `Cover` hands it over here.
 *
 * That makes the answer arrive one load late, so it is kept per URL: a cover
 * seen before is known before it is drawn again, and only a new one goes
 * through the plain layout for the moment it takes to decode.
 */
import { useState } from 'react';

import { BoundedCache } from '@/lib/boundedCache';

export function useAnimatedCover(uri?: string) {
  const [cache] = useState(() => new BoundedCache<string, boolean>(256));
  const [detected, setDetected] = useState({ uri, animated: false });

  // A new song is a new question: what was true of the cover before it says
  // nothing about this one, so the answer resets until either the cache or the
  // decoder gives it.
  if (detected.uri !== uri) setDetected({ uri, animated: uri ? cache.get(uri) ?? false : false });

  /**
   * The answer carries the cover it is about. A load that finishes after the
   * song has changed would otherwise be filed under whichever cover is up by
   * then, which on a fast skip is somebody else's.
   */
  const onCoverLoad = (loaded: string, animated: boolean) => {
    cache.set(loaded, animated);
    // The state updater checks the current binding, including old callbacks
    // retained by a decoder after the hook has moved to another song.
    setDetected((current) => current.uri === loaded && current.animated !== animated
      ? { uri: loaded, animated } : current);
  };

  return { isAnimated: detected.animated, onCoverLoad };
}
