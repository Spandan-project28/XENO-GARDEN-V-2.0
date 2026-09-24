import type { ZodType } from 'zod';

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/**
 * Validates form values with a shared Zod schema (the same one the backend uses) and returns the
 * parsed data or the first error message per field.
 */
export function validate<T, K extends string>(
  schema: ZodType<T>,
  values: Record<K, unknown>,
): { ok: true; data: T } | { ok: false; errors: FieldErrors<K> } {
  const r = schema.safeParse(values);
  if (r.success) return { ok: true, data: r.data };
  const errors: FieldErrors<K> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? '') as K;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
