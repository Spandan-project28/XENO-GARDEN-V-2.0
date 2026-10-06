/**
 * Typed HTTP client for the Xeno Garden API.
 *  • attaches the access token
 *  • on 401 refreshes the session ONCE (single-flight, so parallel requests share one refresh —
 *    the backend treats a reused refresh token as theft and revokes the session) and retries
 *  • maps failures to ApiError with the backend's `{error: {code, message}}` shape
 *  • validates responses with the shared Zod schemas when one is given
 */
import type { ZodType } from 'zod';

export type ApiErrorCode = string;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** No response at all: offline, DNS, timeout, server unreachable. */
  get isNetwork() {
    return this.status === 0;
  }
}

export interface ApiClientOptions {
  baseUrl: () => string | null;
  getAccessToken: () => string | null;
  /**
   * Obtains a fresh access token (using the stored refresh token).
   * Resolves null when the session is over; throws (ApiError status 0) when offline.
   */
  refresh: () => Promise<string | null>;
  /** Called when the session can't be recovered (refresh failed). */
  onAuthFailure: () => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RequestOptions<T> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  schema?: ZodType<T>;
  /** Send the access token (default true). */
  auth?: boolean;
  signal?: AbortSignal;
  /** Overrides the client's default timeout for slow calls (e.g. plant scans). */
  timeoutMs?: number;
}

export class ApiClient {
  private refreshing: Promise<string | null> | null = null;

  constructor(private readonly o: ApiClientOptions) {}

  get<T>(path: string, opts?: RequestOptions<T>) {
    return this.request<T>('GET', path, opts);
  }
  post<T>(path: string, body?: unknown, opts?: RequestOptions<T>) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  put<T>(path: string, body?: unknown, opts?: RequestOptions<T>) {
    return this.request<T>('PUT', path, { ...opts, body });
  }
  patch<T>(path: string, body?: unknown, opts?: RequestOptions<T>) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  delete<T>(path: string, body?: unknown, opts?: RequestOptions<T>) {
    return this.request<T>('DELETE', path, { ...opts, body });
  }

  /** Shares one in-flight refresh between all callers. */
  refreshOnce(): Promise<string | null> {
    this.refreshing ??= this.o.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const auth = opts.auth ?? true;
    let res = await this.send(method, path, opts, auth ? this.o.getAccessToken() : null);

    if (res.status === 401 && auth) {
      // A network failure while refreshing propagates (we're offline, not signed out).
      const token = await this.refreshOnce();
      if (!token) {
        this.o.onAuthFailure();
        throw await toApiError(res);
      }
      res = await this.send(method, path, opts, token);
      if (res.status === 401) {
        this.o.onAuthFailure();
        throw await toApiError(res);
      }
    }

    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json().catch(() => {
      throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent an unreadable response');
    });
    if (opts.schema) {
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError(res.status, 'BAD_RESPONSE', 'The server response did not match the app', parsed.error.issues);
      }
      return parsed.data;
    }
    return json as T;
  }

  private async send(method: string, path: string, opts: RequestOptions<unknown>, token: string | null) {
    const base = this.o.baseUrl();
    if (!base) throw new ApiError(0, 'NOT_CONFIGURED', 'The app is not connected to a server');
    const url = base + path + toQuery(opts.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.o.timeoutMs ?? 15_000);
    opts.signal?.addEventListener('abort', () => controller.abort());
    try {
      return await (this.o.fetchImpl ?? fetch)(url, {
        method,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      const timedOut = controller.signal.aborted && !opts.signal?.aborted;
      throw new ApiError(
        0,
        timedOut ? 'TIMEOUT' : 'NETWORK',
        timedOut ? 'The server took too long to respond' : "Can't reach the server. Check your internet connection.",
        String(err),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toQuery(q: RequestOptions<unknown>['query']) {
  if (!q) return '';
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  const e = body?.error;
  return new ApiError(
    res.status,
    e?.code ?? (res.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
    e?.message ?? (res.status >= 500 ? 'Something went wrong on our side' : `Request failed (${res.status})`),
    e?.details,
  );
}

/** User-facing message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
