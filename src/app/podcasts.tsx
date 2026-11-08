/**
 * The podcasts subscribed to on this phone: a screen, and `embedded`, the
 * Podcasts section of Explore. All local, so nothing is gated on a server.
 */
import { GlassBackdrop, GlassPressable } from '@/components/glass';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';

import {
  listAddedChannels,
  refreshAll,
  type PodcastChannel,
} from '@/api/podcasts';
import { COVER, coverArtUrl } from '@/api/data';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame, useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { PodcastAddSheet } from '@/components/PodcastAddSheet';
import { openPodcastMenu } from '@/components/PodcastMenuSheet';
import { podcastCover } from '@/api/podcasts';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { episodesLabel, useT } from '@/i18n';
import { useAppleMusicStyle } from '@/hooks/useAppleMusicStyle';
import { appleMusicStyles } from '@/theme/appleMusic';
import type { Language } from '@/i18n/languages';
import { listPerf } from '@/lib/listPerf';
import { queryClient } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { profileScopeId } from '@/store/auth';
import { useToast } from '@/store/toast';
import {
  colors,
  fontSize,
  radius,
  spacing,
  themed,
  tracking,
  useTheme,
} from '@/theme';

/** Channels from which the list stops being read at a glance. */
const SEARCH_FROM = 8;

export default function PodcastsScreen() {
  return <PodcastsBrowser />;
}

/** "12 episodes · Ada Lovelace", or whichever half of that there is. */
function channelSubtitle(
  channel: PodcastChannel,
  t: ReturnType<typeof useT>,
  lang: Language,
) {
  const parts: string[] = [];
  if (channel.episodeCount) parts.push(episodesLabel(channel.episodeCount, lang));
  if (channel.author) parts.push(channel.author);
  return parts.join(' · ') || t('No episodes yet');
}

export function PodcastsBrowser({ embedded, actionRef, searchOpen }: BrowserProps) {
  const appleMusic = useAppleMusicStyle();
  const dockScroll = useLiquidDockScrollHandler();
  useTheme();
  const router = useRouter();
  const bottomPad = useScreenBottomPadding();
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['podcastChannels'],
    queryFn: listAddedChannels,
  });

  // Home's shelf is built from the same rows.
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: ['podcastChannels'] }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] }),
    );

  async function refresh() {
    const owner = profileScopeId();
    setRefreshing(true);
    try {
      const { failed, total } = await refreshAll();
      if (owner !== profileScopeId()) return;
      await reload();
      if (total > 0 && failed === total) toast(t("Couldn't reach any of your podcast feeds."));
      else if (failed > 0) toast(t('{n} podcast feeds could not be read.', { n: failed }));
    } catch {
      if (owner === profileScopeId()) toast(t("Couldn't load your podcasts."));
    } finally { setRefreshing(false); }
  }

  const channels = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data ?? [];
    return q
      ? all.filter(
          (c) =>
            c.title.toLowerCase().includes(q) || (c.author ?? '').toLowerCase().includes(q),
        )
      : all;
  }, [data, query]);

  const showSearch = (data?.length ?? 0) > SEARCH_FROM;
  const boxOpen = useSearchBox(embedded, searchOpen, () => setQuery(''));

  // Embedded, Explore's header button opens the sheet.
  useEffect(() => {
    if (actionRef) actionRef.current = () => setAdding(true);
  });

  const addButton = (
    <GlassPressable variant="subtle" hitSlop={10} onPress={() => setAdding(true)} accessibilityLabel={t('Add podcast')}>
      <Icon name="add" size={28} color={colors.text} />
    </GlassPressable>
  );


  return (
    <BrowseFrame embedded={embedded}>
      {embedded ? null : (
        <View style={[styles.header, appleMusic && appleMusicStyles.settingsHeader]}>
          <BackChevron />
          <Text style={[styles.title, appleMusic && appleMusicStyles.settingsTitle]}>{t('Podcasts')}</Text>
          {addButton}
        </View>
      )}

      <GlassPressable style={[styles.discover, { marginHorizontal: listPad }]} accessibilityRole="button"
        onPress={() => router.push('/podcast-discover')}>
        <Icon name="compass-outline" size={23} color={colors.accent} />
        <Text style={styles.discoverText}>{t('Discover podcasts')}</Text>
        <Icon name="chevron-forward" size={18} color={colors.textMuted} />
      </GlassPressable>

      {(embedded ? boxOpen : showSearch) ? (
        <View collapsable={false} style={styles.searchBar}>
          <GlassBackdrop radius={radius.pill} tint={colors.surfaceHighlight} variant="regular" />
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('Find a podcast')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            autoFocus={embedded}
          />
          {query ? (
            <GlassPressable variant="subtle" hitSlop={8} onPress={() => setQuery('')} accessibilityLabel={t('Clear')}>
              <Icon name="close-circle" size={18} color={colors.textMuted} />
            </GlassPressable>
          ) : null}
        </View>
      ) : null}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError && !data ? (
        <Message text={t("Couldn't load your podcasts.")} onRetry={() => refetch()} />
      ) : (
        <Animated.FlatList
      onScroll={dockScroll}
      scrollEventThrottle={16}
          {...listPerf}
          keyboardShouldPersistTaps="handled"
          data={channels}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad, paddingHorizontal: listPad },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }: { item: PodcastChannel }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/podcast/${item.id}`)}
              onLongPress={() => openPodcastMenu(item)}
            >
              <Cover
                uri={coverArtUrl(podcastCover(item), COVER.thumb)}
                size={56}
                placeholderIcon="headset-outline"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.error ? (
                  <Text style={[styles.rowSub, { color: colors.danger }]} numberOfLines={1}>
                    {t("Couldn't read this feed")}
                  </Text>
                ) : (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {channelSubtitle(item, t, lang)}
                  </Text>
                )}
              </View>
              <Pressable
                hitSlop={8}
                onPress={() => openPodcastMenu(item)}
                accessibilityLabel={t('More')}
              >
                <Icon name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
              </Pressable>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="headset-outline"
              title={t('No podcasts')}
              subtitle={t('Tap + to subscribe to a show.')}
            />
          }
        />
      )}

      <PodcastAddSheet
        visible={adding}
        subscribed={(data ?? []).map((c) => c.feedUrl ?? '').filter(Boolean)}
        onCancel={() => setAdding(false)}
        onSubscribed={() => void reload()}
      />


    </BrowseFrame>
  );
}

const styles = themed((colors) => ({
  discover: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm,
    borderRadius: radius.lg, backgroundColor: colors.surfaceHighlight },
  discoverText: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
  },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.md, padding: 0 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
