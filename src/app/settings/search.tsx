import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Icon from '@/components/Icon';
import { GlassPressable, GlassTextInput, GlassSurface } from '@/components/glass';
import { SettingsPage } from '@/components/SettingsUI';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { createSettingsSearchHistory, searchSettings, type SettingsSearchEntry } from '@/lib/settingsSearch';
import { SETTINGS_SEARCH_ENTRIES } from '@/lib/settingsSearchEntries';
import { withSettingsSearchAliases } from '@/lib/settingsSearchExtras';
import { getItem, setItemStrict } from '@/lib/storage';
import { hashKey } from '@/lib/localLibrary';
import { listPerf } from '@/lib/listPerf';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import { fontSize, radius, spacing, themed, useTheme } from '@/theme';

const entries = SETTINGS_SEARCH_ENTRIES.map(withSettingsSearchAliases);
const byId = new Map(entries.map((entry) => [entry.id, entry]));
const history = createSettingsSearchHistory({ read: getItem, write: setItemStrict }, new Set(byId.keys()));

export default function SettingsSearchScreen() {
  const colors = useTheme(), t = useT(), client = useQueryClient();
  const dockScroll = useLiquidDockScrollHandler(), bottom = useScreenBottomPadding(), padding = useListPadding(spacing.lg);
  useAuthStore((state) => state.auth);
  useAuthStore((state) => state.offlineSource);
  const scope = profileScopeId(), storageKey = `resonus.settingsSearchRecent.${hashKey(scope)}`;
  const [query, setQuery] = useState('');
  const recent = useQuery({ queryKey: ['settingsSearchRecent', scope], queryFn: () => history.load(storageKey) });
  const searching = !!query.trim();
  const results = useMemo(() => searching ? searchSettings(entries, query)
    : (recent.data ?? []).flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), [searching, query, recent.data]);
  function open(entry: SettingsSearchEntry, visit: string) {
    Keyboard.dismiss();
    const askedScope = scope;
    void history.add(storageKey, entry.id).then(() => client.invalidateQueries({ queryKey: ['settingsSearchRecent', askedScope] }))
      .catch(() => { if (profileScopeId() === askedScope) useToast.getState().show(t('Could not save settings search history')); });
    router.push({ pathname: entry.route, params: entry.anchor ? { setting: entry.anchor, settingVisit: visit } : undefined });
  }
  return <SettingsPage title={t('Search settings')}>
    <View style={{ paddingHorizontal: padding, paddingBottom: spacing.md }}>
      <GlassSurface radius={radius.lg} style={styles.inputBox}>
        <Icon name="search" size={20} color={colors.textMuted} />
        <GlassTextInput autoFocus value={query} onChangeText={setQuery} style={styles.input}
          placeholder={t('Search settings, English or pinyin')} placeholderTextColor={colors.textMuted}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
        {query ? <GlassPressable variant="subtle" hitSlop={10} accessibilityLabel={t('Clear')} onPress={() => setQuery('')}>
          <Icon name="close-circle" size={20} color={colors.textMuted} />
        </GlassPressable> : null}
      </GlassSurface>
    </View>
    <Animated.FlatList {...listPerf} onScroll={dockScroll} scrollEventThrottle={16} data={results}
      keyExtractor={(entry) => entry.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: bottom }}
      ListHeaderComponent={!searching && results.length ? <View style={styles.recentHeader}>
        <Text style={styles.section}>{t('Recent settings')}</Text>
        <GlassPressable variant="subtle" accessibilityLabel={t('Clear recent settings')} onPress={() => {
          const askedScope = scope;
          void history.clear(storageKey).then(() => client.invalidateQueries({ queryKey: ['settingsSearchRecent', askedScope] }))
            .catch(() => { if (profileScopeId() === askedScope) useToast.getState().show(t('Could not save settings search history')); });
        }}><Text style={{ color: colors.accent }}>{t('Clear')}</Text></GlassPressable>
      </View> : null}
      ListEmptyComponent={!searching && recent.isPending ? <ActivityIndicator color={colors.accent} />
        : !searching && recent.isError ? <Message text={t('Could not load settings search history')} onRetry={() => recent.refetch()} />
        : <EmptyState icon="search" title={searching ? t('No results') : t('Find a setting')}
          subtitle={searching ? undefined : t('Search Chinese, English, or common pinyin such as boli, geci and yinzhi.')} />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={(event) => open(item, String(event.timeStamp))}
        style={({ pressed }) => [styles.row, pressed && { opacity: .6 }]}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={styles.title}>{t(item.title)}</Text>
          <Text style={styles.breadcrumb}>{t('Settings')} › {t(item.section)}{item.anchor ? ` › ${t(item.title)}` : ''}</Text>
        </View>
        <Icon name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>} />
  </SettingsPage>;
}
const styles = themed((colors) => ({
  inputBox: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14 },
  input: { flex: 1, minHeight: 48, color: colors.text, fontSize: fontSize.md, paddingVertical: 6 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: .5, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  breadcrumb: { color: colors.textSecondary, fontSize: fontSize.xs, lineHeight: 18 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  section: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
}));
