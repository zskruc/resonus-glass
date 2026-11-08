/**
 * Plays random songs from the library (or a genre) instantly.
 *
 * This is an ACTION, not a destination: "random" literally means "don't make
 * me choose", so showing a list before playing contradicts what was asked.
 * Whatever plays is visible in the queue, which already exists and also lets
 * you reorder and remove — it was a better screen than whatever was here.
 */
import { getRandomSongs } from '@/api/data';
import { tg } from '@/i18n';
import { usePlayerStore } from '@/store/player';
import { recommendationProfileScope, useShufflePreferences } from '@/store/shufflePreferences';
import { useToast } from '@/store/toast';

/** Not the entire library: the endpoint caps ~500 and a queue that size is unusable. */
const SHUFFLE_SIZE = 200;
let request = 0;

/** Empty `genre` = entire library. Genres are server-side. */
export async function playShuffle(genre?: string): Promise<void> {
  const token = ++request, profile = recommendationProfileScope(), before = usePlayerStore.getState();
  const queue = before.queue, index = before.index;
  const current = () => token === request && profile === recommendationProfileScope()
    && usePlayerStore.getState().queue === queue && usePlayerStore.getState().index === index;
  let songs;
  try {
    songs = await getRandomSongs(SHUFFLE_SIZE, genre);
  } catch {
    if (current()) useToast.getState().show(tg("Couldn't load songs."));
    return;
  }
  if (!current()) return;
  await useShufflePreferences.getState().hydrate();
  if (!current()) return;
  if (songs.length === 0) {
    useToast.getState().show(tg('Nothing to shuffle yet'));
    return;
  }
  // The queue deals once using the selected policy, without changing shuffle mode.
  await usePlayerStore.getState().playQueue(songs, 0, genre || tg('Shuffle'), undefined, { shuffled: true });
}
