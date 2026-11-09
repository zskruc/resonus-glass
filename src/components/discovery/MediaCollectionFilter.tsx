import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { GlassPressable } from '@/components/glass';
import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { useDiscoveryPreferences } from '@/store/discoveryPreferences';
import type { DiscoveryPreferences } from '@/lib/discoveryPreferences';
import { colors, spacing } from '@/theme';
export interface CollectionFilter { folder?: string; tag?: string }
export function matchesMediaCollection(data: DiscoveryPreferences, key: string, filter: CollectionFilter) {
  const assignment = Object.hasOwn(data.assignments, key) ? data.assignments[key] : undefined;
  return (!filter.folder || (filter.folder === '__none' ? !assignment?.folder : assignment?.folder === filter.folder))
    && (!filter.tag || !!assignment?.tags.includes(filter.tag));
}
export function MediaCollectionFilter({ kind, value, onChange }: { kind: 'radio' | 'podcast'; value: CollectionFilter; onChange(value: CollectionFilter): void }) {
  const prefs = useDiscoveryPreferences(), t = useT();
  const chip = (key: string, label: string, active: boolean, onPress: () => void) => <GlassPressable key={key} onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: active ? colors.surfaceHighlight : 'transparent' }}><Text style={{ color: active ? colors.accent : colors.textSecondary }}>{label}</Text></GlassPressable>;
  return <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: 8 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
    {chip('all', t('All'), !value.folder && !value.tag, () => onChange({}))}
    {prefs.data.folders.map((folder) => chip(folder.id, folder.name, value.folder === folder.id, () => onChange({ ...value, folder: value.folder === folder.id ? undefined : folder.id })))}
    {prefs.data.tags.map((tag) => chip(`tag:${tag}`, `#${tag}`, value.tag === tag, () => onChange({ ...value, tag: value.tag === tag ? undefined : tag })))}
  </ScrollView><GlassPressable accessibilityLabel={t('Organise folders and tags')} hitSlop={8} onPress={() => router.push({ pathname: '/media-collections', params: { kind } })}><Icon name="folder-open-outline" size={23} color={colors.accent} /></GlassPressable></View>;
}
