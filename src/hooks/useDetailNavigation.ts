import { router, useNavigationContainerRef } from 'expo-router';
import { useCallback } from 'react';

import { DetailNavigationController, type DetailTarget } from '@/lib/detailNavigation';

const navigation = new DetailNavigationController();

/** Read the live public container ref at the tap, rather than retaining a render-time stack. */
export function useDetailNavigation() {
  const container = useNavigationContainerRef();
  return useCallback((target: DetailTarget) => navigation.open(target, {
    getRootState: () => container.isReady() ? container.getRootState() : undefined,
    dispatch: (action) => container.dispatch(action),
    push: (href) => router.push(href),
  }), [container]);
}
