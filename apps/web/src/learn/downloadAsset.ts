import { api } from '../lib/api';

/** Asks the API for a short-lived download link, then hands it to the browser. */
export async function downloadAsset(assetId: string): Promise<void> {
  const { url } = await api<{ url: string; expiresAt: string }>(`/api/assets/${encodeURIComponent(assetId)}/download`);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Unexpected download address.');
  window.location.assign(parsed.href);
}

const TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/epub+zip': 'EPUB',
  'application/zip': 'ZIP archive',
  'audio/mpeg': 'MP3 audio',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
};

export function fileTypeLabel(mimeType: string): string {
  return TYPE_LABEL[mimeType] ?? 'File';
}
