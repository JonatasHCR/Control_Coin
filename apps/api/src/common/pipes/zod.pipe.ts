import { Injectable, type PipeTransform } from '@nestjs/common';
import { ERROR_CODES } from '@cc/domain/rules';
import type { ZodSchema } from 'zod';

import { DomainError } from '../errors/domain-error.js';

/**
 * Validates against the same schema the web app uses (@cc/domain), so a rule
 * cannot drift between client and server. Runs after the guards, so an
 * unauthenticated caller never learns the shape of the payload.
 */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'invalid payload', {
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
