import { z } from 'zod';
import { ERROR_CODES } from '../constants/index.js';

/** ISO-8601 timestamp string as sent over REST. */
export const isoDate = z.iso.datetime({ offset: true });

/** Mongo ObjectId as 24-hex string. */
export const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');

export const idParams = z.object({ id: objectId });

export const cursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type CursorQuery = z.infer<typeof cursorQuery>;

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export const apiError = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;

export const okResponse = z.object({ ok: z.literal(true) });
