import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { map, type Observable } from 'rxjs';

/**
 * The single enforcement point for money leaving as a string (BR36/ARCH01).
 * Without it every service would have to remember, and one forgotten field
 * ships a float to the browser.
 */
@Injectable()
export class MoneyInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serialise));
  }
}

function serialise(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialise(v)]),
    );
  }
  return value;
}
