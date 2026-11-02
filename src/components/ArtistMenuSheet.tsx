/**
 * What a long press on an artist offers: play them, their radio, the heart.
 * The rest lives in the ⋯ of the artist's own screen, a tap away.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl, getTopSongs, star, type Artist } from '@/api/data';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useT } from '@/i18n';
import { applyStarChange, unstarWithUndo } from '@/lib/favoritesCache';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { SheetModal } from './SheetModal';

let openMenu: ((artist: Artist) => void) | null = null;

export function openArtistMenu(artist: Artist): void {
  openMenu?.(artist);
}

export function ArtistMenuSheet() {
  const t = useT();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const offline = useAuthStore((s) => s.offline);
  const radiosEnabled = useAuthStore((s) => !!s.auth && s.auth.serverType !== 'jellyfin');
  const openRef = useRef<() => void>(() => {});
  const [target, setTarget] = useState<Artist | null>(null);
  const context = useRef({ profile: profileScopeId(), owner: useAuthStore.getState().auth });
  const favorites = useFavoriteIds(!!target, 'artist');

  useEffect(() => {
    openMenu = (artist) => {
      context.current = { profile: profileScopeId(), owner: useAuthStore.getState().auth };
      setTarget(artist);
      openRef.current();
    };
    return () => {
      openMenu = null;
    };
  }, []);

  /** The same popular songs the Play button of the artist's screen starts. */
  async function play(artist: Artist, mix = false) {
    const request = context.current;
    const queue = usePlayerStore.getState().queue;
    const current = () => request === context.current && request.profile === profileScopeId()
      && request.owner === useAuthStore.getState().auth && usePlayerStore.getState().queue === queue;
    try {
      const songs = await getTopSongs(artist.name, 20, artist.id);
      if (!current()) return;
      if (songs.length > 0) {
        if (mix) {
          const started = await usePlayerStore.getState().startRadio(songs[0], t('Mix of “{name}”', { name: artist.name }));
          if (request.profile === profileScopeId() && request.owner === useAuthStore.getState().auth) toast(t(started ? 'Mix started' : "Couldn't find anything to mix with this song"));
        } else await playQueue(songs, 0, artist.name, `/artist/${artist.id}`);
      }
      else toast(t('Not available offline'));
    } catch {
      if (current()) toast(t("Couldn't complete the action"));
    }
  }

  async function addToFavorites(artist: Artist) {
    const request = context.current;
    try {
      if (request.profile !== profileScopeId() || request.owner !== useAuthStore.getState().auth) return;
      await star(artist.id, 'artist');
      if (request.profile !== profileScopeId() || request.owner !== useAuthStore.getState().auth) return;
      applyStarChange('artist', artist.id, true, artist);
    } catch {
      if (request.profile === profileScopeId() && request.owner === useAuthStore.getState().auth) toast(t("Couldn't complete the action"));
    }
  }

  const row = (icon: keyof typeof Icon.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={() => {
        if (context.current.profile !== profileScopeId() || context.current.owner !== useAuthStore.getState().auth) return;
        onPress();
      }}
    >
      <Icon name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );

  return (
    <SheetModal openRef={openRef}>
      {(close) => {
        if (!target) return null;
        const artist = target;
        const hearted = !!favorites?.has(artist.id);
        return (
          <>
            <View style={styles.headerRow}>
              <Cover uri={coverArtUrl(artist.coverArt ?? artist.id, COVER.thumb)} size={48} rounded />
              <Text style={styles.title} numberOfLines={1}>
                {artist.name}
              </Text>
            </View>
            <View style={styles.divider} />
            {row('play-outline', t('Play'), () => {
              close();
              void play(artist);
            })}
            {offline || !radiosEnabled
              ? null
              : row('radio-outline', t('Start mix'), () => { close(); void play(artist, true); })}
            {row(
              hearted ? 'heart' : 'heart-outline',
              hearted ? t('Remove from favorites') : t('Add to favorites'),
              () => {
                close();
                if (hearted) unstarWithUndo('artist', artist.id);
                else void addToFavorites(artist);
              },
            )}
          </>
        );
      }}
    </SheetModal>
  );
}

const styles = themed((colors) => ({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
