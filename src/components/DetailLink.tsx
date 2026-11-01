import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

import { useDetailNavigation } from '@/hooks/useDetailNavigation';
import type { DetailKind } from '@/lib/detailNavigation';

type Props = Omit<ComponentProps<typeof Link>, 'href' | 'push' | 'replace' | 'dismissTo' | 'dangerouslySingular'>
  & { kind: DetailKind; id: string };

/** Keep Link accessibility, child handlers and web links; native revisits use an exact POP. */
export function DetailLink({ kind, id, onPress, ...props }: Props) {
  const open = useDetailNavigation();
  return <Link {...props} href={{ pathname: kind === 'artist' ? '/artist/[id]' : '/album/[id]', params: { id } }}
    onPress={(event) => {
      onPress?.(event);
      if (Platform.OS === 'web' || event.defaultPrevented) return;
      event.preventDefault();
      open({ kind, id });
    }} />;
}
