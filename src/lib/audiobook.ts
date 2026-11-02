/** Audiobook detection and chapter rewind adapted from Resonus PR #162.
 * Medium tags decide; music/story genres and podcast streams never do. */
import type { Album, Song } from '@/api/subsonic';

const AUDIOBOOK_GENRES = new Set([
  // English
  'audiobook',
  'audiobooks',
  'audio book',
  'audio books',
  'book on tape',
  'books on tape',
  'talking book',
  'talking books',
  'narrated book',
  'narrated books',
  'narrated audiobook',
  'narrated audiobooks',
  'audio novel',
  'audio novels',
  'audio fiction',
  'audio drama',
  'audio dramas',
  'audio theatre',
  'audio theatre drama',
  'audio theater',
  'audio theater drama',
  'radio play',
  'radio plays',
  'radio drama',
  'radio dramas',
  'radioplay',
  'dramatized audiobook',
  'dramatized audiobooks',
  'dramatized adaptation',
  'full cast audio drama',
  'full cast audio',
  'spoken audio',
  'spoken literature',
  'spoken text',
  'spoken word',
  'spokenword',
  'spoken word book',
  'spokenword book',
  'spokenword audiobook',
  'speech',
  'speeches',
  'essay',
  'essays',
  'poetry reading',
  'poetry readings',
  'audio comedy',
  'audio comedy drama',
  'lecture',
  'lectures',
  'sermon',
  'sermons',
  // German
  'horbuch',
  'horbucher',
  'hoerbuch',
  'hoerbuecher',
  'horspiel',
  'horspiele',
  'hoerspiel',
  'hoerspiele',
  'lesung',
  'lesungen',
  'bucher zum horen',
  'buch zum horen',
  'radiotatort',
  'kurzhorspiel',
  'doku horspiel',
  'kinderhorspiel',
  'kinderhoerspiel',
  'jugendhorspiel',
  'krimi horspiel',
  'prosa lesung',
  'gesprochenes wort',
  'vortrag',
  'vortrage',
  'redner',
  'rede',
  'reden',
  // Spanish
  'audiolibro',
  'audiolibros',
  'libro hablado',
  'libros hablados',
  'libro narrado',
  'libros narrados',
  'drama radiofonico',
  'radioteatro',
  'radionovela',
  'audionovela',
  'audiodrama',
  'lectura dramatizada',
  'lectura guiada',
  'palabra hablada',
  'discurso',
  'discursos',
  'conferencia',
  // Catalan
  'audiollibre',
  'audiollibres',
  'llibre parlat',
  // Portuguese
  'audiolivro',
  'audiolivros',
  'livro narrado',
  'livre audio',
  'livres audio',
  'livro falado',
  'livros falados',
  'drama radiofonico',
  'radioteatro',
  // French
  'livre parle',
  'livres parles',
  'roman audio',
  'romans audio',
  'fiction sonore',
  'drame radiophonique',
  // Italian
  'audiolibri',
  'libro parlato',
  'libri parlati',
  'romanzo audio',
  'drammi radiofonici',
  // Dutch / Flemish
  'luisterboek',
  'luisterboeken',
  'gesproken boek',
  'gesproken boeken',
  'hoorspel',
  'hoorspelen',
  // Scandinavian
  'ljudbok',
  'ljudbocker',
  'talbok',
  'radioteater',
  'lydbok',
  'lydboker',
  'horespill',
  'lydbog',
  'lydboger',
  'horspil',
  // Finnish / Estonian
  'aanikirja',
  'aanikirjat',
  'kuunnelma',
  'kuunnelmat',
  'heliraamat',
  'heliraamatud',
  // Slavic (Latin transliterations where commonly seen in tags)
  'audiokniha',
  'audioknihy',
  'zvukova kniha',
  'zvukove knihy',
  'audiokniga',
  'kniga audio',
  // Romanian / Hungarian / Turkish
  'carte audio',
  'carti audio',
  'hangoskonyv',
  'hangos konyv',
  'sesli kitap',
  'sesli kitaplar',
  // Greek (transliterated)
  'ichitiko vivlio',
  'ixitiko vivlio',
  // East Asian labels commonly written in Latin tags
  'ting shu',
  'you sheng shu',
  'yuseisho',
  'audiobukku',
  // Native-language tags, preserved rather than stripped into empty strings.
  '有声书', '有聲書', '有声读物', '有聲讀物', '广播剧', '廣播劇', '朗读', '朗讀',
  'オーディオブック', '朗読', '오디오북', 'аудиокнига', 'аудиокниги',
].map(normalize));
const MEDIUM_WORDS = ['audiobook', 'audio book', 'audio drama', 'spoken word', 'spokenword',
  'horbuch', 'hoerbuch', 'horspiel', 'hoerspiel', 'audiolibro', 'audiollibre', 'audiolivro',
  'luisterboek', 'hoorspel', 'sesli kitap', 'radioteatro', 'radionovela'];
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function isAudiobookGenre(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.split(/[\n;,|/]+/).map(normalize).some((part) => AUDIOBOOK_GENRES.has(part)
    || MEDIUM_WORDS.some((word) => (` ${part} `).includes(` ${word} `)));
}
export function isAudiobookSong(song: Song | null | undefined): boolean {
  if (!song || song.url || song.vod || (song as Song & { podcastChannelId?: string }).podcastChannelId
    || song.id.startsWith('podcast:')) return false;
  return isAudiobookGenre(song.genre) || !!song.genres?.some((genre) => isAudiobookGenre(genre.name));
}
export function isAudiobookAlbum(album: Album | null | undefined): boolean {
  if (!album) return false;
  const types = album.releaseTypes?.map(normalize) ?? [];
  if (types.some((type) => type === 'podcast')) return false;
  return types.some((type) => ['audiobook', 'audio book', 'audio drama', 'audiodrama', 'spokenword', 'spoken word'].includes(type))
    || isAudiobookGenre(album.genre) || !!album.genres?.some((genre) => isAudiobookGenre(genre.name));
}
export function audiobookAlbum(album: Album, songs: readonly Song[]): boolean {
  return !songs.some((song) => !!song.url || !!song.vod || !!(song as Song & { podcastChannelId?: string }).podcastChannelId)
    && (isAudiobookAlbum(album) || songs.length > 0 && songs.every(isAudiobookSong));
}
export const AUDIOBOOK_CONTINUE_REWIND_STEPS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200] as const;
export const AUDIOBOOK_CONTINUE_REWIND_DEFAULT = 10;
export function cleanAudiobookContinueRewindSec(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(7200, value))) : AUDIOBOOK_CONTINUE_REWIND_DEFAULT;
}
export interface AlbumProgressEntry { trackId: string; positionSec: number; updatedAt: number }
/** Unknown-duration chapters stop the backwards walk, never guessed over. */
export function audiobookResumeStart(songs: readonly Song[], progress: AlbumProgressEntry | undefined, rewindSec: number) {
  if (!progress || !Number.isFinite(progress.positionSec) || progress.positionSec < 0) return null;
  let index = songs.findIndex((song) => song.id === progress.trackId);
  if (index < 0) return null;
  const duration = songs[index].duration;
  let positionSec = Math.round(Number.isFinite(duration) && duration! > 0
    ? Math.min(duration!, progress.positionSec) : progress.positionSec) - cleanAudiobookContinueRewindSec(rewindSec);
  while (positionSec < 0 && index > 0) {
    const previous = songs[index - 1].duration;
    if (!Number.isFinite(previous) || previous! <= 0) break;
    index--; positionSec += Math.round(previous!);
  }
  return { index, positionSec: Math.max(0, positionSec) };
}
