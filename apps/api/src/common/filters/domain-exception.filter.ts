import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@cc/domain/rules';
import type { Response } from 'express';

import { DomainError, mapDatabaseError } from '../errors/domain-error.js';

/** BR29: the API answers with codes, never sentences. The web app translates. */
const STATUS: Record<string, number> = {
  [ERROR_CODES.VALIDATION_FAILED]: 400,
  [ERROR_CODES.SPLIT_NOT_BALANCED]: 422,
  [ERROR_CODES.CARD_FUNCTION_DISABLED]: 422,
  [ERROR_CODES.INVALID_SETTLEMENT_TARGET]: 422,
  [ERROR_CODES.CREDIT_CANNOT_PAY]: 422,
  [ERROR_CODES.OVERPAYMENT]: 422,
  [ERROR_CODES.DUPLICATE]: 409,
  [ERROR_CODES.NOT_FOUND]: 404,
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = exception instanceof DomainError ? exception : mapDatabaseError(exception);

    if (error) {
      response.status(STATUS[error.code] ?? 422).json({
        code: error.code,
        detail: error.detail ?? null,
      });
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({ code: exception.name });
      return;
    }

    // An unmapped exception is a bug. It must never vanish into a bare 500 —
    // a filter that swallows the cause makes every later failure unreadable.
    this.logger.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    );
    response.status(500).json({ code: 'INTERNAL' });
  }
}
