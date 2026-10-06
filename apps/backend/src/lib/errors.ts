import type { ErrorCode } from '@xeno/shared';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  DEVICE_ALREADY_CLAIMED: 409,
  INVALID_CLAIM_CODE: 403,
  DEVICE_OFFLINE: 409,
  INTERNAL: 500,
  SCAN_UNAVAILABLE: 503,
  SCAN_FAILED: 502,
};

/** Expected, user-facing error. Anything else thrown becomes a 500 INTERNAL. */
export class AppError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = STATUS[code];
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
export const unauthorized = (message = 'Authentication required') =>
  new AppError('UNAUTHORIZED', message);
export const badRequest = (message: string, details?: unknown) =>
  new AppError('BAD_REQUEST', message, details);
