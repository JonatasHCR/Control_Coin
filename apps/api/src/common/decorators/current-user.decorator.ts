import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Set by AuthGuard. Never read from the request body. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<{ userId: string }>().userId,
);
