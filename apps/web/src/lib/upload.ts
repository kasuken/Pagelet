import { api } from './api';

export type AssetKind = 'file' | 'video' | 'caption' | 'cover' | 'logo';

export interface AssetView {
  id: string;
  kind: AssetKind;
  status: string;
  productId: string | null;
  mimeType: string;
  declaredBytes: number;
  actualBytes: number | null;
  versionLabel: string;
  replacesAssetId: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface IssuedUpload {
  asset: AssetView;
  upload: { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string };
}

/** Accepted types per kind (mirrors MEDIA_RULES in the API). */
export const ACCEPT: Record<AssetKind, string[]> = {
  file: ['application/pdf', 'application/epub+zip', 'application/zip', 'audio/mpeg', 'image/png', 'image/jpeg'],
  video: ['video/mp4'],
  caption: ['text/vtt'],
  cover: ['image/png', 'image/jpeg'],
  logo: ['image/png', 'image/jpeg'],
};

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp4: 'video/mp4',
  vtt: 'text/vtt',
};

/** Browsers report some types inconsistently (zip, vtt); fall back to the file extension. */
export function mimeFor(file: Pick<File, 'name' | 'type'>, kind: AssetKind): string | null {
  const allowed = ACCEPT[kind];
  if (allowed.includes(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const byExt = EXTENSION_TYPES[ext];
  return byExt && allowed.includes(byExt) ? byExt : null;
}

/** Only PUT to an https storage URL. */
export function isStorageUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export interface PutOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  xhrFactory?: () => XMLHttpRequest;
}

export class UploadTransferError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly aborted = false,
  ) {
    super(message);
    this.name = 'UploadTransferError';
  }
}

/** PUTs the file directly to storage with progress events. No cookies or API headers go to storage. */
export function putToStorage(file: Blob, issued: IssuedUpload['upload'], options: PutOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isStorageUrl(issued.url)) {
      reject(new UploadTransferError('The upload address is not secure.', 0));
      return;
    }
    const xhr = (options.xhrFactory ?? (() => new XMLHttpRequest()))();
    xhr.open(issued.method, issued.url, true);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(issued.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadTransferError(`Storage refused the upload (HTTP ${xhr.status}).`, xhr.status));
    };
    xhr.onerror = () => reject(new UploadTransferError('The connection to storage failed.', 0));
    xhr.onabort = () => reject(new UploadTransferError('Upload cancelled.', 0, true));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export function issueUpload(input: { kind: AssetKind; productId?: string; mimeType: string; declaredBytes: number; versionLabel?: string; replacesAssetId?: string }) {
  return api<IssuedUpload>('/api/owner/media/uploads', { method: 'POST', body: input });
}

export function finalizeUpload(assetId: string) {
  return api<{ asset: AssetView }>(`/api/owner/media/uploads/${encodeURIComponent(assetId)}/finalize`, { method: 'POST', body: {} });
}

export function abortUpload(assetId: string) {
  return api<void>(`/api/owner/media/uploads/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
}
