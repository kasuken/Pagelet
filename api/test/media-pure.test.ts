import { describe, expect, it } from 'vitest';
import { downloadFilename, signatureMatches, MEDIA_RULES } from '../src/services/media.js';

describe('media helpers (pure)', () => {
  it('derives download names from product fields and a known extension only', () => {
    expect(downloadFilename('Field Guide', 'v2', 'application/pdf')).toBe('Field-Guide-v2.pdf');
    expect(downloadFilename('x', 'v1', 'application/x-msdownload')).toBe('x-v1.bin');
    expect(downloadFilename('../../secret', 'v1', 'application/zip')).toBe('secret-v1.zip');
    expect(downloadFilename('Édition ñ', 'v1', 'image/png')).toMatch(/^[A-Za-z0-9._-]+\.png$/);
  });

  it('checks file signatures for every accepted type and rejects a mismatch', () => {
    expect(signatureMatches('application/pdf', Buffer.from('%PDF-1.4 x'))).toBe(true);
    expect(signatureMatches('application/pdf', Buffer.from('<html>'))).toBe(false);
    expect(signatureMatches('application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(signatureMatches('application/epub+zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(signatureMatches('audio/mpeg', Buffer.from('ID3\u0003'))).toBe(true);
    expect(signatureMatches('audio/mpeg', Buffer.from([0xff, 0xfb, 0x90]))).toBe(true);
    expect(signatureMatches('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(signatureMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(signatureMatches('image/jpeg', Buffer.from([0x89, 0x50]))).toBe(false);
    expect(signatureMatches('video/mp4', Buffer.from('\u0000\u0000\u0000\u0018ftypmp42', 'latin1'))).toBe(true);
    expect(signatureMatches('video/mp4', Buffer.from('\u0000\u0000\u0000\u0018moov', 'latin1'))).toBe(false);
    expect(signatureMatches('text/vtt', Buffer.from('WEBVTT\n\n'))).toBe(true);
    expect(signatureMatches('text/vtt', Buffer.from('﻿WEBVTT\r\n'))).toBe(true);
    expect(signatureMatches('text/vtt', Buffer.from('WEBVTTX'))).toBe(false);
    expect(signatureMatches('text/vtt', Buffer.from('<script>'))).toBe(false);
  });

  it('never lists active or executable types for any kind', () => {
    const forbidden = ['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload', 'application/x-sh'];
    for (const rule of Object.values(MEDIA_RULES)) {
      for (const bad of forbidden) expect(rule.mimeTypes).not.toContain(bad);
    }
  });
});
