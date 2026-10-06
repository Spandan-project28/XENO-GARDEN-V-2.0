/**
 * Plant Scan end to end against a real (local) HTTP "model API", once per request style the
 * plug supports, plus the failure paths. The irrigation endpoints are untouched by this module.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Device } from '../../src/db/models.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { clearDb, startMongo, stopMongo } from '../helpers/mongo.js';

const dir = mkdtempSync(join(tmpdir(), 'xg-scan-'));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(300, 9)]);
const BASE = 'https://api.example.test';
const path = (url: string) => url.replace(BASE, '');

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}
let seen: Seen[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: [] };
let delayMs = 0;
let model: Server;
let modelUrl = '';

beforeAll(async () => {
  await startMongo();
  model = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      setTimeout(() => {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  modelUrl = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => model.close(r));
  await stopMongo();
  rmSync(dir, { recursive: true, force: true });
});

const SCAN_KEYS = Object.keys(process.env).filter((k) => k.startsWith('SCAN_'));
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('SCAN_') && !SCAN_KEYS.includes(k)) delete process.env[k];
  seen = [];
  delayMs = 0;
});

/** A fresh app whose scan module reads `scanEnv` (the module reads SCAN_* at startup). */
async function appWith(scanEnv: Record<string, string>) {
  for (const [k, v] of Object.entries(scanEnv)) process.env[k] = v;
  const t = await createTestApp({ UPLOAD_DIR: dir, PUBLIC_URL: BASE });
  await clearDb();
  const u = await t.signUp();
  return { t, headers: u.headers, userId: u.userId };
}

async function upload(t: TestApp, headers: Record<string, string>) {
  const r = await t.app.inject({ method: 'POST', url: '/v1/scans/upload-url', headers, payload: { contentType: 'image/jpeg' } });
  expect(r.statusCode).toBe(200);
  const { photoId, upload: u } = r.json();
  const put = await t.app.inject({ method: 'PUT', url: path(u.url), headers: u.headers, payload: JPEG });
  expect(put.statusCode).toBe(201);
  return photoId as string;
}

