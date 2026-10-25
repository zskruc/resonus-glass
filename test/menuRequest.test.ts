import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MenuRequestScope } from '@/lib/menuRequest';
import { useMediaMenu } from '@/store/mediaMenu';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSongMenu } from '@/store/songMenu';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('menu requests and exit ownership', () => {
  it('keeps only the newest target when two checks return out of order', async () => {
    const scope = new MenuRequestScope();
    const first = deferred<string>();
    const second = deferred<string>();
    let shown: string | null = null;
    const load = async (response: Promise<string>) => {
      const ticket = scope.begin();
      const value = await response;
      if (scope.owns(ticket)) shown = value;
    };
    const oldWork = load(first.promise);
    const newWork = load(second.promise);
    second.resolve('latest playlist');
    await newWork;
    first.resolve('old playlist');
    await oldWork;
    assert.equal(shown, 'latest playlist');
  });

  it('does not perform an obsolete failure fallback after a new action', async () => {
    const scope = new MenuRequestScope();
    const response = deferred<void>();
    const ticket = scope.begin();
    let additions = 0;
    const work = response.promise.catch(() => {
      if (scope.owns(ticket)) additions++;
    });
    scope.begin();
    response.reject(new Error('offline'));
    await work;
    assert.equal(additions, 0);
  });

  it('rejects queued confirm and cancel callbacks belonging to an older prompt', () => {
    const scope = new MenuRequestScope();
    const oldPrompt = scope.begin();
    const currentPrompt = scope.begin();
    let confirmations = 0;
    if (scope.owns(oldPrompt)) confirmations++;
    if (scope.owns(oldPrompt)) scope.invalidate();
    assert.equal(confirmations, 0);
    assert.equal(scope.owns(currentPrompt), true);
  });

  it('accepts one close and invalidates duplicate exit callbacks', () => {
    const scope = new MenuRequestScope();
    const session = scope.begin();
    let closes = 0;
    const close = () => {
      if (!scope.owns(session)) return;
      scope.invalidate();
      closes++;
    };
    close();
    close();
    assert.equal(closes, 1);
  });

  it('does not let an old queued exit close a newly opened window', () => {
    const scope = new MenuRequestScope();
    const oldSession = scope.begin();
    const newSession = scope.begin();
    let closed = false;
    if (scope.owns(oldSession)) closed = true;
    assert.equal(closed, false);
    assert.equal(scope.owns(newSession), true);
  });

  it('invalidates a queued after callback on unmount', () => {
    const scope = new MenuRequestScope();
    const session = scope.begin();
    let openedAnotherWindow = false;
    scope.invalidate();
    if (scope.owns(session)) openedAnotherWindow = true;
    assert.equal(openedAnotherWindow, false);
  });

  it('can start a new action after effect cleanup and setup replay', () => {
    const scope = new MenuRequestScope();
    const beforeCleanup = scope.begin();
    scope.invalidate();
    const afterSetup = scope.begin();
    assert.equal(scope.owns(beforeCleanup), false);
    assert.equal(scope.owns(afterSetup), true);
  });

  it('permanently rejects work when a local selection owner is replaced', () => {
    const scope = new MenuRequestScope();
    const ticket = scope.begin();
    scope.dispose();
    assert.equal(scope.owns(ticket), false);
    assert.equal(scope.owns(scope.begin()), false);
  });

  it('a downward drag cancels a pending lookup and an old drag cannot close a new action', async () => {
    const scope = new MenuRequestScope();
    const response = deferred<void>();
    const lookup = scope.begin();
    let openedPrompt = false;
    const work = response.promise.then(() => {
      if (scope.owns(lookup)) openedPrompt = true;
    });
    const gesture = scope.begin();
    response.resolve();
    await work;
    assert.equal(openedPrompt, false);
    const nextAction = scope.begin();
    assert.equal(scope.owns(gesture), false);
    assert.equal(scope.owns(nextAction), true);
  });
});

describe('global menu selection sessions', () => {
  it('assigns distinct media sessions even when reopening the same object', () => {
    const item = { kind: 'album' as const, album: { id: 'album', name: 'Album' } };
    useMediaMenu.getState().open(item);
    const first = useMediaMenu.getState().session;
    useMediaMenu.getState().close();
    assert.equal(useMediaMenu.getState().session, first + 1);
    useMediaMenu.getState().open(item);
    assert.equal(useMediaMenu.getState().session, first + 2);
    useMediaMenu.getState().close();
  });

  it('rejects late media results after closing A and opening B', async () => {
    useMediaMenu.getState().open({ kind: 'album', album: { id: 'A', name: 'A' } });
    const session = useMediaMenu.getState().session;
    const scope = new MenuRequestScope(() => useMediaMenu.getState().session === session);
    const ticket = scope.begin();
    const response = deferred<string[]>();
    let selectedSongs: string[] | null = null;
    const work = response.promise.then((songs) => {
      if (scope.owns(ticket)) selectedSongs = songs;
    });
    useMediaMenu.getState().close();
    useMediaMenu.getState().open({ kind: 'album', album: { id: 'B', name: 'B' } });
    response.resolve(['song-A']);
    await work;
    assert.equal(selectedSongs, null);
    const current = useMediaMenu.getState().item;
    assert.equal(current?.kind === 'album' ? current.album.id : null, 'B');
    useMediaMenu.getState().close();
  });

  it('permits its own accepted export after close, but rejects it after another menu opens', () => {
    useMediaMenu.getState().open({ kind: 'album', album: { id: 'A', name: 'A' } });
    const session = useMediaMenu.getState().session;
    const scope = new MenuRequestScope(() => {
      const current = useMediaMenu.getState();
      return current.session === session && current.item !== null ||
        current.session === session + 1 && current.item === null;
    });
    const exportTicket = scope.begin();
    useMediaMenu.getState().close();
    assert.equal(scope.owns(exportTicket), true);
    useMediaMenu.getState().open({ kind: 'album', album: { id: 'B', name: 'B' } });
    assert.equal(scope.owns(exportTicket), false);
    useMediaMenu.getState().close();
  });

  it('a repeated song open resets menu metadata and invalidates a delayed lookup', () => {
    const song = { id: 'song', title: 'Song' };
    useSongMenu.getState().open(song, { playlistId: 'playlist', index: 4 }, { sleep: true, queue: true });
    const first = useSongMenu.getState().session;
    const scope = new MenuRequestScope(() => useSongMenu.getState().session === first);
    const ticket = scope.begin();
    useSongMenu.getState().open(song);
    assert.equal(useSongMenu.getState().session, first + 1);
    assert.equal(scope.owns(ticket), false);
    assert.equal(useSongMenu.getState().context, null);
    assert.equal(useSongMenu.getState().sleep, false);
    assert.equal(useSongMenu.getState().extras.queue, false);
    useSongMenu.getState().close();
    assert.equal(useSongMenu.getState().session, first + 2);
  });

  it('reopening the same playlist batch invalidates an old duplicate check', () => {
    const songs = [{ id: 'song', title: 'Song' }];
    usePlaylistPicker.getState().open(songs);
    const first = usePlaylistPicker.getState().session;
    const scope = new MenuRequestScope(() => usePlaylistPicker.getState().session === first);
    const ticket = scope.begin();
    usePlaylistPicker.getState().close();
    usePlaylistPicker.getState().open(songs);
    assert.equal(usePlaylistPicker.getState().session, first + 2);
    assert.equal(scope.owns(ticket), false);
    assert.equal(usePlaylistPicker.getState().songs, songs);
    usePlaylistPicker.getState().close();
  });
});
