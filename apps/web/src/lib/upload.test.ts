import { describe, expect, it } from 'vitest';
import { isStorageUrl, mimeFor, putToStorage, UploadTransferError } from './upload';

class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  withCredentials = true;
  status = 0;
  sent: unknown = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
  }
}
const factory = () => new FakeXhr() as unknown as XMLHttpRequest;
const issued = { url: 'https://acct.blob.core.windows.net/c/key?sig=x', method: 'PUT' as const, headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/pdf' }, expiresAt: '' };

describe('putToStorage', () => {
  it('PUTs with the issued headers, no credentials, and reports progress', async () => {
    const progress: number[] = [];
    const done = putToStorage(new Blob(['x']), issued, { xhrFactory: factory, onProgress: (l, t) => progress.push(l / t) });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('PUT');
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.headers['x-ms-blob-type']).toBe('BlockBlob');
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.status = 201;
    xhr.onload?.();
    await done;
    expect(progress).toEqual([0.5]);
  });
  it('rejects on HTTP errors and on cancel', async () => {
    const failing = putToStorage(new Blob(['x']), issued, { xhrFactory: factory });
    FakeXhr.last.status = 403;
    FakeXhr.last.onload?.();
    await expect(failing).rejects.toMatchObject({ status: 403 });
    const controller = new AbortController();
    const cancelled = putToStorage(new Blob(['x']), issued, { xhrFactory: factory, signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ aborted: true });
  });
  it('refuses non-https upload URLs', async () => {
    await expect(putToStorage(new Blob(['x']), { ...issued, url: 'http://x/y' }, { xhrFactory: factory })).rejects.toBeInstanceOf(UploadTransferError);
    expect(isStorageUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('mimeFor', () => {
  it('uses the browser type when allowed, else the extension', () => {
    expect(mimeFor({ name: 'a.pdf', type: 'application/pdf' }, 'file')).toBe('application/pdf');
    expect(mimeFor({ name: 'captions.vtt', type: '' }, 'caption')).toBe('text/vtt');
    expect(mimeFor({ name: 'pack.zip', type: 'application/x-zip-compressed' }, 'file')).toBe('application/zip');
    expect(mimeFor({ name: 'evil.svg', type: 'image/svg+xml' }, 'cover')).toBeNull();
    expect(mimeFor({ name: 'movie.mov', type: 'video/quicktime' }, 'video')).toBeNull();
  });
});
