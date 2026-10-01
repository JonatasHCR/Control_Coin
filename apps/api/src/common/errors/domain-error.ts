import { ERROR_CODES, type ErrorCode } from '@cc/domain/rules';

/**
 * A rule violation, carrying the stable code the web app translates.
 * BR29: the API returns codes, never sentences.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** A refusal whose sentence the web app shows as is (imports, exports). */
export function userError(code: ErrorCode, message: string): DomainError {
  return new DomainError(code, message, { message });
}

/**
 * Postgres raises our rules as exceptions with the code as a prefix. Mapping
 * them back keeps one wording, not two — and a non-zero count of these is a
 * bug in the API, since the domain schema should have caught it first (ARCH04).
 */
export function mapDatabaseError(error: unknown): DomainError | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : '';

  for (const code of Object.values(ERROR_CODES)) {
    if (message.includes(`${code}:`)) {
      const detail = message.split(`${code}:`)[1]?.trim() ?? '';
      return new DomainError(code, detail || code);
    }
  }
  if (message.includes('Unique constraint')) {
    return new DomainError(ERROR_CODES.DUPLICATE, 'already exists');
  }
  return null;
}
