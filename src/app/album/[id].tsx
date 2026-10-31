/** Album detail with its songs. */
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { useShallow } from 'zustand/react/shallow';

import { COVER, coverArtUrl, getAlbum } from '@/api/data';
import { type Album, type Song } from '@/api/subsonic';
import { BackButton } from '@/components/BackButton';
import { CoverViewer } from '@/components/CoverViewer';
import { Dialog } from '@/components/Dialog';
import { Message } from '@/components/Message';
import { MoreFromArtist } from '@/components/MoreFromArtist';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { ArtistPagePaletteProvider, useArtistPagePalette } from '@/components/volta/ArtistPagePalette';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useMinidiscAlbumPalette } from '@/hooks/useMinidiscAlbumPalette';
import { songsLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { useMediaMenu } from '@/store/mediaMenu';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, useTheme } from '@/theme';

/**
 * Disc headers by song index (multi-disc albums). Labels each disc with its
 * title (`discTitles`) or "Disc N" as fallback, on the first track of each
 * disc. Only if 2+ discs, or a single one with an explicit title (mimics
 * Navidrome).
 *
 * `discNumber` is optional in Subsonic and many albums don't include it (track
 * numbers reset by the `track` tag, not `discnumber`). Hence: if `discNumber`
 * distinguishes discs, it's used; otherwise cuts are inferred by the track
 * number reset (a track with a lower `track` than the previous one opens a new
 * disc). Inferred discs are numbered 1, 2, 3… which usually matches
 * `discTitles` if the album has them.
 */
function discHeadersFor(
  songs: Song[],
  discTitles: { disc: number; title: string }[] | undefined,
  enabled: boolean,
  fallbackLabel: (disc: number) => string,
): Record<number, string> | undefined {
  if (!enabled || songs.length === 0) return undefined;
  // Navidrome sends `discTitles` with `title: ""` when the disc has no real
  // subtitle; treat empty as absent to fall through to "Disc N".
  const titleOf = (disc: number) => {
    const title = discTitles?.find((d) => d.disc === disc)?.title?.trim();
    return title ? title : undefined;
  };

  const firstIndex = new Map<number, number>();
  const variedDisc = new Set(songs.map((s) => s.discNumber ?? 1)).size >= 2;
  if (variedDisc) {
    songs.forEach((s, i) => {
      const disc = s.discNumber ?? 1;
      if (!firstIndex.has(disc)) firstIndex.set(disc, i);
    });
  } else {
    // Without useful discNumber: each track number reset opens a new disc.
    let disc = 1;
    let prevTrack = -Infinity;
    songs.forEach((s, i) => {
      const track = s.track;
      if (i > 0 && track != null && track > 0 && track < prevTrack) disc += 1;
      if (!firstIndex.has(disc)) firstIndex.set(disc, i);
      if (track != null && track > 0) prevTrack = track;
    });
  }

  const discs = [...firstIndex.keys()];
  const singleTitled = discs.length === 1 && titleOf(discs[0]) != null;
  if (discs.length < 2 && !singleTitled) return undefined;
  const headers: Record<number, string> = {};
  for (const disc of discs) headers[firstIndex.get(disc)!] = titleOf(disc) ?? fallbackLabel(disc);
  return headers;
}

/**
 * Genres of the album: the server's list when it sends one (OpenSubsonic
 * `genres`, or the single Subsonic `genre`), and otherwise gathered from the
 * songs, which is where the tags really live — an album can perfectly well
 * carry two genres across its tracks.
 *
 * Deduped ignoring case and trimmed, so "Rock" on one track and "rock " on
 * another are one chip.
 *
 * The cap is only there so a library with a tag per track can't put a
 * thousand chips in a header that doesn't virtualize them: the row scrolls
 * sideways, so nothing below it moves however many there are, and whoever
 * tagged a record with a dozen genres meant all twelve (#104). Six of them,
 * which is what this used to show, is a number small enough to be reached by
 * accident.
 */
const MAX_GENRES = 50;

function albumGenres(album: Album, songs: Song[]): string[] {
  const raw = [
    ...(album.genres ?? []).map((g) => g.name),
    ...(album.genre ? [album.genre] : []),
    // Every genre of each track, not just the first: `genre` is the single one
    // plain Subsonic has room for, and a track tagged "Rock; Pop" only ever
    // handed over "Rock" through it.
    ...songs.flatMap((s) => [...(s.genres ?? []).map((g) => g.name), s.genre ?? '']),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    const clean = name.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length === MAX_GENRES) break;
  }
  return out;
}

