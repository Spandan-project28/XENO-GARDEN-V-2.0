/**
 * Sends a leaf photo to the configured disease model API and returns its predictions.
 * Everything API-specific (auth style, request format, response shape) comes from ScanConfig,
 * so connecting a new model is configuration, not code.
 */
import type { ScanConfig } from './config.js';
import { parseModelResponse, type ParsedResponse } from './parse.js';

export interface ScanImage {
  bytes: Buffer;
  contentType: string;
}

export interface Detection extends ParsedResponse {
  modelName: string;
}

/** A failure the user can understand; `detail` goes to the server log only. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface DiseaseDetector {
  readonly ready: boolean;
  readonly modelName: string;
  detect(image: ScanImage): Promise<Detection>;
}

function buildRequest(c: ScanConfig, image: ScanImage): { url: URL; init: RequestInit } {
  const url = new URL(c.url!);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (c.apiKey) {
    if (c.auth === 'bearer') headers.authorization = `Bearer ${c.apiKey}`;
    else if (c.auth.startsWith('header:')) headers[c.auth.slice('header:'.length)] = c.apiKey;
    else if (c.auth.startsWith('query:')) url.searchParams.set(c.auth.slice('query:'.length), c.apiKey);
  }
  const b64 = image.bytes.toString('base64');
  let body: BodyInit;
  switch (c.request) {
    case 'raw':
      headers['content-type'] = image.contentType;
      body = new Uint8Array(image.bytes);
      break;
    case 'json-base64': {
      headers['content-type'] = 'application/json';
      const dataUrl = `data:${image.contentType};base64,${b64}`;
      // A plural field ("images") takes a list, as crop.health and similar APIs expect.
      const value = c.imageField.endsWith('s') ? [dataUrl] : b64;
      body = JSON.stringify({ ...c.bodyExtra, [c.imageField]: value });
      break;
    }
    case 'form-base64':
      // Roboflow style: the whole body is the base64 image.
      headers['content-type'] = 'application/x-www-form-urlencoded';
      for (const [k, v] of Object.entries(c.bodyExtra)) url.searchParams.set(k, String(v));
      body = b64;
      break;
    default: {
      const form = new FormData();
      const ext = image.contentType === 'image/png' ? 'png' : image.contentType === 'image/webp' ? 'webp' : 'jpg';
      form.append(c.imageField, new Blob([new Uint8Array(image.bytes)], { type: image.contentType }), `leaf.${ext}`);
      for (const [k, v] of Object.entries(c.bodyExtra)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      body = form;
    }
  }
  return { url, init: { method: 'POST', headers, body } };
}

/** Never leak the API key into logs or messages. */
const redact = (s: string, key: string | null) => (key ? s.split(key).join('***') : s);

export class HttpDiseaseDetector implements DiseaseDetector {
  constructor(
    private readonly c: ScanConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get ready() {
    return this.c.ready;
  }

  get modelName() {
    return this.c.modelName;
  }

  async detect(image: ScanImage): Promise<Detection> {
    if (!this.c.ready || !this.c.url) throw new ModelError('No disease model is connected yet.');
    const { url, init } = buildRequest(this.c, image);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.c.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      const aborted = controller.signal.aborted;
      throw new ModelError(
        aborted ? 'The disease model took too long to answer. Please try again.' : 'Could not reach the disease model. Check the server’s internet connection.',
        redact(String(err), this.c.apiKey),
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const detail = `HTTP ${res.status}: ${redact(text.slice(0, 300), this.c.apiKey)}`;
      if (res.status === 401 || res.status === 403) throw new ModelError('The disease model rejected the API key. Check SCAN_API_KEY.', detail);
      if (res.status === 429) throw new ModelError('The disease model’s usage limit was reached. Try again later.', detail);
      if (res.status === 503 && /loading/i.test(text)) throw new ModelError('The disease model is warming up. Try again in about 20 seconds.', detail);
      throw new ModelError('The disease model returned an error. Please try again.', detail);
    }
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text.trim();
    }
    const parsed = parseModelResponse(json, this.c);
    if (!parsed.predictions.length && parsed.isPlant !== false) {
      throw new ModelError('The disease model’s answer could not be read.', `unrecognised response: ${redact(text.slice(0, 300), this.c.apiKey)}`);
    }
    return { ...parsed, modelName: this.c.modelName };
  }
}
