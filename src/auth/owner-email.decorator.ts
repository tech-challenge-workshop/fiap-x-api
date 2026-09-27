import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard';

/** The authenticated caller's `email` claim, stored on the request by JwtAuthGuard. */
export const OwnerEmail = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().ownerEmail,
);
