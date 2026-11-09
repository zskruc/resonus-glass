import { requireOptionalNativeModule } from 'expo-modules-core';

export interface TransferEntry { key: string; uri: string; mime: string; name: string }
const audioExtensions = new Set(['mp3', 'mp2', 'm4a', 'm4b', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'wave', 'aif', 'aiff', 'alac', 'wma', 'mp4', 'webm', 'mka', 'ape', 'wv', 'dsf', 'dff', 'amr', '3gp']);
function cleanFilePart(value: string): string {
  return value.replace(/[/\\]/g, '-').replace(/[:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
}
/** Android and common desktop filesystems use a byte limit, not JS length. */
function truncateUtf8(value: string, bytes: number): string {
  let result = '', used = 0;
  for (const raw of value) {
    const code = raw.codePointAt(0)!;
    const character = code >= 0xd800 && code <= 0xdfff ? '_' : raw;
    const size = character === '_' || code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (used + size > bytes) break;
    result += character; used += size;
  }
  return result.replace(/[\s.]+$/g, '');
}
/** The downloaded container can differ from the server's original suffix. */
export function wifiTransferTrackFileName(song: { title: string; artist?: string; suffix?: string }, uri: string): string {
  let path = uri.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { /* Keep malformed escapes literal. */ }
  const diskExtension = /^(?:file|content):\/\//i.test(uri) ? path.split('/').pop()?.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase() : undefined;
  const suffix = song.suffix?.replace(/^\./, '').toLowerCase();
  const extension = diskExtension && audioExtensions.has(diskExtension) ? diskExtension : suffix && audioExtensions.has(suffix) ? suffix : 'mp3';
  const budget = 200 - extension.length - 1;
  const artist = truncateUtf8(cleanFilePart(song.artist ?? ''), Math.min(72, Math.floor(budget * 0.4)));
  // Reserve space for both fields even when the artist's name is very long.
  let artistBytes = 0;
  for (const char of artist) { const code = char.codePointAt(0)!; artistBytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; }
  const title = truncateUtf8(cleanFilePart(song.title) || 'track', budget - (artist ? artistBytes + 3 : 0));
  return `${artist ? `${artist} - ` : ''}${title}.${extension}`;
}
export interface WifiTransferSnapshot {
  running: boolean; url?: string; maxFileBytes: number;
  files: { key: string; name: string; mime: string; bytes: number }[];
  transfers: { id: string; name: string; received: number; total: number; state: 'running' | 'done' | 'failed' | 'cancelled'; direction: 'upload' | 'download'; error?: string }[];
  uploads: { id: string; name: string; uri: string; mime: string; bytes: number }[];
}
const native = requireOptionalNativeModule<{ startTransfer(): Promise<string>; transferStatus(): Promise<string>;
  setTransferEntries(value: string): Promise<void>; stopTransfer(): Promise<void>; copyTransferAddress(): boolean }>('LocalHttp');
export const wifiTransferAvailable = !!native;
export function copyWifiTransferAddress(ticket: number): boolean { return ownsWifiTransfer(ticket) && !!native?.copyTransferAddress(); }
export function parseWifiTransferSnapshot(text: string): WifiTransferSnapshot {
  if (text.length > 1024 * 1024) throw new Error('Invalid transfer status');
  const value = JSON.parse(text) as WifiTransferSnapshot;
  if (!value || typeof value.running !== 'boolean' || !Number.isFinite(value.maxFileBytes) || value.maxFileBytes <= 0
    || !Array.isArray(value.files) || !Array.isArray(value.transfers) || !Array.isArray(value.uploads)) throw new Error('Invalid transfer status');
  if (value.url) {
    const url = new URL(value.url), host = url.hostname;
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash
      || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.split('.').some((part) => Number(part) > 255)
      || !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error('Invalid transfer address');
  }
  return { ...value, files: value.files.slice(0, 200), transfers: value.transfers.slice(-200), uploads: value.uploads.slice(-200) };
}
let owner = 0, queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => { const result = queue.then(work, work); queue = result.catch(() => {}); return result; };
export function claimWifiTransfer(): number { return ++owner; }
export const ownsWifiTransfer = (ticket: number) => ticket === owner;
export async function startWifiTransfer(ticket: number): Promise<WifiTransferSnapshot | undefined> {
  if (!native) throw new Error('Wi-Fi transfer is unavailable');
  return serial(async () => {
    if (!ownsWifiTransfer(ticket)) return;
    await native.stopTransfer(); if (!ownsWifiTransfer(ticket)) return;
    const status = parseWifiTransferSnapshot(await native.startTransfer());
    if (!ownsWifiTransfer(ticket)) { await native.stopTransfer(); return; }
    return status;
  });
}
export async function readWifiTransfer(ticket: number): Promise<WifiTransferSnapshot | undefined> {
  if (!native || !ownsWifiTransfer(ticket)) return;
  const status = parseWifiTransferSnapshot(await native.transferStatus()); return ownsWifiTransfer(ticket) ? status : undefined;
}
export async function publishWifiTransferFiles(ticket: number, entries: TransferEntry[]): Promise<boolean> {
  if (!native || entries.length > 200) return false;
  return serial(async () => {
    if (!ownsWifiTransfer(ticket)) return false;
    const allowed = entries.every((entry) => /^[a-zA-Z0-9_-]{1,80}$/.test(entry.key) && /^(?:file|content):\/\//.test(entry.uri)
      && entry.name.length > 0 && entry.name.length <= 240 && !/[\u0000-\u001f/\\]/.test(entry.name) && entry.mime.length <= 100);
    if (!allowed) throw new Error('Invalid shared files');
    await native.setTransferEntries(JSON.stringify(entries)); return ownsWifiTransfer(ticket);
  });
}
export async function stopWifiTransfer(ticket: number): Promise<void> {
  if (!ownsWifiTransfer(ticket)) return; ++owner;
  await serial(async () => { await native?.stopTransfer(); });
}