export default function AlbumScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const appleMusic = useSettings((s) => s.uiStyle === 'appleMusic');
  const albumStyle = useSettings((s) => s.albumStyle);
  const artistLayout = albumStyle === 'artist';
  const minidisc = albumStyle === 'minidisc' && appleMusic;
  const focused = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showArtistPhoto = useSettings((s) => s.showArtistPhoto);
  const showDiscHeaders = useSettings((s) => s.showDiscHeaders);
  const showGenreChips = useSettings((s) => s.showGenreChips);
  const showDescription = useSettings((s) => s.showPlaylistDescription);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const openMediaMenu = useMediaMenu((s) => s.open);
  const toast = useToast((s) => s.show);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  // Songs selected in selection mode pending "add to playlist".
  const [addingSongs, setAddingSongs] = useState<Song[] | null>(null);
  // The heart reads from the central favorites list (refreshes on starring);
  // `data.album.starred` from the detail becomes stale after star/unstar.
  const favAlbumIds = useFavoriteIds(canFetch, 'album');

  const { data: fresh, isLoading, isError, refetch } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id),
    enabled: canFetch && !!id,
  });

  // The album ceased to exist while you were looking at it: locally albums are
  // derived from their songs, so removing the last download deletes the entire
  // album. Without this the screen would stay with a made-up header, 0 songs
  // and a play button that did nothing. Exiting is what the playlist screen
  // already does when you delete from within, and here it doesn't feel random
  // either: you just destroyed it yourself.
  // Local only: with server, removing a download doesn't delete anything.
  const vanished = offline && !!fresh && fresh.songs.length === 0;
  useEffect(() => {
    if (vanished && router.canGoBack()) router.back();
  }, [vanished, router]);

  // While it's leaving, we keep painting the last good data. `router.back()` is
  // not instant (animates ~300 ms) and the effect runs after painting, so the
  // screen stays mounted for a bit with the album already deleted: without this
  // "Unknown album" and 0 songs would flash before going away. Freezing it, the
  // screen simply slides out as it was.
  const lastGood = useRef(fresh);
  if (fresh && fresh.songs.length > 0) lastGood.current = fresh;
  const data = vanished ? (lastGood.current ?? fresh) : fresh;
  const displayedCover = data ? coverArtUrl(data.album.coverArt ?? data.album.id, appleMusic || artistLayout ? COVER.full : COVER.card) : undefined;
  const albumPalette = useMinidiscAlbumPalette(minidisc ? displayedCover : undefined, offline);

  const discHeaders = useMemo(
    () =>
      discHeadersFor(data?.songs ?? [], data?.album.discTitles, showDiscHeaders, (n) =>
        t('Disc {n}', { n }),
      ),
    [data?.songs, data?.album.discTitles, showDiscHeaders, t],
  );

  const songIds = data?.songs.map((s) => s.id) ?? [];
  const downloadMsg = useDownloadMessage(data?.songs ?? []);
  const download = useDownloads(useShallow((s) => groupDownloadState(s, `album:${id}`, songIds)));
  const downloadAlbum = useDownloads((s) => s.downloadAlbum);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  // Stable between progress ticks (only changes with status): if its identity
  // changed on every % update, the Pressable would lose its touch and you'd
  // have to press multiple times.
  const onDownloadPress = useCallback(() => {
    if (download.status === 'none') setConfirmDownload(true);
    else if (download.status === 'done') setConfirmDelete(true);
    else if (download.status === 'active') setConfirmStop(true);
  }, [download.status]);

  if (isLoading) {
    return <TrackListSkeleton />;
  }

  if (isError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <BackButton />
        <Message text={t("Couldn't load the album.")} onRetry={() => refetch()} />
      </View>
    );
  }

  const labels = (data.album.recordLabels ?? []).map((l) => l.name).filter(Boolean);
  const labelText = labels.length
    ? `℗ ${data.album.year ? `${data.album.year} ` : ''}${labels.join(' · ')}`
    : null;
  // Subsonic has no album description: `comment` is not part of OpenSubsonic's
  // album, only Jellyfin's Overview lands there. What is left is the comment
  // tag of the files, and one track carrying one is a note about that file
  // ("ripped from the CD"), not about the record; a comment every track repeats
  // is what a tagger writes when the text is about the album.
  const firstComment = data.songs[0]?.comment?.trim();
  const sharedComment =
    firstComment && data.songs.every((s) => s.comment?.trim() === firstComment)
      ? firstComment
      : undefined;
  const description = data.album.comment?.trim() || sharedComment;

  const playAlbum = async (startIndex: number, opts?: { shuffled?: boolean }) => {
    try {
      await playQueue(data.songs, startIndex, data.album.name, `/album/${id}`, opts);
    } catch {
      // playQueue already shows a failure toast when it can; keep the UI alive.
    }
  };

  function openAlbumMenu() {
    if (!data) return;
    openMediaMenu({ kind: 'album', album: data.album });
  }

  // What the server says about the album first (OpenSubsonic sends the full
  // list); otherwise gathered from its songs, which is where the tags actually
  // live and works on any server. Deduped case-insensitively so "Rock" and
  // "rock" on different tracks don't both show up.
  const genres = showGenreChips ? albumGenres(data.album, data.songs) : [];

  // The album's own advisory when the server sends one (Navidrome 0.54+), and
  // otherwise whatever its tracks say: an older server, or a profile with no
  // server at all, still has the tag on the files themselves, and one explicit
  // track is what makes a record explicit everywhere else too.
  const explicit =
    data.album.explicitStatus === 'explicit' ||
    data.songs.some((s) => s.explicitStatus === 'explicit');

  const totalSec = data.songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const yearParts: string[] = [];
  if (data.album.year) yearParts.push(String(data.album.year));
  const metaParts = [t('Album'), ...yearParts];
  metaParts.push(songsLabel(data.songs.length, lang));
  if (totalSec > 0) metaParts.push(formatTotalDuration(totalSec));

  return (
    <ArtistPagePaletteProvider value={minidisc ? albumPalette : undefined}>
      {artistLayout && appleMusic && focused ? <><StatusBar style="light" /><NavigationBar style="light" /></> : null}
      <TrackListView
        albumArtistPresentation={artistLayout ? { sourceHref: `/album/${id}` } : undefined}
        albumActionLayout={appleMusic && !minidisc && !artistLayout ? 'volta' : undefined}
        albumPresentation={minidisc ? {
          palette: albumPalette,
          meta: [genres[0], ...yearParts].filter(Boolean).join(' · '),
        } : undefined}
        title={data.album.name}
        subtitle={data.album.artist}
        description={showDescription ? description : undefined}
        artistId={data.album.artistId}
        artists={data.album.artists}
        artistImageUri={
          showArtistPhoto && data.album.artistId
            ? coverArtUrl(data.album.artistId, COVER.thumb)
            : undefined
        }
        meta={metaParts.join(' · ')}
        explicit={explicit}
        genres={genres}
        coverUri={displayedCover}
        onCoverPress={() => setCoverOpen(true)}
        // Same sheet as the long-press on cards: play, queue, download,
        // favorite and pin, without duplicating the menu.
        onMenu={openAlbumMenu}
        songs={data.songs}
        currentId={playing?.id}
        numbered
        discHeaders={discHeaders}
        favorite={{
          id: data.album.id,
          type: 'album',
          starred: favAlbumIds ? favAlbumIds.has(data.album.id) : !!data.album.starred,
        }}
        download={!offline ? { ...download, onPress: onDownloadPress } : undefined}
        footer={
          data.album.artistId || labelText || minidisc ? (
            <>
              {minidisc ? <Text style={{ color: albumPalette.textSecondary, fontSize: fontSize.xs,
                lineHeight: 19, marginTop: spacing.lg }}>{metaParts.join(' · ')}</Text> : null}
              {data.album.artistId ? (
                <MoreFromArtist
                  artistId={data.album.artistId}
                  artistName={data.album.artist ?? ''}
                  currentAlbumId={data.album.id}
                />
              ) : null}
              {labelText ? (
                <AlbumFooterNote text={labelText} />
              ) : null}
            </>
          ) : undefined
        }
        // No "Remove": an album's songs can't be taken out of it.
        selection={{
          onAddTo: (sel) => setAddingSongs(sel),
          onDownload: !offline
            ? (sel) => {
                void downloadSongs(sel);
                toast(t('Downloading…'));
              }
            : undefined,
        }}
        onPlay={(start, opts) => playAlbum(start, opts)}
      />
      <PlaylistPickerSheet songs={addingSongs} onClose={() => setAddingSongs(null)} />
      <CoverViewer
        visible={coverOpen}
        uri={coverArtUrl(data.album.coverArt ?? data.album.id, COVER.full)}
        onClose={() => setCoverOpen(false)}
      />
      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: data.album.name })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void downloadAlbum(data.album, data.songs);
        }}
      />
      <Dialog
        visible={confirmDelete}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: data.album.name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteSongs(songIds);
        }}
      />
      <Dialog
        visible={confirmStop}
        title={t('Stop download?')}
        message={t('Songs already downloaded will be kept.')}
        confirmLabel={t('Stop')}
        destructive
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          cancelDownload(`album:${id}`);
        }}
      />
    </ArtistPagePaletteProvider>
  );
}

/** This descendant reads the same local cover palette as the recycled song rows. */
function AlbumFooterNote({ text }: { text: string }) {
  const palette = useArtistPagePalette();
  return <Text style={{ color: palette?.textSecondary ?? colors.textSecondary, fontSize: fontSize.xs,
    marginTop: spacing.lg }}>{text}</Text>;
}
