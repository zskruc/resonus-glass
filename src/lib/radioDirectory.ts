/** Radio Browser public read API. No server credentials, automatic playback or writes. */
import { isManualOffline } from '@/api/netGate';
import { publicStreamUrl, type LocalRadioStation } from '@/lib/discoveryPreferences';
export interface DirectoryStation extends LocalRadioStation { country: string; tags: string[]; codec: string; bitrate: number }
export const RADIO_DIRECTORY_PAGE = 50;
export const RADIO_REGIONS = [{ code: '', label: 'Worldwide' }, { code: 'CN', label: 'China' }, { code: 'TW', label: 'Taiwan' }, { code: 'HK', label: 'Hong Kong' }, { code: 'US', label: 'United States' }, { code: 'JP', label: 'Japan' }, { code: 'GB', label: 'United Kingdom' }, { code: 'DE', label: 'Germany' }] as const;
export function parseDirectoryStations(raw: unknown): DirectoryStation[] {
  if (!Array.isArray(raw)) throw new Error('Invalid radio directory response');
  return raw.slice(0, 200).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>, streamUrl = publicStreamUrl(row.url_resolved) ?? publicStreamUrl(row.url);
    const id = typeof row.stationuuid === 'string' ? row.stationuuid : '', name = typeof row.name === 'string' ? row.name.trim().slice(0, 160) : '';
    if (!/^[a-f\d-]{20,50}$/i.test(id) || !name || !streamUrl) return [];
    return [{ id: `localradio:${id}`, name, streamUrl, homePageUrl: publicStreamUrl(row.homepage), imageUrl: publicStreamUrl(row.favicon), country: typeof row.country === 'string' ? row.country.slice(0, 80) : '',
      tags: typeof row.tags === 'string' ? row.tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12) : [], codec: typeof row.codec === 'string' ? row.codec.slice(0, 20) : '', bitrate: typeof row.bitrate === 'number' ? Math.max(0, row.bitrate) : 0 }];
  }).filter((row, i, all) => all.findIndex((item) => item.id === row.id) === i);
}
export async function readRadioDirectory(options: { query?: string; country?: string; offset?: number; signal?: AbortSignal }) {
  if (isManualOffline()) throw new Error('Offline mode');
  const controller = new AbortController(), abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Radio directory timed out')); }, 15000); });
  try {
    const operation = (async () => {
      let last: unknown;
      const params = new URLSearchParams({ limit: String(RADIO_DIRECTORY_PAGE), offset: String(Math.max(0, Math.floor(options.offset ?? 0))), order: 'clickcount', reverse: 'true', hidebroken: 'true' });
      if (options.query?.trim()) params.set('name', options.query.trim().slice(0, 160));
      if (/^[A-Z]{2}$/.test(options.country ?? '')) params.set('countrycode', options.country!);
      for (const host of ['de1.api.radio-browser.info', 'at1.api.radio-browser.info']) {
        if (controller.signal.aborted || isManualOffline()) throw new Error('Radio directory cancelled');
        try {
          const response = await fetch(`https://${host}/json/stations/search?${params}`, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'ResonusGlass/153' } });
          if (!response.ok) { const error = new Error(`Radio directory HTTP ${response.status}`); if (response.status === 429 || response.status < 500) throw error; last = error; continue; }
          const data: unknown = await response.json(); if (controller.signal.aborted || isManualOffline()) throw new Error('Radio directory cancelled');
          return parseDirectoryStations(data);
        } catch (error) { last = error; if (controller.signal.aborted || error instanceof Error && /HTTP (4\d\d)/.test(error.message)) throw error; }
      }
      throw last ?? new Error('Radio directory unavailable');
    })();
    return await Promise.race([operation, deadline]);
  } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