describe('plant scan', () => {
  it('reports "not connected" and refuses scans without a model, without affecting the rest of the API', async () => {
    const { t, headers } = await appWith({});
    const status = await t.app.inject({ method: 'GET', url: '/v1/scans/status', headers });
    expect(status.json()).toMatchObject({ ready: false, provider: null });
    const photoId = await upload(t, headers);
    const res = await t.app.inject({ method: 'POST', url: '/v1/scans', headers, payload: { photoId } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SCAN_UNAVAILABLE');
    expect((await t.app.inject({ method: 'GET', url: '/v1/devices', headers })).statusCode).toBe(200);
    await t.app.close();
  });

  it('generic multipart API → disease result with sensor tips from the linked device; list, get, delete', async () => {
    const { t, headers, userId } = await appWith({
      SCAN_API_URL: `${modelUrl}/predict`,
      SCAN_API_KEY: 'secret-key-123',
      SCAN_API_AUTH: 'header:x-api-key',
      SCAN_API_MODEL_NAME: 'Leaf Doctor v1',
    });
    reply = { status: 200, body: { predictions: [{ label: 'Tomato___Late_blight', confidence: 0.94 }, { label: 'Tomato___Early_blight', confidence: 0.04 }] } };
    const claim = await t.app.inject({ method: 'POST', url: '/v1/devices/claim', headers, payload: { hardwareId: 'xg-3c71bf12ab34', claimCode: 'ABCD2345' } });
    const deviceId: string = claim.json().device.id;
    await Device.updateOne(
      { _id: deviceId },
      { $set: { latest: { ts: new Date(), soilMoisture: 72, temperature: 21, humidity: 91, rain: false, pump: false } } },
    );

    const status = await t.app.inject({ method: 'GET', url: '/v1/scans/status', headers });
    expect(status.json()).toMatchObject({ ready: true, provider: 'generic', model: 'Leaf Doctor v1' });

    const photoId = await upload(t, headers);
    const res = await t.app.inject({ method: 'POST', url: '/v1/scans', headers, payload: { photoId, deviceId } });
    expect(res.statusCode).toBe(201);
    const scan = res.json();
    expect(scan).toMatchObject({
      status: 'disease',
      title: 'Late blight',
      crop: 'Tomato',
      severity: 'high',
      category: 'fungal',
      confidence: 0.94,
      deviceId,
      deviceName: 'Xeno 1',
      rawLabel: 'Tomato___Late_blight',
      model: { provider: 'generic', name: 'Leaf Doctor v1' },
      conditions: { soilMoisture: 72, humidity: 91 },
    });
    expect(scan.sensorTips.map((x: { code: string }) => x.code)).toEqual(['humid_air', 'soil_too_wet']);
    expect(scan.treatment.length).toBeGreaterThan(0);
    expect(scan.imageUrl).toContain('sig=');

    // The model got the real photo as multipart, with the key in the configured header.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers['x-api-key']).toBe('secret-key-123');
    expect(seen[0]!.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(seen[0]!.body.includes(JPEG)).toBe(true);
    expect(seen[0]!.body.toString('latin1')).toContain('name="image"');

    // The photo is readable through its signed URL.
    expect((await t.app.inject({ method: 'GET', url: path(scan.imageUrl) })).statusCode).toBe(200);

    const list = await t.app.inject({ method: 'GET', url: `/v1/scans?deviceId=${deviceId}`, headers });
    expect(list.json().items.map((s: { id: string }) => s.id)).toEqual([scan.id]);
    expect((await t.app.inject({ method: 'GET', url: `/v1/scans/${scan.id}`, headers })).json().title).toBe('Late blight');

    // Someone else can't see or use it.
    const other = await t.signUp();
    expect((await t.app.inject({ method: 'GET', url: `/v1/scans/${scan.id}`, headers: other.headers })).statusCode).toBe(404);
    const steal = await t.app.inject({ method: 'POST', url: '/v1/scans', headers: other.headers, payload: { photoId } });
    expect(steal.statusCode).toBe(403);
    const otherPhoto = await upload(t, other.headers);
    const foreignDevice = await t.app.inject({ method: 'POST', url: '/v1/scans', headers: other.headers, payload: { photoId: otherPhoto, deviceId } });
    expect(foreignDevice.statusCode).toBe(404);
    expect(seen).toHaveLength(1); // the model was never called for it
    expect(userId).not.toBe(other.userId);

    expect((await t.app.inject({ method: 'DELETE', url: `/v1/scans/${scan.id}`, headers })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/v1/scans', headers })).json().items).toEqual([]);
    await t.app.close();
  });

  it('Hugging Face style: raw bytes + Bearer token, [{label, score}] → healthy', async () => {
    const { t, headers } = await appWith({ SCAN_API_PRESET: 'huggingface', SCAN_API_URL: `${modelUrl}/models/plant`, SCAN_API_KEY: 'hf_abc' });
    reply = { status: 200, body: [{ label: 'Potato___healthy', score: 0.98 }, { label: 'Potato___Early_blight', score: 0.01 }] };
    const photoId = await upload(t, headers);
    const res = await t.app.inject({ method: 'POST', url: '/v1/scans', headers, payload: { photoId } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'healthy', title: 'Healthy potato leaf', severity: 'none', sensorTips: [] });
    expect(seen[0]!.headers.authorization).toBe('Bearer hf_abc');
    expect(seen[0]!.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(seen[0]!.body, JPEG)).toBe(0);
    await t.app.close();
  });

  it('crop.health style: base64 JSON list + Api-Key header, is_plant false → not a plant', async () => {
    const { t, headers } = await appWith({ SCAN_API_PRESET: 'kindwise', SCAN_API_URL: `${modelUrl}/identification`, SCAN_API_KEY: 'kw', SCAN_API_BODY_EXTRA: '{"similar_images":false}' });
    reply = { status: 200, body: { result: { is_plant: { binary: false, probability: 0.02 }, disease: { suggestions: [] } } } };
    const photoId = await upload(t, headers);
    const res = await t.app.inject({ method: 'POST', url: '/v1/scans', headers, payload: { photoId } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'not_plant', title: 'No leaf found' });
    const sent = JSON.parse(seen[0]!.body.toString());
    expect(sent.similar_images).toBe(false);
    expect(sent.images[0]).toBe(`data:image/jpeg;base64,${JPEG.toString('base64')}`);
    expect(seen[0]!.headers['api-key']).toBe('kw');
    await t.app.close();
  });

  it('Roboflow style: base64 body + api_key query; low confidence → uncertain', async () => {
    const { t, headers } = await appWith({ SCAN_API_PRESET: 'roboflow', SCAN_API_URL: `${modelUrl}/leaf-model/2`, SCAN_API_KEY: 'rf' });
    reply = { status: 200, body: { predictions: [{ class: 'Leaf_Mold', confidence: 0.32 }], top: 'Leaf_Mold', confidence: 0.32 } };
    const photoId = await upload(t, headers);
    const res = await t.app.inject({ method: 'POST', url: '/v1/scans', headers, payload: { photoId } });
    expect(res.json()).toMatchObject({ status: 'uncertain', title: 'Not sure', treatment: [] });
    expect(seen[0]!.url).toBe('/leaf-model/2?api_key=rf');
    expect(seen[0]!.body.toString()).toBe(JPEG.toString('base64'));
    await t.app.close();
  });

  it('model failures become clear 502s and never leak the key', async () => {
    const { t, headers } = await appWith({ SCAN_API_URL: `${modelUrl}/predict`, SCAN_API_KEY: 'k-123', SCAN_TIMEOUT_MS: '1000' });
    const photoId = await upload(t, headers);
    const scan = () => t.app.inject({ method: 'POST', url: '/v1/scans', headers, payload: { photoId } });

    reply = { status: 401, body: { error: 'invalid key k-123' } };
    const res = await scan();
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'SCAN_FAILED', message: expect.stringMatching(/API key/) });
    expect(res.body).not.toContain('k-123');

    reply = { status: 200, body: { hello: 'world' } };
    expect((await scan()).json().error.message).toMatch(/could not be read/);

    reply = { status: 200, body: [{ label: 'Tomato___healthy', score: 0.9 }] };
    delayMs = 1500;
    expect((await scan()).json().error.message).toMatch(/too long/);
    await t.app.close();
  });
});
