/** Conservative listening-time accounting: position seeks are never listening time. */
import type { Song } from '@/api/subsonic';

export function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface ListeningSample {
  profile: string;
  song?: Song;
  playing: boolean;
  buffering: boolean;
  position: number;
  speed: number;
  at: number;
}
export interface ListeningCredit {
  profile: string;
  day: string;
  song: Song;
  seconds: number;
  plays: number;
  at: number;
}

/** Per-track sessions qualify after 30 real seconds, or half of a short song. */
export function createListeningMeter(publish: (credit: ListeningCredit) => void) {
  let previous: ListeningSample | undefined;
  let session = '', heard = 0, counted = false;
  return {
    reset() { previous = undefined; session = ''; heard = 0; counted = false; },
    sample(sample: ListeningSample) {
      const old = previous;
      previous = sample;
      const song = sample.song;
      if (!song?.id || !sample.profile || (song.url && !song.vod)) { session = ''; return; }
      const identity = JSON.stringify([sample.profile, song.id]);
      // Position alone cannot distinguish repeat-one from a seek back to zero.
      // A continuous same-song visit is one qualified session; server/local
      // all-time play counters retain their own independent playback semantics.
      if (session !== identity) { session = identity; heard = 0; counted = false; return; }
      if (!old || old.profile !== sample.profile || old.song?.id !== song.id
        || !old.playing || old.buffering || sample.buffering) return;
      const elapsed = (sample.at - old.at) / 1000;
      const advanced = sample.position - old.position;
      const speed = Number.isFinite(old.speed) && old.speed > 0 ? old.speed : 1;
      // Frozen JS/backlogged beats, clocks changing, seeks and reversals fail closed.
      if (!(elapsed > 0 && elapsed <= 6 && advanced > 0)
        || Math.abs(advanced - elapsed * speed) > Math.max(0.8, elapsed * speed * 0.35)) return;
      const seconds = Math.min(elapsed, advanced / speed);
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      heard += seconds;
      const threshold = Math.min(30, Math.max(1, (song.duration ?? 60) / 2));
      const plays = !counted && heard >= threshold ? 1 : 0;
      if (plays) counted = true;
      publish({ profile: sample.profile, day: localDay(sample.at), song, seconds, plays, at: sample.at });
    },
  };
}

export type ListeningPeriod = 'week' | 'month' | 'year';
export function listeningRange(period: ListeningPeriod, year: number, at = Date.now()) {
  const now = new Date(at);
  if (period === 'year') return { from: `${year}-01-01`, until: `${year + 1}-01-01` };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (period === 'week' ? 6 : 29));
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from: localDay(start.getTime()), until: localDay(end.getTime()) };
}

export function listeningBars(days: { day: string; seconds: number }[], period: ListeningPeriod, year: number, at = Date.now()) {
  const totals = new Map<string, number>();
  for (const row of days) {
    const key = period === 'year' ? row.day.slice(0, 7) : row.day;
    totals.set(key, (totals.get(key) ?? 0) + row.seconds);
  }
  if (period === 'year') return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, label: String(i + 1), seconds: totals.get(key) ?? 0 };
  });
  const range = listeningRange(period, year, at);
  const date = new Date(`${range.from}T12:00:00`);
  return Array.from({ length: period === 'week' ? 7 : 30 }, () => {
    const key = localDay(date.getTime());
    date.setDate(date.getDate() + 1);
    return { key, label: key.slice(5), seconds: totals.get(key) ?? 0 };
  });
}
