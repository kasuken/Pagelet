import { BlobSASPermissions, BlobServiceClient, SASProtocol, generateBlobSASQueryParameters, type StorageSharedKeyCredential } from '@azure/storage-blob';
import type { BlobPort } from '../core/ports.js';

export interface AzureBlobOptions {
  /** https://<account>.blob.core.windows.net */
  accountUrl: string;
  containerName: string;
  /** Account key credential from an app setting. Managed identity is not assumed in the managed API tier. */
  credential: StorageSharedKeyCredential;
}

const CLOCK_SKEW_MS = 5 * 60_000;
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,900}$/;

/** Filename safe for Content-Disposition: ASCII only, no quotes, no path separators, no controls. */
export function contentDisposition(downloadName: string): string {
  const ascii = downloadName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(downloadName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/**
 * Real adapter over @azure/storage-blob. Every URL it issues addresses exactly one blob (signed resource type `b`),
 * is signed with the account key, and expires after the requested window.
 *
 * Limits, stated plainly: SAS cannot enforce Content-Type or a maximum byte count on upload. `maxBytes` and
 * `contentType` are therefore advisory here; the API enforces size and type at finalization (inspect) and quota.
 */
export function createAzureBlobPort(options: AzureBlobOptions): BlobPort {
  if (!/^https:\/\//.test(options.accountUrl)) throw new Error('Blob account URL must use https.');
  const service = new BlobServiceClient(options.accountUrl, options.credential);
  const container = service.getContainerClient(options.containerName);

  const signedUrl = (objectKey: string, permissions: string, expiresInSeconds: number, extra: { contentDisposition?: string } = {}): string => {
    if (!OBJECT_KEY.test(objectKey)) throw new Error('Invalid object key.');
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 3600) throw new Error('Expiry out of range.');
    const now = Date.now();
    const token = generateBlobSASQueryParameters(
      {
        containerName: options.containerName,
        blobName: objectKey,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn: new Date(now - CLOCK_SKEW_MS),
        expiresOn: new Date(now + expiresInSeconds * 1000),
        protocol: SASProtocol.Https,
        ...extra,
      },
      options.credential,
    ).toString();
    return `${container.getBlobClient(objectKey).url}?${token}`;
  };

  return {
    async issueUploadUrl(objectKey, expiresInSeconds) {
      // Create and write only: no read, list or delete through the upload URL.
      return signedUrl(objectKey, 'cw', expiresInSeconds);
    },
    async issueReadUrl(objectKey, expiresInSeconds, downloadName) {
      return signedUrl(objectKey, 'r', expiresInSeconds, { contentDisposition: contentDisposition(downloadName) });
    },
    async inspect(objectKey) {
      try {
        const props = await container.getBlobClient(objectKey).getProperties();
        return { bytes: Number(props.contentLength ?? 0), contentType: String(props.contentType ?? '') };
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    },
    async readHead(objectKey, bytes) {
      const response = await container.getBlobClient(objectKey).download(0, bytes);
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.readableStreamBody!) {
        const buf = Buffer.from(chunk as Buffer);
        chunks.push(buf);
        total += buf.length;
        if (total >= bytes) break;
      }
      return Buffer.concat(chunks).subarray(0, bytes);
    },
    async delete(objectKey) {
      await container.getBlobClient(objectKey).deleteIfExists();
    },
  };
}
