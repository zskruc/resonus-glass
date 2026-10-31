import { StyleSheet } from 'react-native';

import { themed } from '@/theme';

/** Shared browse typography for the optional Volta-inspired presentation. */
export const appleMusicStyles = themed((colors) => ({
  pageHeader: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 18 },
  pageTitle: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.8 },
  sectionTitle: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.35 },
  cover: { borderRadius: 10 },
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: '500', marginTop: 4 },
  cardSubtitle: { fontSize: 13, lineHeight: 18 },
  mediaRow: { minHeight: 70, paddingVertical: 7 },
  rowInfo: { alignSelf: 'stretch', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  rowSubtitle: { fontSize: 13, lineHeight: 18 },
  settingsHeader: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 18, gap: 12 },
  settingsTitle: { flex: 1, fontSize: 28, lineHeight: 35, fontWeight: '700', letterSpacing: -0.6 },
}));
