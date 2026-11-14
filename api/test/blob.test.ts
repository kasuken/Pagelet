import { describe, expect, it, vi, afterEach } from 'vitest';
import { BlobClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { createAzureBlobPort, contentDisposition } from '../src/services/blob.js';

// Fake account key (base64 of 32 bytes). Never a real secret; tests never print or log it.
const FAKE_KEY = Buffer.alloc(32, 7).toString('base64');
const credential = new StorageSharedKeyCredential('pageletstore', FAKE_KEY);
const port = () => createAzureBlobPort({ accountUrl: 'https://pageletstore.blob.core.windows.net', containerName: 'private-media', credential });

afterEach(() => vi.restoreAllMocks());

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('Azure blob adapter: URL construction (mocked clients, no network)', () => {
  it('issues an upload URL scoped to one blob with create and write only', async () => {
    const url = await port().issueUploadUrl('file/p1/a1', 900, 'application/pdf', 4096);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://pageletstore.blob.core.windows.net/private-media/file/p1/a1');
    const q = params(url);
    expect(q.get('sr')).toBe('b');
    expect(q.get('sp')).toBe('cw');
    expect(q.get('spr')).toBe('https');
    expect(q.get('sig')).toBeTruthy();
    const span = new Date(q.get('se')!).getTime() - Date.now();
    expect(span).toBeGreaterThan(14 * 60_000);
    expect(span).toBeLessThanOrEqual(15 * 60_000 + 1000);
  });

  it('issues a read URL that never grants list, write or delete and carries an attachment disposition', async () => {
    const url = await port().issueReadUrl('file/p1/a1', 300, 'Guide v1.pdf');
    const q = params(url);
    expect(q.get('sr')).toBe('b');
    expect(q.get('sp')).toBe('r');
    expect(q.get('rscd')).toContain('attachment');
    expect(q.get('rscd')).toContain('filename="Guide-v1.pdf"');
    expect(q.get('rscd')).toContain("filename*=UTF-8''Guide%20v1.pdf");
    expect(url).not.toContain(FAKE_KEY);
  });

  it('rejects a non-https account URL and invalid expiry or keys before signing', async () => {
    expect(() => createAzureBlobPort({ accountUrl: 'http://pageletstore.blob.core.windows.net', containerName: 'c', credential })).toThrow(/https/);
    await expect(port().issueReadUrl('../escape', 300, 'x')).rejects.toThrow(/Invalid object key/);
    await expect(port().issueReadUrl('ok/key', 7200, 'x')).rejects.toThrow(/Expiry/);
  });

  it('sanitises the download filename so headers cannot be injected', () => {
    const cd = contentDisposition('evil"\r\nSet-Cookie: x=1/../../a.pdf');
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).not.toMatch(/filename="[^"]*"[^;]*"/);
    expect(cd.startsWith('attachment; filename="')).toBe(true);
  });
});

describe('Azure blob adapter: inspect and delete with mocked clients', () => {
  it('reports size and content type for an existing blob and null for a missing one', async () => {
    vi.spyOn(BlobClient.prototype, 'getProperties')
      .mockResolvedValueOnce({ contentLength: 123, contentType: 'application/pdf' } as any)
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));
    const blob = port();
    expect(await blob.inspect('file/p1/a1')).toEqual({ bytes: 123, contentType: 'application/pdf' });
    expect(await blob.inspect('file/p1/missing')).toBeNull();
  });

  it('propagates non-404 storage errors instead of reporting a missing blob', async () => {
    vi.spyOn(BlobClient.prototype, 'getProperties').mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 503 }));
    await expect(port().inspect('file/p1/a1')).rejects.toThrow('boom');
  });

  it('deletes only the named blob, idempotently', async () => {
    const spy = vi.spyOn(BlobClient.prototype, 'deleteIfExists').mockResolvedValue({} as any);
    await port().delete('file/p1/a1');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
