import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HealthReport } from '../../src/db/models.js';
import { LocalDiskStorage, sniffImage } from '../../src/modules/media/storage.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

let t: TestApp;
let headers: { authorization: string };
let plantId: string;
const dir = mkdtempSync(join(tmpdir(), 'xg-media-'));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(200, 7)]);

beforeAll(async () => {
  await startMongo();
  t = await createTestApp({ UPLOAD_DIR: dir, PUBLIC_URL: 'https://api.example.test' });
});
afterAll(async () => {
  await t.app.close();
  await stopMongo();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await clearDb();
  const u = await t.signUp();
  headers = u.headers;
  plantId = (await t.app.inject({ method: 'POST', url: '/v1/plants', headers, payload: { name: 'Monstera' } })).json().id;
});

const path = (url: string) => url.replace('https://api.example.test', '');
async function requestUpload(ct = 'image/jpeg') {
  const r = await t.app.inject({ method: 'POST', url: `/v1/plants/${plantId}/photos/upload-url`, headers, payload: { contentType: ct } });
  expect(r.statusCode).toBe(200);
  return r.json() as { photoId: string; upload: { url: string; method: string; headers: Record<string, string> } };
}

describe('plant photos (signed uploads)', () => {
  it('upload → attach → signed read', async () => {
    const { photoId, upload } = await requestUpload();
    expect(upload.url).toMatch(/^https:\/\/api\.example\.test\/v1\/media\/plants\//);
    const put = await t.app.inject({ method: 'PUT', url: path(upload.url), headers: upload.headers, payload: JPEG });
    expect(put.statusCode).toBe(201);

    const attach = await t.app.inject({ method: 'POST', url: `/v1/plants/${plantId}/photos`, headers, payload: { photoId } });
    expect(attach.statusCode).toBe(200);
    const photoUrl: string = attach.json().plant.photoUrl;
    expect(photoUrl).toContain('sig=');
    expect(attach.json().report).toBeNull();

    const get = await t.app.inject({ method: 'GET', url: path(photoUrl) });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(get.rawPayload, JPEG)).toBe(0);
  });

  it('rejects tampered or mismatched uploads', async () => {
    const { upload } = await requestUpload();
    const tampered = upload.url.replace(/sig=[^&]+/, 'sig=AAAA');
    expect((await t.app.inject({ method: 'PUT', url: path(tampered), headers: upload.headers, payload: JPEG })).statusCode).toBe(403);
    const notImage = Buffer.from('<?php echo 1; ?>');
    expect((await t.app.inject({ method: 'PUT', url: path(upload.url), headers: upload.headers, payload: notImage })).statusCode).toBe(400);
    const png = await t.app.inject({ method: 'PUT', url: path(upload.url), headers: { 'content-type': 'image/png' }, payload: JPEG });
    expect(png.statusCode).toBe(400);
  });

  it('cannot attach photos that are missing or belong to another plant', async () => {
    const { photoId } = await requestUpload();
    const missing = await t.app.inject({ method: 'POST', url: `/v1/plants/${plantId}/photos`, headers, payload: { photoId } });
    expect(missing.statusCode).toBe(400);
    const other = (await t.app.inject({ method: 'POST', url: '/v1/plants', headers, payload: { name: 'Other' } })).json().id;
    const foreign = await t.app.inject({ method: 'POST', url: `/v1/plants/${other}/photos`, headers, payload: { photoId } });
    expect(foreign.statusCode).toBe(403);
    const stranger = await t.signUp();
    const nope = await t.app.inject({ method: 'POST', url: `/v1/plants/${plantId}/photos/upload-url`, headers: stranger.headers, payload: { contentType: 'image/jpeg' } });
    expect(nope.statusCode).toBe(404);
  });

  it('analyze=true runs a health check that carries the photo URL', async () => {
    const { photoId, upload } = await requestUpload();
    await t.app.inject({ method: 'PUT', url: path(upload.url), headers: upload.headers, payload: JPEG });
    const r = await t.app.inject({ method: 'POST', url: `/v1/plants/${plantId}/photos`, headers, payload: { photoId, analyze: true } });
    expect(r.json().report).toMatchObject({ provider: 'rules', status: 'unknown' });
    expect((await HealthReport.findOne().lean())?.imageUrl).toContain('/v1/media/plants/');
  });
});

describe('LocalDiskStorage', () => {
  const s = new LocalDiskStorage(dir, 'secret', () => new Date('2026-01-01T00:00:00Z'));
  it('expires links', () => {
    const url = new URL(s.createReadUrl('https://x', 'plants/a/b.jpg', 60));
    const q = Object.fromEntries(url.searchParams);
    expect(s.verify('GET', 'plants/a/b.jpg', q)).toBe(true);
    const later = new LocalDiskStorage(dir, 'secret', () => new Date('2026-01-01T00:02:00Z'));
    expect(later.verify('GET', 'plants/a/b.jpg', q)).toBe(false);
    expect(s.verify('GET', 'plants/a/other.jpg', q)).toBe(false);
  });
  it('refuses path traversal keys', () => {
    expect(() => s.createReadUrl('https://x', '../../etc/passwd.jpg', 60)).not.toThrow(); // URL only
    expect(() => s.createUploadUrl('https://x', '../x.jpg', 'image/jpeg', 60)).toThrow(/Invalid storage key/);
  });
  it('sniffs real image formats', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Buffer.from('RIFF1234WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('hello world!!'))).toBeNull();
  });
});
