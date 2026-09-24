/**
 * Object storage behind an interface, using the "pre-signed URL" pattern: the API hands out a
 * short-lived signed URL, the phone uploads the image bytes straight to it, and later reads go
 * through signed URLs too. `LocalDiskStorage` implements it on disk (dev / single host); an
 * S3/R2 driver can implement the same interface with native presigned URLs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface SignedUrl {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ObjectStorage {
  /** `base` = public origin of the API as seen by the client, e.g. https://api.example.com */
  createUploadUrl(base: string, key: string, contentType: string, expiresInSec: number): SignedUrl;
  createReadUrl(base: string, key: string, expiresInSec: number): string;
  exists(key: string): Promise<boolean>;
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const KEY_PATTERN = /^[a-z0-9][a-z0-9/_-]{2,120}\.(jpg|png|webp)$/;

export const extensionFor = (contentType: string) =>
  contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';

export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(
    dir: string,
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.root = resolve(dir);
  }

  private sign(parts: string[]) {
    return createHmac('sha256', this.secret).update(parts.join('\n')).digest('base64url');
  }

  private path(key: string) {
    if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('Invalid storage key');
    return p;
  }

  createUploadUrl(base: string, key: string, contentType: string, expiresInSec: number): SignedUrl {
    this.path(key);
    const exp = Math.floor(this.now().getTime() / 1000) + expiresInSec;
    const sig = this.sign(['PUT', key, contentType, String(exp)]);
    const q = new URLSearchParams({ exp: String(exp), ct: contentType, sig });
    return {
      url: `${base}/v1/media/${key}?${q}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  createReadUrl(base: string, key: string, expiresInSec: number): string {
    const exp = Math.floor(this.now().getTime() / 1000) + expiresInSec;
    const sig = this.sign(['GET', key, String(exp)]);
    return `${base}/v1/media/${key}?${new URLSearchParams({ exp: String(exp), sig })}`;
  }

  /** Validates a signature from a URL. Returns false when expired or tampered with. */
  verify(method: 'PUT' | 'GET', key: string, q: { exp?: string; sig?: string; ct?: string }): boolean {
    const exp = Number(q.exp);
    if (!q.sig || !Number.isFinite(exp) || exp * 1000 < this.now().getTime()) return false;
    const expected = this.sign(method === 'PUT' ? ['PUT', key, q.ct ?? '', String(exp)] : ['GET', key, String(exp)]);
    const a = Buffer.from(expected);
    const b = Buffer.from(q.sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async write(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async exists(key: string) {
    try {
      return (await stat(this.path(key))).isFile();
    } catch {
      return false;
    }
  }
}

/** Checks magic bytes so a renamed non-image can't be stored as one. */
export function sniffImage(buf: Buffer): (typeof ALLOWED_IMAGE_TYPES)[number] | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
