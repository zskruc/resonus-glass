/** A slice of Primuse's single rounded song panel, compatible with recycled rows.
 * AlbumDetailView / libraryDetailSection, chenqi92/primuse (MIT).
 * Copyright (c) 2026 Welape. See licenses/PRIMUSE-MIT.txt. */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

export function PrimuseTrackPanelRow({ first, last, children, divider = !last }: {
  first: boolean; last: boolean; divider?: boolean; children: ReactNode;
}) {
  // Each recycled occurrence paints only its own portion. A long playlist
  // retains the recycler instead of mounting its songs in a nested scroll view.
  return <View testID="primuse-track-panel-row" style={[styles.slice, first && styles.first, last && styles.last]}>
    {children}
    {divider ? <View testID="primuse-track-panel-divider" pointerEvents="none" style={styles.divider} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  slice: { backgroundColor: 'rgba(255,255,255,0.09)', borderColor: 'rgba(255,255,255,0.12)',
    borderLeftWidth: .5, borderRightWidth: .5, paddingHorizontal: 12, overflow: 'hidden' },
  first: { borderTopWidth: .5, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 4 },
  last: { borderBottomWidth: .5, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, paddingBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)' },
});
