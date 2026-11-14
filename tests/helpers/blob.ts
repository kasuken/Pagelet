import type { BlobPort } from '../../api/src/core/ports.js';

export interface FakeObject {
  bytes: number;
  contentType: string;
  head: Buffer;
}

/** In-memory private storage. Records every key that is deleted so tests can prove cleanup happened. */
export class FakeBlob implements BlobPort {
  readonly objects = new Map<string, FakeObject>();
  readonly deleted: string[] = [];
  readonly uploadUrls: string[] = [];
  readonly readUrls: Array<{ key: string; seconds: number; name: string; url: string }> = [];

  /** Simulates the browser PUT to a presigned URL. */
  store(key: string, contentType: string, head: Buffer | string, bytes?: number): void {
    const headBuf = typeof head === 'string' ? Buffer.from(head, 'latin1') : head;
    this.objects.set(key, { bytes: bytes ?? Math.max(headBuf.length, 1), contentType, head: headBuf });
  }

  async issueUploadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const url = `https://blob.test/private/${objectKey}?sp=cw&se=${expiresInSeconds}`;
    this.uploadUrls.push(url);
    return url;
  }

  async issueReadUrl(objectKey: string, expiresInSeconds: number, downloadName: string): Promise<string> {
    const url = `https://blob.test/private/${objectKey}?sp=r&se=${expiresInSeconds}&rscd=${encodeURIComponent(downloadName)}`;
    this.readUrls.push({ key: objectKey, seconds: expiresInSeconds, name: downloadName, url });
    return url;
  }

  async inspect(objectKey: string) {
    const o = this.objects.get(objectKey);
    return o ? { bytes: o.bytes, contentType: o.contentType } : null;
  }

  async readHead(objectKey: string, bytes: number): Promise<Buffer> {
    const o = this.objects.get(objectKey);
    if (!o) throw new Error('missing object');
    return o.head.subarray(0, bytes);
  }

  async delete(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
    this.objects.delete(objectKey);
  }
}

export const PDF_HEAD = '%PDF-1.7\n%fixture';
export const ZIP_HEAD = 'PK\u0003\u0004fixture';
export const PNG_HEAD = '\u0089PNG\r\n\u001a\nfixture';
export const JPEG_HEAD = 'ÿØÿfixture';
export const MP4_HEAD = '\u0000\u0000\u0000\u0018ftypmp42fixture';
export const VTT_HEAD = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello';
