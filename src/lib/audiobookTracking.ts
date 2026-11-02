/** Event-owned periodic/terminal saves, independent of React rendering. */
export interface AudiobookSample {
  scope: string; albumId?: string; trackId?: string; positionSec: number;
  playing: boolean; enabled: boolean; audiobook: boolean;
}
type Access = {
  remember(scope: string, album: string, track: string, seconds: number, force: boolean): void;
  clearAlbum(scope: string, album: string): void; flush(): Promise<void>;
};
const key = (sample: AudiobookSample) => JSON.stringify([sample.scope, sample.albumId, sample.trackId]);
export class AudiobookProgressTracker {
  private previous?: AudiobookSample;
  private completed?: string;
  private readonly access: Access;
  constructor(access: Access) { this.access = access; }
  private save(sample: AudiobookSample | undefined, force: boolean) {
    if (!sample?.enabled || !sample.audiobook || !sample.albumId || !sample.trackId || this.completed === key(sample)) return;
    this.access.remember(sample.scope, sample.albumId, sample.trackId, sample.positionSec, force);
  }
  begin() { this.save(this.previous, true); this.previous = undefined; this.completed = undefined; }
  observe(sample: AudiobookSample) {
    const previous = this.previous;
    if (previous && key(previous) !== key(sample)) this.save(previous, true);
    else if (previous && (previous.playing && !sample.playing || previous.enabled && !sample.enabled))
      this.save({ ...previous, positionSec: sample.positionSec }, true);
    this.previous = sample;
    if (sample.playing) this.save(sample, false);
  }
  complete(sample: AudiobookSample) {
    if (!sample.enabled || !sample.audiobook || !sample.albumId || !sample.trackId) return;
    this.completed = key(sample);
    this.access.clearAlbum(sample.scope, sample.albumId);
  }
  async flush() { this.save(this.previous, true); await this.access.flush(); }
}
