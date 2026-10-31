/** Select one stable hero source while independent artist metadata finishes. */
export interface ArtistPortraitSources {
  serverType?: string;
  coverArt?: string;
  serverUri?: string;
  infoUri?: string;
  verifiedFullUri?: string;
  failedUri?: string;
  offline?: boolean;
}

export function selectArtistPortrait({ serverType, coverArt, serverUri, infoUri,
  verifiedFullUri, failedUri, offline = false }: ArtistPortraitSources) {
  const local = (uri?: string) => uri && /^(file|content):/i.test(uri) ? uri : undefined;
  const localFull = local(verifiedFullUri);
  // Navidrome's largeImageUrl can be a fixed small resize. Its real artwork
  // hash can request the full tier directly, without a late small-image swap.
  const nativeFull = serverType === 'navidrome' && !!coverArt && !/^https?:\/\//i.test(coverArt);
  const preferredUri = localFull ?? (offline ? local(infoUri) ?? local(serverUri) ?? serverUri ?? infoUri
    : nativeFull ? serverUri ?? infoUri : infoUri ?? serverUri);
  const fallbackUri = [serverUri, infoUri].find((uri) => !!uri && uri !== preferredUri);
  return { preferredUri, fallbackUri, uri: failedUri === preferredUri ? fallbackUri : preferredUri };
}
